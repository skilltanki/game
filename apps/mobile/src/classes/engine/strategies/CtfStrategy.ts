// Capture the Flag with the squad's roles: the carrier runs home around
// known threats; escorts ride ahead of and behind it; the interceptor cuts
// off a thief; defenders guard the pedestal; everyone else attacks the
// enemy flag. Attackers never stop for a fight: the gun works on the way.
import type { BotStrategy } from './BotStrategy';
import type { BotMemory } from '../BotMemory';
import type { BotPerception, TankView } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';
import { huntKnown } from './DeathmatchStrategy';
import { alongRoute, routeLength, saferRoute } from './routeRun';

const ENGAGE_RADIUS = 2600;
const DEFEND_RADIUS = 1800;
/**
 * Staging: an attacker this close to the enemy flag with no teammate within
 * BUDDY_RADIUS waits at a point STAGING_BACK from the flag (toward home) so
 * the squad goes in together; alone it gives up waiting after STAGING_MAX_MS.
 */
const STAGING_RADIUS = 2200;
const BUDDY_RADIUS = 1400;
/** A teammate farther than this is not coming soon: do not wait for it. */
const BUDDY_WORTH_WAITING = 4000;
const STAGING_BACK = 1600;
const STAGING_MAX_MS = 4000;
/**
 * Visible enemies this close to the enemy flag are guards. Clearing them is
 * pointless (they respawn at their base 2.5 s later), so an attacker grabs
 * and goes; only against GUARD_STAGE_COUNT or more of them it waits at the
 * staging point for a moment (shooting) before dashing in.
 */
const GUARD_RADIUS = 1200;
const GUARD_STAGE_COUNT = 2;
/** Below this health fraction an attacker patches up (stages) before grabbing: a wounded carrier dies in seconds. */
const GRAB_HEALTH = 0.5;
/** Attackers spread over routes only on maps where the run is long enough for corridors to matter. */
const SPREAD_MIN_ROUTE = 12000;
/** A defender that has chased its way this close to the enemy flag takes it instead of driving home empty (the owner's rule). */
const DEFENDER_GRAB_RADIUS = 2200;
const _point = { x: 0, y: 0, z: 0 };

export class CtfStrategy implements BotStrategy {
  readonly id = 'ctf';

  assignRole(_perception: BotPerception, memory: BotMemory, index: number): void {
    memory.role = index % 3 === 2 ? 'defender' : 'attacker';
  }

  decide(perception: BotPerception, memory: BotMemory, team: TeamContext): Objective {
    const self = perception.self;
    const flags = perception.flags();
    const myTeam = self.team;
    if (flags == null || (myTeam !== 'red' && myTeam !== 'blue')) {
      return huntKnown(team) ?? { kind: 'roam' };
    }
    const enemyTeam = myTeam === 'red' ? 'blue' : 'red';
    const ours = flags[myTeam];
    const theirs = flags[enemyTeam];
    const role = team.roleOf(self.id);

    // Carrying their flag: home, now, by the route farther from fresh sightings.
    if (self.carriesFlag === enemyTeam) {
      const routes = team.flagRoutes(theirs.basePosition, ours.basePosition);
      if (routes.length > 1 && !memory.routeWaypointDone) {
        memory.routeIndex = saferRoute(routes, team);
      }
      return alongRoute(perception, memory, routes, ours.basePosition, 150);
    }
    // Not on a route run any more (role changed, flag gone): the next run starts from its waypoint again.
    if (role !== 'hunter' && role !== 'carrier') {
      memory.routeWaypointDone = false;
    }
    if (role === 'interceptor') {
      const thief = ours.carrierId != null ? this.findTank(perception, ours.carrierId) : null;
      if (thief != null && thief.alive) {
        const distance = Math.hypot(thief.position.x - self.position.x, thief.position.y - self.position.y);
        if (distance < 1500 && perception.hasLineOfSight(self.position, thief.position)) {
          return { kind: 'hunt', target: thief };
        }
        if (team.interceptPoint(_point)) {
          return { kind: 'goto', point: { ..._point }, engage: true, arriveRadius: 300 };
        }
        return { kind: 'hunt', target: thief };
      }
    }
    if (role === 'escortFront' || role === 'escortRear') {
      if (team.escortPoint(role, _point)) {
        return { kind: 'goto', point: { ..._point }, engage: true, arriveRadius: 250 };
      }
    }
    if (role === 'defender') {
      // Already at the enemy base (a chase led here): the flag is right there, take it.
      if (theirs.state !== 'carried' && Math.hypot(theirs.position.x - self.position.x, theirs.position.y - self.position.y) < DEFENDER_GRAB_RADIUS) {
        memory.role = 'attacker';
        return { kind: 'goto', point: theirs.position, engage: true, arriveRadius: 120 };
      }
      memory.role = 'defender';
      const close = team.knownEnemies().find((k) => k.visible && Math.hypot(k.view.position.x - self.position.x, k.view.position.y - self.position.y) < ENGAGE_RADIUS);
      if (close != null) {
        return { kind: 'hunt', target: close.view };
      }
      // A post with cover and a view of the approach beats sitting on the pedestal.
      if (team.defencePost(self.id.length % 3, _point)) {
        return { kind: 'hold', point: { ..._point }, radius: 500 };
      }
      return { kind: 'hold', point: ours.basePosition, radius: DEFEND_RADIUS };
    }
    memory.role = 'attacker';
    // Attacker: go get their flag unless a teammate already has it (then ride along).
    if (theirs.state === 'carried') {
      const carrier = theirs.carrierId != null ? this.findTank(perception, theirs.carrierId) : null;
      if (carrier != null) {
        memory.stagingSince = 0;
        // Ride along, but never on its tail: the carrier has right of way.
        return { kind: 'goto', point: carrier.position, engage: true, arriveRadius: 1300 };
      }
    }
    const toFlag = Math.hypot(theirs.position.x - self.position.x, theirs.position.y - self.position.y);
    if (toFlag < STAGING_RADIUS) {
      const guards = team
        .knownEnemies()
        .filter((k) => k.visible && Math.hypot(k.view.position.x - theirs.position.x, k.view.position.y - theirs.position.y) < GUARD_RADIUS).length;
      let buddy = false;
      let buddyComing = false;
      for (const a of perception.allies()) {
        if (!a.alive || team.roleOf(a.id) === 'defender') continue;
        const d = Math.hypot(a.position.x - self.position.x, a.position.y - self.position.y);
        if (d < BUDDY_RADIUS) buddy = true;
        else if (d < BUDDY_WORTH_WAITING) buddyComing = true;
      }
      const wounded = self.health / Math.max(1, self.maxHealth) < GRAB_HEALTH && self.supplyReady('health');
      // Wait only for a buddy that is actually on its way, to patch up, or while the pedestal is crowded.
      if ((!buddy && buddyComing) || wounded || guards >= GUARD_STAGE_COUNT) {
        if (memory.stagingSince === 0) memory.stagingSince = perception.now;
        if (perception.now - memory.stagingSince < STAGING_MAX_MS) {
          const dx = ours.basePosition.x - theirs.position.x;
          const dy = ours.basePosition.y - theirs.position.y;
          const len = Math.hypot(dx, dy) || 1;
          return {
            kind: 'goto',
            point: { x: theirs.position.x + (dx / len) * STAGING_BACK, y: theirs.position.y + (dy / len) * STAGING_BACK, z: theirs.position.z },
            engage: true,
            arriveRadius: 300,
          };
        }
      } else {
        memory.stagingSince = 0;
      }
    } else {
      memory.stagingSince = 0;
    }
    // Attackers spread over the routes so the whole team does not file down one corridor into the enemy's push.
    if (theirs.state === 'atBase') {
      const routes = team.flagRoutes(ours.basePosition, theirs.basePosition);
      if (routes.length > 1 && routeLength(routes[0]) >= SPREAD_MIN_ROUTE) {
        memory.routeIndex = memory.slot % routes.length;
        return alongRoute(perception, memory, routes, theirs.position, 120);
      }
    }
    return { kind: 'goto', point: theirs.position, engage: true, arriveRadius: 120 };
  }

  private findTank(perception: BotPerception, id: string): TankView | null {
    if (id === perception.self.id) {
      return perception.self;
    }
    return perception.tanks().find((t) => t.id === id) ?? null;
  }
}
