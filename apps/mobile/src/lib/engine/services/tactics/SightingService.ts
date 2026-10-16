// What a bot honestly knows about enemies: only those its turret can see,
// plus what teammates reported. A sighting ages out after SIGHTING_TTL_MS,
// so a bot drives to where an enemy WAS, not where it is.
import type { Blackboard } from '../../../../classes/engine/Blackboard';
import type { BotPerception, TankView } from '../../../../model/Perception';
import { SIGHTING_TTL_MS, type KnownEnemy } from '../../../../model/engine/Tactics';

const _scratch: KnownEnemy[] = [];

export class SightingService {
  /** Reports every enemy this bot can see right now to its team's board. */
  public observe = (perception: BotPerception, board: Blackboard): void => {
    const self = perception.self;
    const now = perception.now;
    for (const enemy of perception.enemies()) {
      if (!enemy.alive) continue;
      if (perception.canSee(self.position, enemy)) {
        let s = board.sightings.get(enemy.id);
        if (s == null) {
          s = { id: enemy.id, x: 0, y: 0, z: 0, at: 0, byId: '' };
          board.sightings.set(enemy.id, s);
        }
        s.x = enemy.position.x;
        s.y = enemy.position.y;
        s.z = enemy.position.z;
        s.at = now;
        s.byId = self.id;
      }
    }
  };

  /** Known enemies for one bot, nearest first; a dead enemy is forgotten. */
  public known = (perception: BotPerception, board: Blackboard): KnownEnemy[] => {
    const self = perception.self;
    const now = perception.now;
    const views = new Map<string, TankView>();
    for (const enemy of perception.enemies()) views.set(enemy.id, enemy);
    _scratch.length = 0;
    for (const s of board.sightings.values()) {
      const view = views.get(s.id);
      if (view == null || !view.alive || now - s.at > SIGHTING_TTL_MS) continue;
      const visible = perception.canSee(self.position, view);
      _scratch.push({ view, lastSeen: visible ? view.position : { x: s.x, y: s.y, z: s.z }, ageMs: visible ? 0 : now - s.at, visible });
    }
    _scratch.sort((a, b) => dist2(self.position, a.lastSeen) - dist2(self.position, b.lastSeen));
    return _scratch.slice();
  };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export default SightingService;
