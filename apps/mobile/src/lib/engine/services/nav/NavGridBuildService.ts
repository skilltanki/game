// Map reflection, step 1: sample the static world on a grid and find the
// floors in every column by repeated downward probes. Runs in time-sliced
// chunks so the loading screen keeps animating on a phone.
import { NavGridBuilder, type NavGrid } from '../../../../classes/engine/NavGrid';
import { NAV_LOW, NAV_MARGINAL, NAV_STEEP, NAV_WALKABLE, type NavBuildProgress, type NavParams } from '../../../../model/engine/Nav';
import type { GroundHit, StaticWorld } from '../../../../model/engine/World';

/** Probes start this far above the highest shape. */
const PROBE_ABOVE = 500;
/** The next probe starts this far below the previous hit (past the surface). */
const PROBE_BELOW = 5;
/** Headroom is measured from this far above the floor. */
const HEADROOM_FROM = 10;
/**
 * Volume probe: a hull-sized box over the cell. Downward rays never see a
 * vertical wall, a thin fence or the side of a building, so every floor is
 * also tested for solid geometry in the space a hull would occupy. The box
 * starts this far above the floor so a 45 deg slope inside the cell
 * (rising ~70 over the cell's half-diagonal) does not trip it.
 */
const VOLUME_FROM = 80;
/** The box overhangs the cell by this much, so a wall exactly on a cell boundary is caught. */
const VOLUME_MARGIN = 10;
/** Work per chunk before yielding to the browser. */
const CHUNK_MS = 8;
/** Margin of columns around the shapes' bounds. */
const MARGIN_CELLS = 1;

const _hit: GroundHit = { z: 0, normalZ: 0 };

export class NavGridBuildService {
  public build = async (world: StaticWorld, params: NavParams, onProgress?: (p: NavBuildProgress) => void): Promise<NavGrid> => {
    const b = world.bounds;
    const cell = params.cellSize;
    const originX = Math.floor(b.minX / cell) * cell - MARGIN_CELLS * cell;
    const originY = Math.floor(b.minY / cell) * cell - MARGIN_CELLS * cell;
    const cols = Math.ceil((b.maxX - originX) / cell) + MARGIN_CELLS;
    const rows = Math.ceil((b.maxY - originY) / cell) + MARGIN_CELLS;
    const builder = new NavGridBuilder(cols, rows, cell, originX, originY, params);
    const total = cols * rows;
    const topZ = b.maxZ + PROBE_ABOVE;
    const floorZ = world.killZ;

    let started = performance.now();
    for (let col = 0; col < total; col++) {
      const x = originX + ((col % cols) + 0.5) * cell;
      const y = originY + (Math.floor(col / cols) + 0.5) * cell;
      this.scanColumn(world, params, builder, col, x, y, topZ, floorZ);
      if (performance.now() - started > CHUNK_MS) {
        onProgress?.({ done: col + 1, total });
        await yieldToBrowser();
        started = performance.now();
      }
    }
    onProgress?.({ done: total, total });
    return builder.pack();
  };

  /** Top-down: every surface hit that is flat enough becomes a level. */
  private scanColumn(world: StaticWorld, params: NavParams, builder: NavGridBuilder, col: number, x: number, y: number, topZ: number, floorZ: number): void {
    let z = topZ;
    let lastLevelZ = Infinity;
    let levels = 0;
    for (let probe = 0; probe < params.maxLevels * 3 && z > floorZ; probe++) {
      if (!world.raycastDown(x, y, z, z - floorZ, _hit)) {
        break;
      }
      const hitZ = _hit.z;
      const normalZ = _hit.normalZ;
      z = hitZ - PROBE_BELOW;
      if (lastLevelZ - hitZ < params.minLevelGap) {
        continue;
      }
      // Walls, undersides and slopes past the marginal limit are not floors: kept as
      // NAV_STEEP markers for the wall/drop classification (see Nav.ts), then probe below.
      if (normalZ < params.marginalNormalZ) {
        builder.addLevel(col, hitZ, normalZ, NAV_STEEP);
        lastLevelZ = hitZ;
        if (++levels >= params.maxLevels) {
          break;
        }
        continue;
      }
      let flags = normalZ >= params.walkableNormalZ ? NAV_WALKABLE : NAV_MARGINAL;
      if (!world.headroom(x, y, hitZ + HEADROOM_FROM, params.tankHeight)) {
        flags |= NAV_LOW;
      } else {
        const half = params.cellSize / 2 + VOLUME_MARGIN;
        const height = params.tankHeight - VOLUME_FROM;
        if (world.probeBox(x, y, hitZ + VOLUME_FROM + height / 2, half, half, height / 2)) {
          flags |= NAV_LOW;
        }
      }
      builder.addLevel(col, hitZ, normalZ, flags);
      lastLevelZ = hitZ;
      if (++levels >= params.maxLevels) {
        break;
      }
    }
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export default NavGridBuildService;
