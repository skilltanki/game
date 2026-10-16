// Obstacles the grid cannot see (a prop with collision the map XML does not
// list, a wreck, a seam) still stop hulls. Every stuck episode marks its
// spot; for a while the pathfinder prices the cells around it like a wall,
// so the next route goes around instead of into the same thing.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { CostLayer } from '../../../../model/engine/Nav';
import type { Vec3Like } from '../../../../model/TankCommand';

/** A mark lasts this long. */
const MARK_TTL_MS = 20000;
/** Cells within this radius of a mark are penalised. */
const MARK_RADIUS = 250;
/** Penalty at the mark's own cell (an edge costs ~100). */
const MARK_PEAK = 2500;
const REBUILD_MS = 1000;

interface Mark {
  x: number;
  y: number;
  z: number;
  at: number;
}

export class LearnedBlockService {
  private grid: NavGrid | null = null;
  private marks: Mark[] = [];
  private layer: CostLayer | null = null;
  private builtAt = -Infinity;

  public attach = (grid: NavGrid | null): void => {
    this.grid = grid;
    this.marks = [];
    this.layer = grid != null ? new Float32Array(grid.nodeCount) : null;
    this.builtAt = -Infinity;
  };

  public mark = (at: Vec3Like, now: number): void => {
    this.marks.push({ x: at.x, y: at.y, z: at.z, at: now });
    this.builtAt = -Infinity;
  };

  /** The current layer, or null when nothing is marked. */
  public layerAt = (now: number): CostLayer | null => {
    const grid = this.grid;
    const layer = this.layer;
    if (grid == null || layer == null) return null;
    this.marks = this.marks.filter((m) => now - m.at < MARK_TTL_MS);
    if (this.marks.length === 0) return null;
    if (now - this.builtAt < REBUILD_MS) return layer;
    this.builtAt = now;
    layer.fill(0);
    const cell = grid.cellSize;
    const reach = Math.ceil(MARK_RADIUS / cell);
    for (const m of this.marks) {
      const freshness = 1 - (now - m.at) / MARK_TTL_MS;
      const c0 = Math.floor((m.x - grid.originX) / cell);
      const r0 = Math.floor((m.y - grid.originY) / cell);
      for (let dc = -reach; dc <= reach; dc++) {
        for (let dr = -reach; dr <= reach; dr++) {
          const col = grid.columnIndex(c0 + dc, r0 + dr);
          if (col < 0) continue;
          const d = Math.hypot(dc, dr) * cell;
          if (d > MARK_RADIUS) continue;
          const weight = MARK_PEAK * (1 - d / (MARK_RADIUS + cell)) * freshness;
          for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
            if (Math.abs(grid.nodeZ[node] - m.z) > 300) continue;
            layer[node] += weight;
          }
        }
      }
    }
    return layer;
  };
}

export default LearnedBlockService;
