// Path requests and results between the brain and the pathfinder.
import type { Vec3Like } from '../TankCommand';
import type { CostLayer } from './Nav';

export interface PathRequest {
  from: Vec3Like;
  to: Vec3Like;
  /** Extra per-node costs to add (empty = plain shortest path). */
  layers?: CostLayer[];
  /** Search budget; beyond it the best partial path is returned. */
  maxNodes?: number;
}

export type PathStatus = 'ok' | 'partial' | 'unreachable';

export interface Path {
  status: PathStatus;
  /** Waypoints in world space, first = near `from`, last = `to` (or the closest reachable cell when partial). */
  points: Vec3Like[];
  /** Grid nodes the waypoints came from (same length as `points`). */
  nodes: number[];
  /** Accumulated edge cost. */
  cost: number;
}
