// Red versus blue: hunt the nearest known enemy, but prefer the one that is
// threatening a wounded ally, and when nothing is known push toward the
// enemy's side of the map — spread out, not in one file: each bot drives at
// its own enemy spawn point and the team splits over the base-to-base
// routes (on Babylon everybody took the one ramp to one centroid and the
// two columns jammed nose to nose on it).
import type { BotStrategy } from './BotStrategy';
import type { BotMemory } from '../BotMemory';
import type { BotPerception, TankView } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';
import type { Vec3Like } from '../../../model/TankCommand';
import { huntAmong } from './DeathmatchStrategy';
import { alongRoute } from './routeRun';

/** Close enough to the enemy's spawn to count as "there" (its tanks come out somewhere around it). */
const ADVANCE_RADIUS = 1200;
/**
 * A known enemy farther than this is left to the push: on Babylon a bot
 * chased one a teammate saw 20 000 units away, and the whole team converged
 * on that one spot instead of spreading over its routes.
 */
const HUNT_RANGE = 8000;

export class TeamDeathmatchStrategy implements BotStrategy {
  readonly id = 'tdm';

  assignRole(_perception: BotPerception, memory: BotMemory): void {
    memory.role = 'hunter';
  }

  decide(perception: BotPerception, memory: BotMemory, team: TeamContext): Objective {
    const self = perception.self;
    // A known enemy within reach of a wounded ally is the priority target.
    let support: TankView | null = null;
    const known = team.knownEnemies();
    for (const ally of perception.allies()) {
      if (!ally.alive || ally.health / Math.max(1, ally.maxHealth) > 0.5) continue;
      for (const k of known) {
        const toAlly = Math.hypot(k.lastSeen.x - ally.position.x, k.lastSeen.y - ally.position.y);
        const toMe = Math.hypot(k.lastSeen.x - self.position.x, k.lastSeen.y - self.position.y);
        if (toAlly < 2500 && toMe < 6000 && k.visible) {
          support = k.view;
        }
      }
    }
    if (support != null) {
      return { kind: 'hunt', target: support };
    }
    const near = known.filter((k) => Math.hypot(k.lastSeen.x - self.position.x, k.lastSeen.y - self.position.y) <= HUNT_RANGE);
    const hunt = huntAmong(near);
    if (hunt != null) return hunt;
    // Nobody known: advance on the enemy spawn area.
    const myTeam = self.team;
    if (myTeam !== 'red' && myTeam !== 'blue') return { kind: 'roam' };
    const enemyTeam = myTeam === 'red' ? 'blue' : 'red';
    const front = this.advancePoint(perception, memory, enemyTeam);
    if (front == null) return { kind: 'roam' };
    const ours = perception.spawnCentroid(myTeam);
    const theirs = perception.spawnCentroid(enemyTeam);
    if (ours != null && theirs != null) {
      const routes = team.flagRoutes(ours, theirs);
      if (routes.length > 1) {
        memory.routeIndex = memory.slot % routes.length;
        return alongRoute(perception, memory, routes, front, ADVANCE_RADIUS);
      }
    }
    return { kind: 'goto', point: front, engage: true, arriveRadius: ADVANCE_RADIUS };
  }

  /**
   * This bot's share of the enemy's spawn points: the team's slots are spread
   * evenly over the list (spawn points come in map order, neighbours next to
   * each other, so slot i of n takes point i·m/n rather than point i).
   */
  private advancePoint(perception: BotPerception, memory: BotMemory, enemyTeam: 'red' | 'blue'): Vec3Like | null {
    const points = perception.spawnPoints(enemyTeam);
    if (points.length === 0) return null;
    // Dead teammates count too: a share that moved with every death would move everyone's goal.
    const teammates = perception.allies().length + 1;
    const share = memory.slot % teammates;
    return points[Math.floor((share * points.length) / teammates) % points.length];
  }
}
