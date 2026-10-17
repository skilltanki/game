// The walkability grid in typed arrays: columns on a square lattice, each
// with its stack of levels (nodes), and per node up to 8 outgoing edges.
// Built once per map by NavGridBuildService + NavGraphService; read by the
// pathfinder on every request without allocating.
import { NAV_DIR_COUNT, NAV_LOW, NAV_MARGINAL, NAV_STEEP, NAV_WALKABLE, type NavParams } from '../../model/engine/Nav';
import type { Vec3Like } from '../../model/TankCommand';

export class NavGrid {
  /** First node index of each column; length cols*rows + 1. */
  readonly levelStart: Int32Array;
  readonly nodeCol: Int32Array;
  readonly nodeZ: Float32Array;
  readonly nodeNormalZ: Float32Array;
  readonly nodeFlags: Uint8Array;
  /** Cells to the nearest DROP (void, water, cliff) on the same level: 0 = the cell touches it. */
  readonly nodeClearance: Uint8Array;
  /** Cells to the nearest WALL (blocked or higher floor next door): 0 = touching it. */
  readonly nodeWallClearance: Uint8Array;
  /** Bit i set = a turret-height ray toward NAV_DIRS[i] is open for EXPOSURE_RANGE (0 = not measured). */
  readonly nodeOpenDirs: Uint8Array;
  /** Target node per (node * 8 + dir), -1 = no edge. */
  readonly edgeTarget: Int32Array;
  readonly edgeCost: Float32Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly cellSize: number,
    /** World x/y of the grid's min corner (column 0 spans originX..originX+cellSize). */
    readonly originX: number,
    readonly originY: number,
    readonly params: NavParams,
    levelStart: Int32Array,
    nodeCol: Int32Array,
    nodeZ: Float32Array,
    nodeNormalZ: Float32Array,
    nodeFlags: Uint8Array,
  ) {
    this.levelStart = levelStart;
    this.nodeCol = nodeCol;
    this.nodeZ = nodeZ;
    this.nodeNormalZ = nodeNormalZ;
    this.nodeFlags = nodeFlags;
    const n = nodeCol.length;
    this.nodeClearance = new Uint8Array(n);
    this.nodeWallClearance = new Uint8Array(n);
    this.nodeOpenDirs = new Uint8Array(n);
    this.edgeTarget = new Int32Array(n * NAV_DIR_COUNT).fill(-1);
    this.edgeCost = new Float32Array(n * NAV_DIR_COUNT);
  }

  get nodeCount(): number {
    return this.nodeCol.length;
  }

  // --- columns ---------------------------------------------------------------

  columnIndex(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) {
      return -1;
    }
    return r * this.cols + c;
  }

  columnOfPoint(x: number, y: number): number {
    return this.columnIndex(Math.floor((x - this.originX) / this.cellSize), Math.floor((y - this.originY) / this.cellSize));
  }

  colC(col: number): number {
    return col % this.cols;
  }

  colR(col: number): number {
    return Math.floor(col / this.cols);
  }

  /** World centre of a column. */
  colX(col: number): number {
    return this.originX + (this.colC(col) + 0.5) * this.cellSize;
  }

  colY(col: number): number {
    return this.originY + (this.colR(col) + 0.5) * this.cellSize;
  }

  // --- nodes -----------------------------------------------------------------

  /** The level of column `col` nearest to height z (within maxDz), or -1. */
  levelAt(col: number, z: number, maxDz: number): number {
    if (col < 0) {
      return -1;
    }
    let best = -1;
    let bestDz = maxDz;
    for (let node = this.levelStart[col]; node < this.levelStart[col + 1]; node++) {
      // Steep markers are for the graph build only (NAV_STEEP in Nav.ts).
      if ((this.nodeFlags[node] & NAV_STEEP) !== 0) continue;
      const dz = Math.abs(this.nodeZ[node] - z);
      if (dz <= bestDz) {
        bestDz = dz;
        best = node;
      }
    }
    return best;
  }

  /** Node under a world point: the nearest level by height (a tank sits ~50 above its floor). */
  nodeAt(x: number, y: number, z: number, maxDz = 200): number {
    return this.levelAt(this.columnOfPoint(x, y), z, maxDz);
  }

  /**
   * The level a HULL stands on (or would stand on) at a world point near
   * height z: the nearest by height within maxDz among the levels a hull
   * fits on — never one without headroom (NAV_LOW). The hollow under a ramp
   * slab is a NAV_LOW level 40-60 below the slab (atra_ii: every column of
   * the ramp), and at the ramp's foot the hull's height is nearer to it than
   * to the slab: nearest-by-height (nodeAt) picked the hollow, the drop guard
   * read "no floor ahead" and refused the only road on the map. With no such
   * level in range, the nearest of any kind, so a caller still sees the
   * underpass that really is too low.
   */
  standAt(x: number, y: number, z: number, maxDz = 200): number {
    const col = this.columnOfPoint(x, y);
    if (col < 0) return -1;
    let best = -1;
    let bestDz = maxDz;
    for (let node = this.levelStart[col]; node < this.levelStart[col + 1]; node++) {
      if ((this.nodeFlags[node] & (NAV_STEEP | NAV_LOW)) !== 0) continue;
      const dz = Math.abs(this.nodeZ[node] - z);
      if (dz <= bestDz) {
        bestDz = dz;
        best = node;
      }
    }
    return best >= 0 ? best : this.levelAt(col, z, maxDz);
  }

  nodeWorld(node: number, out: Vec3Like): Vec3Like {
    const col = this.nodeCol[node];
    out.x = this.colX(col);
    out.y = this.colY(col);
    out.z = this.nodeZ[node];
    return out;
  }

  /** A floor a tank may drive on (flat enough, headroom, not hugging a drop). */
  isFloor(node: number): boolean {
    const flags = this.nodeFlags[node];
    return (flags & (NAV_WALKABLE | NAV_MARGINAL)) !== 0 && (flags & NAV_LOW) === 0;
  }

  isPassable(node: number): boolean {
    return (
      node >= 0 &&
      this.isFloor(node) &&
      this.nodeClearance[node] >= this.params.minDropClearance &&
      this.nodeWallClearance[node] >= this.params.minWallClearance
    );
  }

  isMarginal(node: number): boolean {
    return (this.nodeFlags[node] & NAV_MARGINAL) !== 0;
  }

  edge(node: number, dir: number): number {
    return this.edgeTarget[node * NAV_DIR_COUNT + dir];
  }

  /** Nearest passable node to a point, searching rings of columns outward up to `radiusCells`. */
  nearestPassable(x: number, y: number, z: number, radiusCells = 6, maxDz = 400): number {
    const c0 = Math.floor((x - this.originX) / this.cellSize);
    const r0 = Math.floor((y - this.originY) / this.cellSize);
    let best = -1;
    let bestScore = Infinity;
    for (let ring = 0; ring <= radiusCells; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const col = this.columnIndex(c0 + dc, r0 + dr);
          if (col < 0) continue;
          for (let node = this.levelStart[col]; node < this.levelStart[col + 1]; node++) {
            if (!this.isPassable(node)) continue;
            const dz = Math.abs(this.nodeZ[node] - z);
            if (dz > maxDz) continue;
            const score = ring * this.cellSize + dz;
            if (score < bestScore) {
              bestScore = score;
              best = node;
            }
          }
        }
      }
      if (best >= 0) {
        return best;
      }
    }
    return best;
  }
}

/** Serialized form: plain numbers plus the typed arrays, as IndexedDB stores them. */
export interface NavGridRecord {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  params: NavParams;
  levelStart: Int32Array;
  nodeCol: Int32Array;
  nodeZ: Float32Array;
  nodeNormalZ: Float32Array;
  nodeFlags: Uint8Array;
  nodeClearance: Uint8Array;
  nodeWallClearance: Uint8Array;
  nodeOpenDirs: Uint8Array;
  edgeTarget: Int32Array;
  edgeCost: Float32Array;
}

export function serializeNavGrid(grid: NavGrid): NavGridRecord {
  return {
    cols: grid.cols,
    rows: grid.rows,
    cellSize: grid.cellSize,
    originX: grid.originX,
    originY: grid.originY,
    params: { ...grid.params },
    levelStart: grid.levelStart,
    nodeCol: grid.nodeCol,
    nodeZ: grid.nodeZ,
    nodeNormalZ: grid.nodeNormalZ,
    nodeFlags: grid.nodeFlags,
    nodeClearance: grid.nodeClearance,
    nodeWallClearance: grid.nodeWallClearance,
    nodeOpenDirs: grid.nodeOpenDirs,
    edgeTarget: grid.edgeTarget,
    edgeCost: grid.edgeCost,
  };
}

export function deserializeNavGrid(record: NavGridRecord): NavGrid {
  const grid = new NavGrid(record.cols, record.rows, record.cellSize, record.originX, record.originY, record.params, record.levelStart, record.nodeCol, record.nodeZ, record.nodeNormalZ, record.nodeFlags);
  grid.nodeClearance.set(record.nodeClearance);
  grid.nodeWallClearance.set(record.nodeWallClearance);
  if (record.nodeOpenDirs != null) grid.nodeOpenDirs.set(record.nodeOpenDirs);
  grid.edgeTarget.set(record.edgeTarget);
  grid.edgeCost.set(record.edgeCost);
  return grid;
}

/** Accumulates levels column by column, then packs them into a NavGrid. */
export class NavGridBuilder {
  private readonly levels: number[][];

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly cellSize: number,
    readonly originX: number,
    readonly originY: number,
    readonly params: NavParams,
  ) {
    this.levels = new Array(cols * rows);
  }

  /** Levels are expected top-down per column (as the probes find them). */
  addLevel(col: number, z: number, normalZ: number, flags: number): void {
    (this.levels[col] ??= []).push(z, normalZ, flags);
  }

  pack(): NavGrid {
    const columns = this.cols * this.rows;
    const levelStart = new Int32Array(columns + 1);
    let count = 0;
    for (let col = 0; col < columns; col++) {
      levelStart[col] = count;
      count += (this.levels[col]?.length ?? 0) / 3;
    }
    levelStart[columns] = count;
    const nodeCol = new Int32Array(count);
    const nodeZ = new Float32Array(count);
    const nodeNormalZ = new Float32Array(count);
    const nodeFlags = new Uint8Array(count);
    let node = 0;
    for (let col = 0; col < columns; col++) {
      const list = this.levels[col];
      if (list == null) continue;
      for (let i = 0; i < list.length; i += 3) {
        nodeCol[node] = col;
        nodeZ[node] = list[i];
        nodeNormalZ[node] = list[i + 1];
        nodeFlags[node] = list[i + 2];
        node++;
      }
    }
    return new NavGrid(this.cols, this.rows, this.cellSize, this.originX, this.originY, this.params, levelStart, nodeCol, nodeZ, nodeNormalZ, nodeFlags);
  }
}
