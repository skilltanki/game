// Dijkstra from a set of seed nodes over the walkability graph: for every
// node, the path cost to the nearest seed. One field per "place that
// matters" (a flag base, a spawn cluster) answers "who is closer BY ROAD"
// in O(1), which the role auction and interception need every second.
import { BinaryHeap } from '../../../../classes/engine/BinaryHeap';
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { NAV_DIR_COUNT } from '../../../../model/engine/Nav';

export class DistanceFieldService {
  private readonly open = new BinaryHeap(4096);

  public compute = (grid: NavGrid, seeds: number[]): Float32Array => {
    const dist = new Float32Array(grid.nodeCount).fill(Infinity);
    const open = this.open;
    open.clear();
    for (const seed of seeds) {
      if (seed >= 0 && grid.isPassable(seed)) {
        dist[seed] = 0;
        open.push(seed, 0);
      }
    }
    while (open.size > 0) {
      const node = open.pop();
      const d = dist[node];
      const base = node * NAV_DIR_COUNT;
      for (let dir = 0; dir < NAV_DIR_COUNT; dir++) {
        const other = grid.edgeTarget[base + dir];
        if (other < 0) continue;
        const next = d + grid.edgeCost[base + dir];
        if (next < dist[other]) {
          dist[other] = next;
          open.push(other, next);
        }
      }
    }
    return dist;
  };
}

export default DistanceFieldService;
