// Snapshots of the grid and the bots' latest paths for a dev overlay
// (?debug=nav). Off by default: recording paths costs a copy per plan.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { NavDebugSnapshot } from '../../../../model/engine/Nav';
import type { Vec3Like } from '../../../../model/TankCommand';

export class NavDebugService {
  private enabled = false;
  private grid: NavGrid | null = null;
  private readonly paths = new Map<string, Vec3Like[]>();
  /** Bumped on every change, so an overlay redraws only when needed. */
  public version = 0;

  public setEnabled = (enabled: boolean): void => {
    this.enabled = enabled;
  };

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public attach = (grid: NavGrid | null): void => {
    this.grid = grid;
    this.paths.clear();
    this.version++;
  };

  public recordPath = (actorId: string, points: Vec3Like[]): void => {
    if (!this.enabled) return;
    this.paths.set(actorId, points.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    this.version++;
  };

  public snapshot = (): NavDebugSnapshot | null => {
    const grid = this.grid;
    if (grid == null) return null;
    const nodes: NavDebugSnapshot['nodes'] = [];
    const out = { x: 0, y: 0, z: 0 };
    for (let node = 0; node < grid.nodeCount; node++) {
      if (!grid.isFloor(node)) continue;
      grid.nodeWorld(node, out);
      nodes.push({ x: out.x, y: out.y, z: out.z, flags: grid.nodeFlags[node], clearance: grid.nodeClearance[node], passable: grid.isPassable(node) });
    }
    return {
      cellSize: grid.cellSize,
      nodes,
      paths: [...this.paths.entries()].map(([id, points]) => ({ id, points })),
    };
  };
}

export default NavDebugService;
