// Small questions about the grid that the brain asks all the time.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { Rng } from '../../../../classes/engine/Rng';
import type { Vec3Like } from '../../../../model/TankCommand';

export class NavQueryService {
  private grid: NavGrid | null = null;

  public attach = (grid: NavGrid | null): void => {
    this.grid = grid;
  };

  public get current(): NavGrid | null {
    return this.grid;
  }

  /** The passable node under or near a point, or -1. */
  public nodeNear = (point: Vec3Like, radiusCells = 6): number => this.grid?.nearestPassable(point.x, point.y, point.z, radiusCells) ?? -1;

  /** True when there is no floor at all under the point (over water / off the map). */
  public isOverVoid = (point: Vec3Like): boolean => {
    const grid = this.grid;
    if (grid == null) return false;
    const col = grid.columnOfPoint(point.x, point.y);
    return col < 0 || grid.levelAt(col, point.z, 600) < 0;
  };

  /** A random passable node between `minRadius` and `maxRadius` of a point (world result), or null. */
  public randomReachable = (around: Vec3Like, minRadius: number, maxRadius: number, rng: Rng, out: Vec3Like): boolean => {
    const grid = this.grid;
    if (grid == null) return false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const range = rng.range(minRadius, maxRadius);
      const x = around.x + Math.cos(angle) * range;
      const y = around.y + Math.sin(angle) * range;
      const node = grid.nearestPassable(x, y, around.z, 2, 1500);
      if (node >= 0) {
        grid.nodeWorld(node, out);
        return true;
      }
    }
    return false;
  };
}

export default NavQueryService;
