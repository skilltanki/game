// Map reflection, step 3: how exposed each passable cell is. Eight rays at
// turret height tell which directions are open for a long shot; a cell
// with few open directions is cover, one with many is a crossfire. Only
// every other column is measured (the neighbours copy it) to keep the big
// maps under a couple of seconds.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { NAV_DIRS, NAV_DIR_COUNT, type NavBuildProgress } from '../../../../model/engine/Nav';
import type { StaticWorld } from '../../../../model/engine/World';

/** A direction counts as open when nothing blocks it for this long. */
export const EXPOSURE_RANGE = 1500;
/** Rays start this far above the floor (turret height). */
const EYE_HEIGHT = 120;
const CHUNK_MS = 8;

export class ExposureService {
  public measure = async (grid: NavGrid, world: StaticWorld, onProgress?: (p: NavBuildProgress) => void): Promise<void> => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 0, y: 0, z: 0 };
    const open = grid.nodeOpenDirs;
    open.fill(0);
    let started = performance.now();
    const total = grid.nodeCount;
    for (let node = 0; node < total; node++) {
      if (!grid.isPassable(node)) continue;
      const col = grid.nodeCol[node];
      const c = grid.colC(col);
      const r = grid.colR(col);
      if ((c + r) % 2 === 1) continue;
      from.x = grid.colX(col);
      from.y = grid.colY(col);
      from.z = grid.nodeZ[node] + EYE_HEIGHT;
      let mask = 0;
      for (let dir = 0; dir < NAV_DIR_COUNT; dir++) {
        const [dc, dr] = NAV_DIRS[dir];
        const len = Math.hypot(dc, dr);
        to.x = from.x + (dc / len) * EXPOSURE_RANGE;
        to.y = from.y + (dr / len) * EXPOSURE_RANGE;
        to.z = from.z;
        if (world.lineOfSight(from, to)) mask |= 1 << dir;
      }
      open[node] = mask;
      if (performance.now() - started > CHUNK_MS) {
        onProgress?.({ done: node, total });
        await new Promise((resolve) => setTimeout(resolve, 0));
        started = performance.now();
      }
    }
    // Unmeasured passable cells take a measured neighbour's mask.
    for (let node = 0; node < total; node++) {
      if (!grid.isPassable(node) || open[node] !== 0) continue;
      for (let dir = 0; dir < 4; dir++) {
        const other = grid.edge(node, dir);
        if (other >= 0 && open[other] !== 0) {
          open[node] = open[other];
          break;
        }
      }
    }
  };
}

/** Number of open directions of a node. */
export function openCount(mask: number): number {
  let n = 0;
  for (let i = 0; i < NAV_DIR_COUNT; i++) if (mask & (1 << i)) n++;
  return n;
}

/** The NAV_DIRS index closest to the direction (dx, dy). */
export function dirIndexToward(dx: number, dy: number): number {
  let best = 0;
  let bestDot = -Infinity;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < NAV_DIR_COUNT; i++) {
    const [dc, dr] = NAV_DIRS[i];
    const l = Math.hypot(dc, dr);
    const dot = (dc / l) * (dx / len) + (dr / l) * (dy / len);
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

export default ExposureService;
