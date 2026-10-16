// Map reflection, step 2: join the levels of neighbouring columns into a
// graph a tank can drive (steps, slopes, one-way drops), measure every
// node's clearance from the nearest edge, and price the edges.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { NAV_DIRS, NAV_DIR_COUNT, NAV_STEEP } from '../../../../model/engine/Nav';

/** Clearance of nodes with no impassable cell anywhere near. */
const CLEARANCE_FAR = 255;
/** Cost factors. */
const MARGINAL_FACTOR = 3;
/** Edge-hugging: cost multiplier per missing cell of drop clearance below EDGE_COMFORT. */
const EDGE_COMFORT = 3;
const EDGE_FACTOR_PER_CELL = 1.5;
/** Wall-hugging cells (wall clearance <= 1) cost this much more: a 500-long hull clips corners there. */
const WALL_FACTOR = 3;
/** ...and the next ring (clearance 2) a little. */
const WALL_NEAR_FACTOR = 2.2;
/** Three cells from a wall is where a turning hull (half length 250) stops clipping it; still a little dearer than open ground. */
const WALL_THIRD_FACTOR = 1.2;
const DROP_PENALTY = 1;
const CLIMB_PER_UNIT = 0.5;
/** A bridge edge (over a one-cell hole in the collision) costs this much more than its length. */
const BRIDGE_FACTOR = 1.5;
/** A steep surface (NAV_STEEP) this far above the node at most still counts as a wall beside it. */
const STEEP_WALL_ABOVE = 1000;

/** What lies beyond a missing cardinal edge. */
const enum Beyond {
  Reachable,
  /** A floor exists next door at a height the hull cannot take: a wall, a lip, a blocked cell. */
  Wall,
  /** Nothing to drive onto: void, water, or a cliff deeper than stepDown. */
  Drop,
}

export class NavGraphService {
  public build = (grid: NavGrid): void => {
    this.linkCardinals(grid);
    this.measureClearance(grid);
    this.pruneImpassable(grid);
    this.linkDiagonals(grid);
    this.priceEdges(grid);
  };

  /** Classifies the neighbour column of a node when no edge joins them. */
  private beyond(grid: NavGrid, fromZ: number, col: number): Beyond {
    if (col < 0) {
      return Beyond.Drop;
    }
    const p = grid.params;
    let sawFloorNear = false;
    for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
      const dz = grid.nodeZ[node] - fromZ;
      if ((grid.nodeFlags[node] & NAV_STEEP) !== 0) {
        // A steep surface rising next door (its sample a cell's half-width in sits above
        // a step) is a wall; one falling away (a shore skirt, a cliff face) is a drop.
        if (dz > p.stepUp && dz <= STEEP_WALL_ABOVE) {
          sawFloorNear = true;
        }
        continue;
      }
      // Any level from a little below up to well above: something solid is there.
      if (dz >= -p.stepDown && dz <= p.tankHeight * 2) {
        sawFloorNear = true;
      }
    }
    return sawFloorNear ? Beyond.Wall : Beyond.Drop;
  }

  /** The level of `col` a tank at height z on a neighbouring column can drive onto, or -1. */
  private reachableLevel(grid: NavGrid, fromZ: number, col: number, dist: number): number {
    const p = grid.params;
    let best = -1;
    let bestDz = Infinity;
    for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
      if (!grid.isFloor(node)) continue;
      const dz = grid.nodeZ[node] - fromZ;
      const size = Math.abs(dz);
      const step = size <= p.stepUp;
      const slope = size / dist <= p.maxSlopeTan;
      const drop = dz < 0 && size <= p.stepDown;
      if (!(step || slope || drop)) continue;
      if (size < bestDz) {
        bestDz = size;
        best = node;
      }
    }
    return best;
  }

  private linkCardinals(grid: NavGrid): void {
    const cell = grid.cellSize;
    for (let node = 0; node < grid.nodeCount; node++) {
      if (!grid.isFloor(node)) continue;
      const col = grid.nodeCol[node];
      const c = grid.colC(col);
      const r = grid.colR(col);
      const z = grid.nodeZ[node];
      for (let dir = 0; dir < 4; dir++) {
        const [dc, dr] = NAV_DIRS[dir];
        const other = grid.columnIndex(c + dc, r + dr);
        if (other < 0) continue;
        let target = this.reachableLevel(grid, z, other, cell);
        if (target < 0 && this.isHole(grid, z, other)) {
          // Map collision often leaves a one-cell seam between a ramp plane and
          // the deck it meets; a 500-long hull bridges it, so the graph does too.
          const far = grid.columnIndex(c + dc * 2, r + dr * 2);
          if (far >= 0) {
            target = this.reachableLevel(grid, z, far, cell * 2);
            if (target >= 0 && !grid.isFloor(target)) target = -1;
          }
        }
        grid.edgeTarget[node * NAV_DIR_COUNT + dir] = target;
      }
    }
  }

  /** A column with nothing at deck height and nothing above it: a seam, not a wall. */
  private isHole(grid: NavGrid, fromZ: number, col: number): boolean {
    const p = grid.params;
    for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
      if ((grid.nodeFlags[node] & NAV_STEEP) !== 0) continue;
      const dz = grid.nodeZ[node] - fromZ;
      if (dz >= -p.stepUp && dz <= p.tankHeight * 2) {
        return false;
      }
    }
    return true;
  }

  /**
   * Two multi-source BFS over the cardinal edges: distance to the nearest
   * DROP (seeded by floor cells with a missing edge toward nothing) and to
   * the nearest WALL (missing edge toward a floor the hull cannot take).
   */
  private measureClearance(grid: NavGrid): void {
    const drop = grid.nodeClearance;
    const wall = grid.nodeWallClearance;
    drop.fill(CLEARANCE_FAR);
    wall.fill(CLEARANCE_FAR);
    const dropSeeds: number[] = [];
    const wallSeeds: number[] = [];
    for (let node = 0; node < grid.nodeCount; node++) {
      if (!grid.isFloor(node)) {
        drop[node] = 0;
        wall[node] = 0;
        continue;
      }
      const col = grid.nodeCol[node];
      const c = grid.colC(col);
      const r = grid.colR(col);
      for (let dir = 0; dir < 4; dir++) {
        if (grid.edgeTarget[node * NAV_DIR_COUNT + dir] >= 0) continue;
        const [dc, dr] = NAV_DIRS[dir];
        const kind = this.beyond(grid, grid.nodeZ[node], grid.columnIndex(c + dc, r + dr));
        if (kind === Beyond.Drop && drop[node] !== 0) {
          drop[node] = 0;
          dropSeeds.push(node);
        } else if (kind === Beyond.Wall && wall[node] !== 0) {
          wall[node] = 0;
          wallSeeds.push(node);
        }
      }
    }
    this.bfs(grid, drop, dropSeeds);
    this.bfs(grid, wall, wallSeeds);
  }

  private bfs(grid: NavGrid, field: Uint8Array, seeds: number[]): void {
    const queue = new Int32Array(grid.nodeCount);
    let head = 0;
    let tail = 0;
    for (const seed of seeds) queue[tail++] = seed;
    while (head < tail) {
      const node = queue[head++];
      const next = field[node] + 1;
      if (next >= CLEARANCE_FAR) continue;
      for (let dir = 0; dir < 4; dir++) {
        const other = grid.edgeTarget[node * NAV_DIR_COUNT + dir];
        if (other >= 0 && field[other] > next) {
          field[other] = next;
          queue[tail++] = other;
        }
      }
    }
  }

  /** Edges into nodes too close to an edge are dropped, so the pathfinder never visits them. */
  private pruneImpassable(grid: NavGrid): void {
    for (let node = 0; node < grid.nodeCount; node++) {
      for (let dir = 0; dir < 4; dir++) {
        const i = node * NAV_DIR_COUNT + dir;
        const other = grid.edgeTarget[i];
        if (other >= 0 && (!grid.isPassable(other) || !grid.isPassable(node))) {
          grid.edgeTarget[i] = -1;
        }
      }
    }
  }

  /** A diagonal needs both of its cardinal halves, so the hull never clips a corner. */
  private linkDiagonals(grid: NavGrid): void {
    const cell = grid.cellSize * Math.SQRT2;
    for (let node = 0; node < grid.nodeCount; node++) {
      if (!grid.isPassable(node)) continue;
      const col = grid.nodeCol[node];
      const c = grid.colC(col);
      const r = grid.colR(col);
      for (let dir = 4; dir < NAV_DIR_COUNT; dir++) {
        const [dc, dr] = NAV_DIRS[dir];
        const viaX = this.cardinalEdge(grid, node, dc, 0);
        const viaY = this.cardinalEdge(grid, node, 0, dr);
        if (viaX < 0 || viaY < 0) continue;
        const other = grid.columnIndex(c + dc, r + dr);
        if (other < 0) continue;
        const target = this.reachableLevel(grid, grid.nodeZ[node], other, cell);
        if (target >= 0 && grid.isPassable(target)) {
          grid.edgeTarget[node * NAV_DIR_COUNT + dir] = target;
        }
      }
    }
  }

  private cardinalEdge(grid: NavGrid, node: number, dc: number, dr: number): number {
    for (let dir = 0; dir < 4; dir++) {
      if (NAV_DIRS[dir][0] === dc && NAV_DIRS[dir][1] === dr) {
        return grid.edgeTarget[node * NAV_DIR_COUNT + dir];
      }
    }
    return -1;
  }

  private priceEdges(grid: NavGrid): void {
    const p = grid.params;
    for (let node = 0; node < grid.nodeCount; node++) {
      for (let dir = 0; dir < NAV_DIR_COUNT; dir++) {
        const i = node * NAV_DIR_COUNT + dir;
        const other = grid.edgeTarget[i];
        if (other < 0) continue;
        const dz = grid.nodeZ[other] - grid.nodeZ[node];
        // A bridge edge lands two columns away.
        const otherCol = grid.nodeCol[other];
        const dc = Math.abs(grid.colC(otherCol) - grid.colC(grid.nodeCol[node]));
        const dr = Math.abs(grid.colR(otherCol) - grid.colR(grid.nodeCol[node]));
        const bridge = dir < 4 && dc + dr > 1;
        const dist = (dir < 4 ? grid.cellSize : grid.cellSize * Math.SQRT2) * (bridge ? 2 : 1);
        let cost = bridge ? dist * BRIDGE_FACTOR : dist;
        if (grid.isMarginal(node) || grid.isMarginal(other)) cost *= MARGINAL_FACTOR;
        // Hugging an edge is allowed but dear, so open ground wins whenever there is some.
        const edge = grid.nodeClearance[other];
        if (edge < EDGE_COMFORT) cost *= 1 + (EDGE_COMFORT - edge) * EDGE_FACTOR_PER_CELL;
        const wallClr = grid.nodeWallClearance[other];
        if (wallClr <= 1) cost *= WALL_FACTOR;
        else if (wallClr === 2) cost *= WALL_NEAR_FACTOR;
        else if (wallClr === 3) cost *= WALL_THIRD_FACTOR;
        if (dz > 0) cost += dz * CLIMB_PER_UNIT;
        // A drop steeper than the slope limit is one-way: the tank falls, it cannot climb back.
        if (dz < -p.stepUp && -dz / dist > p.maxSlopeTan) cost += dist * DROP_PENALTY;
        grid.edgeCost[i] = cost;
      }
    }
  }
}

export default NavGraphService;
