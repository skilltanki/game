// String pulling: drop waypoints the hull can drive past in a straight
// line, so a path hugs corners instead of zig-zagging cell to cell. A
// straight run is accepted only where every column it crosses has a
// passable level at the interpolated height.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { Path } from '../../../../model/engine/Path';
import type { Vec3Like } from '../../../../model/TankCommand';

/** Height tolerance between the straight line and the floor under it. */
const LINE_DZ = 80;
/** Drop clearance a straight run needs on every cell, so a shortcut never grazes a shore. */
const LINE_CLEARANCE = 2;
/** Wall clearance a straight run needs, so a shortcut never clips a corner with the hull (2 still jammed hulls on kolhoz fences). */
const LINE_WALL_CLEARANCE = 3;
/** Longest straight run, cells, so pure pursuit keeps enough waypoints on long legs. */
const MAX_RUN_CELLS = 30;

export class PathSmoothingService {
  public smooth = (grid: NavGrid, path: Path): Path => {
    if (path.points.length <= 2) {
      return path;
    }
    const points: Vec3Like[] = [path.points[0]];
    const nodes: number[] = [path.nodes[0]];
    let anchor = 0;
    while (anchor < path.points.length - 1) {
      let far = anchor + 1;
      const limit = Math.min(path.points.length - 1, anchor + MAX_RUN_CELLS);
      for (let candidate = limit; candidate > anchor + 1; candidate--) {
        if (this.lineClear(grid, path.points[anchor], path.points[candidate])) {
          far = candidate;
          break;
        }
      }
      points.push(path.points[far]);
      nodes.push(path.nodes[far]);
      anchor = far;
    }
    return { status: path.status, points, nodes, cost: path.cost };
  };

  /** Supercover walk of the columns under segment a -> b. */
  private lineClear(grid: NavGrid, a: Vec3Like, b: Vec3Like): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil((length / grid.cellSize) * 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const z = a.z + (b.z - a.z) * t;
      const node = grid.standAt(x, y, z, LINE_DZ);
      if (node < 0 || !grid.isPassable(node) || grid.nodeClearance[node] < LINE_CLEARANCE || grid.nodeWallClearance[node] < LINE_WALL_CLEARANCE) {
        return false;
      }
    }
    return true;
  }
}

export default PathSmoothingService;
