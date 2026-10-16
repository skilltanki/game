// Red versus blue: hunt the nearest known enemy, but prefer the one that is
// threatening a wounded ally, and when nothing is known push toward the
// enemy's side of the map together instead of scattering.
import type { BotStrategy } from './BotStrategy';
import type { BotMemory } from '../BotMemory';
import type { BotPerception, TankView } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';
import { huntKnown } from './DeathmatchStrategy';

export class TeamDeathmatchStrategy implements BotStrategy {
  readonly id = 'tdm';

  assignRole(_perception: BotPerception, memory: BotMemory): void {
    memory.role = 'hunter';
  }

  decide(perception: BotPerception, _memory: BotMemory, team: TeamContext): Objective {
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
    const hunt = huntKnown(team);
    if (hunt != null) return hunt;
    // Nobody known: advance on the enemy spawn area.
    const enemyTeam = self.team === 'red' ? 'blue' : 'red';
    const front = perception.spawnCentroid(enemyTeam);
    if (front != null) {
      return { kind: 'goto', point: front, engage: true, arriveRadius: 1200 };
    }
    return { kind: 'roam' };
  }
}
