// On top of the mode's mission, a bot weighs a few alternatives every
// decision: keep the mission, pick a fight with a visible enemy, retreat
// to heal, or lie in ambush. Scores come from the situation and the
// persona; the current action gets a bonus and a minimum tenure so bots
// do not flicker between equally good choices.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { Rng } from '../../../../classes/engine/Rng';
import type { Objective } from '../../../../model/Objective';
import type { BotPerception, TankView } from '../../../../model/Perception';
import type { ActionKind, BotPersona } from '../../../../model/engine/Persona';
import type { TeamContext } from '../../../../model/engine/Tactics';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type NavQueryService from '../nav/NavQueryService';

const HYSTERESIS = 15;
const MIN_TENURE_MS = 2000;
/** Hunting is only worth it this close (sim units). */
const HUNT_RANGE = 3500;
/** Retreat point: this far back toward home from the hull. */
const RETREAT_DISTANCE = 2500;
const AMBUSH_STALE_MS = 15000;
/** Focus: the visible enemy with the most frags counts as this much closer (× persona.teamwork): the top fragger is the threat... */
const FOCUS_LEADER = 0.5;
/** ...but only within this many times the nearest enemy's distance (no cross-map chases past a nearer gun). */
const FOCUS_REACH = 1.6;

export class UtilityPlannerService {
  private readonly navQueryService = inject<NavQueryService>(TYPES.navQueryService);

  public plan = (perception: BotPerception, memory: BotMemory, team: TeamContext, persona: BotPersona, rng: Rng, mission: Objective): Objective => {
    const self = perception.self;
    const now = perception.now;
    const hp = self.health / Math.max(1, self.maxHealth);
    const known = team.knownEnemies();
    const visible = known.filter((k) => k.visible);
    const nearestVisible = this.pickPrey(perception, visible.map((k) => k.view), persona);
    const nearestDistance = nearestVisible != null ? Math.hypot(nearestVisible.view.position.x - self.position.x, nearestVisible.view.position.y - self.position.y) : Infinity;
    const carrying = self.carriesFlag != null;
    const role = team.roleOf(self.id);

    // --- scores ---------------------------------------------------------------
    const scores: Record<ActionKind, number> = { mission: 50, hunt: 0, retreat: 0, ambush: 0 };
    if (carrying) scores.mission = 100;
    if (role === 'carrier' || role === 'interceptor' || role === 'escortFront' || role === 'escortRear') scores.mission += 25;
    if (nearestVisible != null && nearestDistance < HUNT_RANGE && !carrying) {
      scores.hunt = 30 + persona.aggression * 40 + (1 - nearestDistance / HUNT_RANGE) * 20;
      // A wounded visible enemy is tempting; a buffed one is not.
      const theirHp = nearestVisible.view.health / Math.max(1, nearestVisible.view.maxHealth);
      scores.hunt += (1 - theirHp) * 20 - (nearestVisible.view.buffed ? 25 : 0);
    }
    if (!carrying) {
      const threshold = 0.25 + persona.caution * 0.35;
      if (hp < threshold && (visible.length > 0 || known.length > 1)) {
        scores.retreat = 60 + (threshold - hp) * 120 + (self.supplyReady('health') ? -40 : 0);
      }
    }
    if (!carrying && persona.patience > 0.55 && role === 'hunter' && visible.length === 0 && perception.flagRules != null) {
      scores.ambush = 20 + persona.patience * 30;
    }
    // Hysteresis: the current action keeps a bonus and a minimum tenure.
    scores[memory.action] += HYSTERESIS;
    let best: ActionKind = 'mission';
    for (const kind of ['mission', 'hunt', 'retreat', 'ambush'] as ActionKind[]) {
      if (scores[kind] > scores[best]) best = kind;
    }
    if (best !== memory.action && now - memory.actionSince < MIN_TENURE_MS && scores[memory.action] > 0) {
      best = memory.action;
    }
    if (best !== memory.action) {
      memory.action = best;
      memory.actionSince = now;
      memory.ambushPoint = null;
    }

    // --- execution --------------------------------------------------------------
    switch (best) {
      case 'hunt':
        return nearestVisible != null ? { kind: 'hunt', target: nearestVisible.view } : mission;
      case 'retreat':
        return this.retreat(perception, mission);
      case 'ambush':
        return this.ambush(perception, memory, team, rng, mission);
      case 'mission':
      default:
        return mission;
    }
  };

  /** The nearest visible enemy, with the team's top fragger counted closer by FOCUS_LEADER × teamwork (hard focuses the player on a streak). */
  private pickPrey(perception: BotPerception, visible: TankView[], persona: BotPersona): { view: TankView } | null {
    if (visible.length === 0) return null;
    const self = perception.self;
    let leader = 0;
    let nearest = Infinity;
    for (const v of visible) {
      leader = Math.max(leader, v.frags);
      nearest = Math.min(nearest, Math.hypot(v.position.x - self.position.x, v.position.y - self.position.y));
    }
    let best: TankView | null = null;
    let bestScore = Infinity;
    for (const v of visible) {
      const distance = Math.hypot(v.position.x - self.position.x, v.position.y - self.position.y);
      const share = leader > 0 && distance <= nearest * FOCUS_REACH ? v.frags / leader : 0;
      const score = distance * (1 - FOCUS_LEADER * persona.teamwork * share);
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best != null ? { view: best } : null;
  }

  /** Back toward home (own spawns), shooting on the way; the supply policy pops the kit. */
  private retreat(perception: BotPerception, mission: Objective): Objective {
    const self = perception.self;
    const home = perception.spawnCentroid(self.team) ?? perception.flags()?.[self.team === 'red' ? 'red' : 'blue']?.basePosition ?? null;
    if (home == null) return mission;
    const dx = home.x - self.position.x;
    const dy = home.y - self.position.y;
    const len = Math.hypot(dx, dy);
    if (len < 400) return { kind: 'hold', point: home, radius: 600 };
    const k = Math.min(1, RETREAT_DISTANCE / len);
    return { kind: 'goto', point: { x: self.position.x + dx * k, y: self.position.y + dy * k, z: self.position.z }, engage: true, arriveRadius: 300 };
  }

  /** Wait somewhere between the flags for the enemy to come past. */
  private ambush(perception: BotPerception, memory: BotMemory, team: TeamContext, rng: Rng, mission: Objective): Objective {
    const flags = perception.flags();
    const self = perception.self;
    if (flags == null || (self.team !== 'red' && self.team !== 'blue')) return mission;
    if (memory.ambushPoint == null || perception.now - memory.actionSince > AMBUSH_STALE_MS) {
      const out = { x: 0, y: 0, z: 0 };
      if (!team.ambushPost(out)) {
        const ours = flags[self.team].basePosition;
        const theirs = flags[self.team === 'red' ? 'blue' : 'red'].basePosition;
        const t = rng.range(0.35, 0.65);
        const mid = { x: ours.x + (theirs.x - ours.x) * t, y: ours.y + (theirs.y - ours.y) * t, z: ours.z };
        if (!this.navQueryService.randomReachable(mid, 300, 1500, rng, out)) Object.assign(out, mid);
      }
      memory.ambushPoint = out;
      memory.actionSince = perception.now;
    }
    return { kind: 'hold', point: memory.ambushPoint, radius: 500 };
  }
}

export default UtilityPlannerService;
