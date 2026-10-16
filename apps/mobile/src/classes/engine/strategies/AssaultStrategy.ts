// Assault: carry YOUR OWN flag to the ENEMY base. Roles as in CTF: the
// carrier runs, escorts ride along, the interceptor stops the enemy carrier
// heading for our pedestal, defenders camp our delivery point.
import type { BotStrategy } from './BotStrategy';
import type { BotMemory } from '../BotMemory';
import type { BotPerception, TankView } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';
import { huntKnown } from './DeathmatchStrategy';
import { alongRoute, saferRoute } from './routeRun';

const ENGAGE_RADIUS = 2600;
const _point = { x: 0, y: 0, z: 0 };

export class AssaultStrategy implements BotStrategy {
  readonly id = 'assault';

  assignRole(_perception: BotPerception, memory: BotMemory, index: number): void {
    memory.role = index % 2 === 1 ? 'defender' : 'attacker';
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

    // Not on a route run any more: the next run starts from its waypoint again.
    if (role !== 'carrier') {
      memory.routeWaypointDone = false;
    }
    // Carrying our flag: to their base by the route farther from fresh sightings.
    if (self.carriesFlag === myTeam) {
      const routes = team.flagRoutes(ours.basePosition, theirs.basePosition);
      if (routes.length > 1 && !memory.routeWaypointDone) {
        memory.routeIndex = saferRoute(routes, team);
      }
      return alongRoute(perception, memory, routes, theirs.basePosition, 150);
    }
    // An enemy carrier heading for OUR base is the threat: cut it off ahead, hunt it when close.
    const carrier = theirs.carrierId != null ? this.findTank(perception, theirs.carrierId) : null;
    if (carrier != null && carrier.alive && (role === 'interceptor' || role === 'defender')) {
      if (role === 'interceptor') {
        const distance = Math.hypot(carrier.position.x - self.position.x, carrier.position.y - self.position.y);
        if (distance >= 1500 && team.interceptPoint(_point)) {
          return { kind: 'goto', point: { ..._point }, engage: true, arriveRadius: 300 };
        }
      }
      return { kind: 'hunt', target: carrier };
    }
    if (role === 'escortFront' || role === 'escortRear') {
      if (team.escortPoint(role, _point)) {
        return { kind: 'goto', point: { ..._point }, engage: true, arriveRadius: 250 };
      }
    }
    if (role === 'defender') {
      memory.role = 'defender';
      const close = team.knownEnemies().find((k) => k.visible && Math.hypot(k.view.position.x - self.position.x, k.view.position.y - self.position.y) < ENGAGE_RADIUS);
      if (close != null) {
        return { kind: 'hunt', target: close.view };
      }
      // Guard the enemy's delivery point: our pedestal is where they score.
      return { kind: 'hold', point: ours.basePosition, radius: 2000 };
    }
    memory.role = 'attacker';
    if (ours.state === 'carried') {
      const ally = ours.carrierId != null ? this.findTank(perception, ours.carrierId) : null;
      if (ally != null) {
        // Ride along, but never on its tail: the carrier has right of way.
        return { kind: 'goto', point: ally.position, engage: true, arriveRadius: 1300 };
      }
    }
    return { kind: 'goto', point: ours.position, engage: true, arriveRadius: 120 };
  }

  private findTank(perception: BotPerception, id: string): TankView | null {
    if (id === perception.self.id) {
      return perception.self;
    }
    return perception.tanks().find((t) => t.id === id) ?? null;
  }
}
