// A* over the walkability graph. All scratch arrays are sized to the grid
// once and reused with a generation stamp, so a request allocates nothing
// but the resulting waypoint list.
import { BinaryHeap } from '../../../../classes/engine/BinaryHeap';
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { NAV_DIR_COUNT } from '../../../../model/engine/Nav';
import type { Path, PathRequest } from '../../../../model/engine/Path';
import type { Vec3Like } from '../../../../model/TankCommand';

/**
 * Expansion budget. A* with a consistent heuristic expands each node at most
 * once, so a budget below the passable count can cut off a reachable goal:
 * babylon (53 000 passable) read as 91 % spawn-to-spawn reachable under
 * 20 000 although every spawn sits in one region. 60 000 covers every map.
 */
const DEFAULT_MAX_NODES = 60000;
/** Height weighs this much against horizontal distance in the heuristic. */
const HEIGHT_WEIGHT = 0.5;

export class PathfindingService {
  private grid: NavGrid | null = null;
  private gScore = new Float32Array(0);
  private hScore = new Float32Array(0);
  private parent = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private generation = 1;
  private readonly open = new BinaryHeap(4096);

  public attach = (grid: NavGrid | null): void => {
    this.grid = grid;
    const n = grid?.nodeCount ?? 0;
    this.gScore = new Float32Array(n);
    this.hScore = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.generation = 1;
  };

  /** Shortest path between the passable nodes nearest the request's end points. */
  public find = (request: PathRequest): Path => {
    const grid = this.grid;
    if (grid == null) {
      return { status: 'unreachable', points: [], nodes: [], cost: 0 };
    }
    const start = grid.nearestPassable(request.from.x, request.from.y, request.from.z);
    const goal = grid.nearestPassable(request.to.x, request.to.y, request.to.z);
    if (start < 0 || goal < 0) {
      return { status: 'unreachable', points: [], nodes: [], cost: 0 };
    }
    return this.search(grid, start, goal, request.layers ?? [], request.maxNodes ?? DEFAULT_MAX_NODES);
  };

  public findNodes = (start: number, goal: number, layers: Float32Array[] = [], maxNodes = DEFAULT_MAX_NODES): Path => {
    const grid = this.grid;
    if (grid == null || start < 0 || goal < 0) {
      return { status: 'unreachable', points: [], nodes: [], cost: 0 };
    }
    return this.search(grid, start, goal, layers, maxNodes);
  };

  private search(grid: NavGrid, start: number, goal: number, layers: Float32Array[], maxNodes: number): Path {
    const gen = ++this.generation;
    const { gScore, hScore, parent, stamp, closed, open } = this;
    open.clear();
    const goalCol = grid.nodeCol[goal];
    const goalC = grid.colC(goalCol);
    const goalR = grid.colR(goalCol);
    const goalZ = grid.nodeZ[goal];
    const heuristic = (node: number): number => {
      const col = grid.nodeCol[node];
      const dc = Math.abs(grid.colC(col) - goalC);
      const dr = Math.abs(grid.colR(col) - goalR);
      const octile = (Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)) * grid.cellSize;
      return octile + Math.abs(grid.nodeZ[node] - goalZ) * HEIGHT_WEIGHT;
    };
    stamp[start] = gen;
    gScore[start] = 0;
    hScore[start] = heuristic(start);
    parent[start] = -1;
    open.push(start, hScore[start]);
    let best = start;
    let bestH = hScore[start];
    let expanded = 0;
    let found = false;
    while (open.size > 0) {
      const node = open.pop();
      if (closed[node] === gen) continue;
      closed[node] = gen;
      if (node === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;
      const g = gScore[node];
      const base = node * NAV_DIR_COUNT;
      for (let dir = 0; dir < NAV_DIR_COUNT; dir++) {
        const other = grid.edgeTarget[base + dir];
        if (other < 0 || closed[other] === gen) continue;
        let cost = grid.edgeCost[base + dir];
        for (let l = 0; l < layers.length; l++) {
          cost += layers[l][other];
        }
        const tentative = g + cost;
        if (stamp[other] !== gen || tentative < gScore[other]) {
          stamp[other] = gen;
          gScore[other] = tentative;
          parent[other] = node;
          const h = heuristic(other);
          hScore[other] = h;
          if (h < bestH) {
            bestH = h;
            best = other;
          }
          open.push(other, tentative + h);
        }
      }
    }
    const end = found ? goal : best;
    const nodes: number[] = [];
    for (let node = end; node >= 0; node = parent[node]) {
      nodes.push(node);
    }
    nodes.reverse();
    const points: Vec3Like[] = nodes.map((node) => grid.nodeWorld(node, { x: 0, y: 0, z: 0 }));
    return { status: found ? 'ok' : nodes.length > 1 ? 'partial' : 'unreachable', points, nodes, cost: gScore[end] };
  }
}

export default PathfindingService;
