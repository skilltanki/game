// Dev overlay (?debug=nav): the walkability grid and the bots' paths as
// immediate-mode lines in the 3D scene. Reads lib/engine's debug snapshot
// and never touches the simulation.
import * as pc from 'playcanvas';
import { NAV_MARGINAL } from '../../../../model/engine/Nav';
import type { NavDebugSnapshot } from '../../../../model/engine/Nav';
import { engine } from '../../../engine';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type EngineService from '../base/EngineService';
import type BattleStateService from '../battle/BattleStateService';

/** Nodes farther than this from the local tank are not drawn (sim units). */
const DRAW_RADIUS = 6000;
/** Cross size per node, sim units. */
const CROSS = 30;

const COLOR_WALKABLE = new pc.Color(0.2, 0.9, 0.3, 0.6);
const COLOR_MARGINAL = new pc.Color(0.95, 0.75, 0.1, 0.7);
const COLOR_BLOCKED = new pc.Color(0.95, 0.2, 0.2, 0.8);
const COLOR_PATH = new pc.Color(0.2, 0.6, 1, 1);

export class NavOverlayService {
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  private detach: (() => void) | null = null;
  private snapshot: NavDebugSnapshot | null = null;
  private snapshotVersion = -1;
  private readonly a = new pc.Vec3();
  private readonly b = new pc.Vec3();
  private readonly sim = new pc.Vec3();

  public enable = (): void => {
    if (this.detach != null) return;
    engine.navDebugService.setEnabled(true);
    this.detach = this.engineService.onUpdate(this.draw);
  };

  public disable = (): void => {
    this.detach?.();
    this.detach = null;
    engine.navDebugService.setEnabled(false);
  };

  private draw = (): void => {
    const state = this.battleStateService;
    if (!state.running || !state.hasLocal) return;
    if (engine.navDebugService.version !== this.snapshotVersion) {
      this.snapshot = engine.navDebugService.snapshot();
      this.snapshotVersion = engine.navDebugService.version;
    }
    const snapshot = this.snapshot;
    if (snapshot == null) return;
    const app = this.engineService.app;
    const transform = this.engineService.simRoot.getWorldTransform();
    const centre = state.local.gameTank.tank.getBody().state.position;
    const toWorld = (x: number, y: number, z: number, out: pc.Vec3): pc.Vec3 => {
      this.sim.set(x, y, z);
      return transform.transformPoint(this.sim, out);
    };
    for (const node of snapshot.nodes) {
      if (Math.abs(node.x - centre.x) > DRAW_RADIUS || Math.abs(node.y - centre.y) > DRAW_RADIUS) continue;
      const color = !node.passable ? COLOR_BLOCKED : (node.flags & NAV_MARGINAL) !== 0 ? COLOR_MARGINAL : COLOR_WALKABLE;
      app.drawLine(toWorld(node.x - CROSS, node.y, node.z + 5, this.a), toWorld(node.x + CROSS, node.y, node.z + 5, this.b), color);
      app.drawLine(toWorld(node.x, node.y - CROSS, node.z + 5, this.a), toWorld(node.x, node.y + CROSS, node.z + 5, this.b), color);
    }
    for (const path of snapshot.paths) {
      for (let i = 1; i < path.points.length; i++) {
        const p = path.points[i - 1];
        const q = path.points[i];
        app.drawLine(toWorld(p.x, p.y, p.z + 60, this.a), toWorld(q.x, q.y, q.z + 60, this.b), COLOR_PATH);
      }
    }
  };
}

export default NavOverlayService;
