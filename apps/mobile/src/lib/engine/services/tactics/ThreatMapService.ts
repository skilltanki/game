// A path-cost layer that makes the ground around known enemies expensive,
// so a flag carrier (or anyone told to be careful) routes around them.
// Rebuilt once a second per team from the board's sightings.
import type { Blackboard } from '../../../../classes/engine/Blackboard';
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { SIGHTING_TTL_MS } from '../../../../model/engine/Tactics';

const REBUILD_MS = 1000;
/** Radius of the costly disc around an enemy, sim units. */
const THREAT_RADIUS = 1500;
/** Extra cost at the enemy's own cell (the edge cost of a cell is ~100). */
const THREAT_PEAK = 400;

export class ThreatMapService {
  public update = (board: Blackboard, grid: NavGrid, now: number): void => {
    if (now - board.threatAt < REBUILD_MS) return;
    board.threatAt = now;
    if (board.threat == null || board.threat.length !== grid.nodeCount) {
      board.threat = new Float32Array(grid.nodeCount);
    } else {
      board.threat.fill(0);
    }
    const layer = board.threat;
    const cell = grid.cellSize;
    const reach = Math.ceil(THREAT_RADIUS / cell);
    for (const s of board.sightings.values()) {
      const age = now - s.at;
      if (age > SIGHTING_TTL_MS * 1.5) continue;
      const freshness = 1 - age / (SIGHTING_TTL_MS * 1.5);
      const c0 = Math.floor((s.x - grid.originX) / cell);
      const r0 = Math.floor((s.y - grid.originY) / cell);
      for (let dc = -reach; dc <= reach; dc++) {
        for (let dr = -reach; dr <= reach; dr++) {
          const col = grid.columnIndex(c0 + dc, r0 + dr);
          if (col < 0) continue;
          const d = Math.hypot(dc, dr) * cell;
          if (d > THREAT_RADIUS) continue;
          const weight = THREAT_PEAK * (1 - d / THREAT_RADIUS) * freshness;
          for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
            if (Math.abs(grid.nodeZ[node] - s.z) > 600) continue;
            layer[node] += weight;
          }
        }
      }
    }
  };
}

export default ThreatMapService;
