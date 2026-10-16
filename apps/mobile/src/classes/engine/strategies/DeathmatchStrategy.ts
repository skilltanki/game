// Free-for-all: everyone is a target; the nearest KNOWN one first (seen by
// this bot, or reported). Out of sight, drive to where it was last seen;
// with nothing known, roam.
import type { BotStrategy } from './BotStrategy';
import type { BotMemory } from '../BotMemory';
import type { BotPerception, TankView } from '../../../model/Perception';
import type { Objective } from '../../../model/Objective';
import type { TeamContext } from '../../../model/engine/Tactics';

export function nearestEnemy(perception: BotPerception, preferVisible = true): TankView | null {
  const self = perception.self;
  let best: TankView | null = null;
  let bestScore = Infinity;
  for (const enemy of perception.enemies()) {
    if (!enemy.alive) continue;
    const distance = Math.hypot(enemy.position.x - self.position.x, enemy.position.y - self.position.y);
    const visible = preferVisible ? perception.hasLineOfSight(self.position, enemy.position) : true;
    const score = visible ? distance : distance * 1.6 + 1200;
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/** Hunt the nearest known enemy: live when visible, its last position when not. */
export function huntKnown(team: TeamContext): Objective | null {
  const known = team.knownEnemies();
  if (known.length === 0) return null;
  const target = known.find((k) => k.visible) ?? known[0];
  if (target.visible) {
    return { kind: 'hunt', target: target.view };
  }
  return { kind: 'goto', point: { ...target.lastSeen }, engage: true, arriveRadius: 400 };
}

export class DeathmatchStrategy implements BotStrategy {
  readonly id = 'dm';

  assignRole(_perception: BotPerception, memory: BotMemory): void {
    memory.role = 'hunter';
  }

  decide(_perception: BotPerception, _memory: BotMemory, team: TeamContext): Objective {
    return huntKnown(team) ?? { kind: 'roam' };
  }
}
