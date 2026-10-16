// Once a second a team hands out roles: the carrier is whoever holds a flag;
// the interceptor is the one nearest to an enemy carrying OUR flag; the two
// nearest to our carrier escort it; one in three defends (the slow hulls
// with long guns: a Mammoth takes a minute to cross kolhoz, a Wasp half
// that, so the fast ones run for the flag); the rest attack.
import type { Blackboard } from '../../../../classes/engine/Blackboard';
import type { BotPerception } from '../../../../model/Perception';
import type { SquadRole } from '../../../../model/engine/Tactics';

const AUCTION_MS = 1000;
/** Short reach: these go for the flag (a Freeze carrier chills its pursuers); the long guns hold the base. */
const CLOSE_RANGE = new Set(['Freeze', 'Firebird', 'Isida']);
/** Defender pick: this many units of distance from home weigh as much as 1 u/s of top speed (a hull 10 000 away = +250 u/s). */
const DEFENDER_DISTANCE_PER_SPEED = 40;

export class RoleAuctionService {
  public assign = (board: Blackboard, now: number): void => {
    if (now - board.lastAuctionAt < AUCTION_MS) return;
    board.lastAuctionAt = now;
    const members = [...board.members.entries()].filter(([, p]) => p.self.alive);
    board.roles.clear();
    if (members.length === 0) return;
    const any = members[0][1];
    const flags = any.flags();
    const team = board.team;
    const enemyTeam = team === 'red' ? 'blue' : 'red';
    const free = new Map(members);

    // Carrier: holds any flag.
    let carrier: BotPerception | null = null;
    for (const [id, p] of free) {
      if (p.self.carriesFlag != null) {
        board.roles.set(id, 'carrier');
        carrier = p;
        free.delete(id);
        break;
      }
    }
    // Interceptor: a flag is on an enemy (CTF: ours; assault: theirs, bound for our base) -> the nearest free member chases it.
    if (flags != null && (team === 'red' || team === 'blue')) {
      const stolen = any.flagRules === 'assault' ? flags[enemyTeam] : flags[team];
      if (stolen.carrierId != null) {
        const thief = any.tanks().find((t) => t.id === stolen.carrierId);
        if (thief != null) {
          const id = this.nearest(free, thief.position);
          if (id != null) {
            board.roles.set(id, 'interceptor');
            free.delete(id);
          }
        }
      }
    }
    // Escorts: two nearest to the carrier; an Isida takes the rear slot as the medic.
    if (carrier != null) {
      const medic = [...free].find(([, p]) => p.self.turret === 'Isida')?.[0] ?? null;
      if (medic != null) {
        board.roles.set(medic, 'escortRear');
        free.delete(medic);
      }
      for (const role of ['escortFront', 'escortRear'] as const) {
        if (role === 'escortRear' && medic != null) continue;
        const id = this.nearest(free, carrier.self.position);
        if (id == null) break;
        board.roles.set(id, role);
        free.delete(id);
      }
    }
    // Defenders: one in three of the whole squad — the slowest hulls, with a
    // pull toward whoever is already near home; the close-range turrets are
    // kept for the attack whenever anyone else can defend.
    const defenders = Math.floor(members.length / 3);
    if (flags != null && (team === 'red' || team === 'blue')) {
      const home = flags[team].basePosition;
      for (let i = 0; i < defenders; i++) {
        const longGuns = new Map([...free].filter(([, p]) => !CLOSE_RANGE.has(p.self.turret)));
        const id = this.slowestNear(longGuns.size > 0 ? longGuns : free, home);
        if (id == null) break;
        board.roles.set(id, 'defender');
        free.delete(id);
      }
    }
    for (const id of free.keys()) {
      board.roles.set(id, 'hunter');
    }
  };

  private nearest(pool: Map<string, BotPerception>, point: { x: number; y: number }): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, p] of pool) {
      const d = Math.hypot(p.self.position.x - point.x, p.self.position.y - point.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Lowest top speed wins; distance to `point` breaks near-ties (DEFENDER_DISTANCE_PER_SPEED units ~ 1 u/s of speed). */
  private slowestNear(pool: Map<string, BotPerception>, point: { x: number; y: number }): string | null {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [id, p] of pool) {
      const d = Math.hypot(p.self.position.x - point.x, p.self.position.y - point.y);
      const score = p.self.maxSpeed + d / DEFENDER_DISTANCE_PER_SPEED;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  public roleOf = (board: Blackboard, id: string): SquadRole => board.roles.get(id) ?? 'hunter';
}

export default RoleAuctionService;
