// Places that matter: a defence post is cover near home with a view toward
// where the enemy comes from; an ambush post is cover beside the enemy's
// likely route with a view along it. Both are picked from the exposure
// masks, so a Shaft waits where it can see and not be seen from the side.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { CostLayer } from '../../../../model/engine/Nav';
import type { Rng } from '../../../../classes/engine/Rng';
import type { Vec3Like } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type PathfindingService from '../nav/PathfindingService';
import { dirIndexToward, openCount } from './ExposureService';

/** Defence posts sit this far from the pedestal. */
const POST_MIN = 900;
const POST_MAX = 2600;
/** Ambush posts sit this far beside the route. */
const AMBUSH_OFFSET_MIN = 300;
const AMBUSH_OFFSET_MAX = 900;
const CANDIDATES = 40;
/** Alternative route: cells within this of the primary route cost this much extra (edge cost ~100 per cell). */
const CORRIDOR_RADIUS = 700;
const CORRIDOR_COST = 700;
/** An alternative counts as different when some point of it is at least this far from the primary route. */
const ALTERNATIVE_APART = 1500;
/** ...and not absurdly longer. */
const ALTERNATIVE_MAX_STRETCH = 1.8;
const ROUTE_MAX_NODES = 60000;
/**
 * Chokepoint: a route point where the passable corridor across the route is
 * at most CHOKE_RELATIVE of the route's median width (and never more than
 * CHOKE_MAX_WIDTH cells): kolhoz runs 13-21 cells wide and pinches to 5-6
 * at two places, so an absolute threshold alone found nothing...
 */
const CHOKE_RELATIVE = 0.5;
const CHOKE_MAX_WIDTH = 8;
/** ...measured up to this many cells to each side, within the middle part of the route, one per this much route. */
const CHOKE_PROBE_CELLS = 10;
const CHOKE_FROM = 0.15;
const CHOKE_TO = 0.85;
const CHOKE_SPACING = 1500;

export class MapInsightService {
  private readonly pathfindingService = inject<PathfindingService>(TYPES.pathfindingService);

  private grid: NavGrid | null = null;
  /** Primary + alternative per direction key (see flagRoutes). */
  private readonly routeSets = new Map<string, Vec3Like[][]>();
  /** Chokepoints per direction key: index into the primary route and the corridor width there. */
  private readonly chokes = new Map<string, Array<{ index: number; width: number }>>();
  /** Posts are chosen once per battle per key (home, threat, slot) and validated as reachable from home. */
  private readonly posts = new Map<string, Vec3Like | null>();

  public attach = (grid: NavGrid | null): void => {
    this.grid = grid;
    this.routeSets.clear();
    this.chokes.clear();
    this.posts.clear();
  };

  /**
   * Narrow places on the shortest route from `from` to `to`: where the
   * passable corridor across the route (cells to the left plus to the right
   * at the route's height) is CHOKE_MAX_WIDTH or less. Local minima only,
   * in the middle of the route, spaced out. Ambush posts sit beside them.
   */
  public chokepoints = (from: Vec3Like, to: Vec3Like): Vec3Like[] => {
    const grid = this.grid;
    if (grid == null) return [];
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const route = this.flagRoutes(from, to)[0];
    if (route == null || route.length < 3) return [];
    let found = this.chokes.get(key);
    if (found == null) {
      found = [];
      const widths: number[] = route.map((_, i) => this.corridorWidth(grid, route, i));
      const sorted = [...widths].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const threshold = Math.min(CHOKE_MAX_WIDTH, Math.floor(median * CHOKE_RELATIVE));
      const total = routeLength(route);
      let along = 0;
      let lastAt = -Infinity;
      for (let i = 1; i < route.length - 1; i++) {
        along += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
        const f = along / Math.max(1, total);
        if (f < CHOKE_FROM || f > CHOKE_TO) continue;
        const w = widths[i];
        if (w > threshold || w > widths[i - 1] || w > widths[i + 1]) continue;
        if (along - lastAt < CHOKE_SPACING) continue;
        found.push({ index: i, width: w });
        lastAt = along;
      }
      this.chokes.set(key, found);
    }
    return found.map((c) => ({ ...route[c.index] }));
  };

  /** Passable cells across the route at point `i`: left count + right count + 1, capped by the probe reach. */
  private corridorWidth(grid: NavGrid, route: Vec3Like[], i: number): number {
    const p = route[i];
    const q = route[Math.min(route.length - 1, i + 1)];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let width = 1;
    for (const side of [1, -1]) {
      for (let k = 1; k <= CHOKE_PROBE_CELLS; k++) {
        const node = grid.standAt(p.x + nx * side * k * grid.cellSize, p.y + ny * side * k * grid.cellSize, p.z, 250);
        if (node < 0 || !grid.isPassable(node)) break;
        width++;
      }
    }
    return width;
  }

  /**
   * The shortest route and, when the map offers one, a second route that
   * stays a corridor away from it: the primary gets a cost band around it and
   * the search runs again. Attackers spread over them; a carrier takes the one
   * farther from fresh sightings.
   */
  public flagRoutes = (from: Vec3Like, to: Vec3Like): Vec3Like[][] => {
    const grid = this.grid;
    if (grid == null) return [];
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const cached = this.routeSets.get(key);
    if (cached != null) return cached;
    const primary = this.pathfindingService.find({ from, to, maxNodes: ROUTE_MAX_NODES });
    const set: Vec3Like[][] = [];
    if (primary.status === 'ok' && primary.points.length >= 2) {
      set.push(primary.points);
      const layer: CostLayer = new Float32Array(grid.nodeCount);
      const cell = grid.cellSize;
      const reach = Math.ceil(CORRIDOR_RADIUS / cell);
      for (const p of primary.points) {
        const c0 = Math.floor((p.x - grid.originX) / cell);
        const r0 = Math.floor((p.y - grid.originY) / cell);
        for (let dc = -reach; dc <= reach; dc++) {
          for (let dr = -reach; dr <= reach; dr++) {
            if (Math.hypot(dc, dr) * cell > CORRIDOR_RADIUS) continue;
            const col = grid.columnIndex(c0 + dc, r0 + dr);
            if (col < 0) continue;
            for (let node = grid.levelStart[col]; node < grid.levelStart[col + 1]; node++) {
              layer[node] = CORRIDOR_COST;
            }
          }
        }
      }
      const alternative = this.pathfindingService.find({ from, to, layers: [layer], maxNodes: ROUTE_MAX_NODES });
      if (alternative.status === 'ok' && alternative.points.length >= 2) {
        const apart = Math.max(...alternative.points.map((q) => Math.min(...primary.points.map((p) => Math.hypot(p.x - q.x, p.y - q.y)))));
        const stretch = routeLength(alternative.points) / Math.max(1, routeLength(primary.points));
        if (apart >= ALTERNATIVE_APART && stretch <= ALTERNATIVE_MAX_STRETCH) {
          set.push(alternative.points);
        }
      }
    }
    this.routeSets.set(key, set);
    return set;
  };

  /** True when a path exists from `from` to the node. */
  private reachable(from: Vec3Like, node: number): boolean {
    const grid = this.grid;
    if (grid == null) return false;
    const start = grid.nearestPassable(from.x, from.y, from.z, 8, 600);
    if (start < 0) return false;
    return this.pathfindingService.findNodes(start, node, [], 20000).status === 'ok';
  }

  /**
   * Cover near `home` that looks toward `threatFrom`: among random passable
   * cells in the ring, the one with the fewest open directions that still
   * has the direction toward the threat open. `slot` spreads several
   * defenders over different posts.
   */
  public defencePost = (home: Vec3Like, threatFrom: Vec3Like, slot: number, rng: Rng, out: Vec3Like): boolean => {
    const grid = this.grid;
    if (grid == null) return false;
    const key = `d|${Math.round(home.x)},${Math.round(home.y)}|${Math.round(threatFrom.x)},${Math.round(threatFrom.y)}|${slot}`;
    const cached = this.posts.get(key);
    if (cached !== undefined) {
      if (cached == null) return false;
      Object.assign(out, cached);
      return true;
    }
    const toward = dirIndexToward(threatFrom.x - home.x, threatFrom.y - home.y);
    const picks: Array<{ node: number; score: number }> = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const range = rng.range(POST_MIN, POST_MAX);
      const node = grid.nearestPassable(home.x + Math.cos(angle) * range, home.y + Math.sin(angle) * range, home.z, 2, 1200);
      if (node < 0) continue;
      const mask = grid.nodeOpenDirs[node];
      if (mask === 0 || (mask & (1 << toward)) === 0) continue;
      // Fewer open sides = better cover; closer to the approach side = better.
      const w = grid.nodeWorld(node, { x: 0, y: 0, z: 0 });
      const facing = ((w.x - home.x) * (threatFrom.x - home.x) + (w.y - home.y) * (threatFrom.y - home.y)) / (Math.hypot(w.x - home.x, w.y - home.y) * Math.hypot(threatFrom.x - home.x, threatFrom.y - home.y) || 1);
      picks.push({ node, score: openCount(mask) - facing * 2 });
    }
    picks.sort((a, b) => a.score - b.score);
    // The slot-th best that is actually reachable from home.
    let taken = 0;
    for (const pick of picks) {
      if (!this.reachable(home, pick.node)) continue;
      if (taken++ < slot) continue;
      grid.nodeWorld(pick.node, out);
      this.posts.set(key, { x: out.x, y: out.y, z: out.z });
      return true;
    }
    this.posts.set(key, null);
    return false;
  };

  /** Cover beside the enemy's route from `from` to `to`, between 35 % and 65 % of the way. */
  public ambushPost = (from: Vec3Like, to: Vec3Like, rng: Rng, out: Vec3Like): boolean => {
    const grid = this.grid;
    if (grid == null) return false;
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const postKey = `a|${key}`;
    const cached = this.posts.get(postKey);
    if (cached !== undefined) {
      if (cached == null) return false;
      Object.assign(out, cached);
      return true;
    }
    const route = this.flagRoutes(from, to)[0] ?? [];
    if (route.length < 3) return false;
    // Beside a chokepoint when the route has one: the enemy has to come through it.
    const chokeIdx = (this.chokes.get(key) ?? (this.chokepoints(from, to), this.chokes.get(key)) ?? []).map((c) => c.index);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < CANDIDATES; i++) {
      const idx = chokeIdx.length > 0 && i < CANDIDATES * 0.7
        ? Math.max(0, Math.min(route.length - 1, rng.pick(chokeIdx) + Math.round(rng.range(-2, 2))))
        : Math.floor(route.length * rng.range(0.35, 0.65));
      const p = route[idx];
      const q = route[Math.min(route.length - 1, idx + 1)];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      const off = rng.range(AMBUSH_OFFSET_MIN, AMBUSH_OFFSET_MAX) * side;
      const node = grid.nearestPassable(p.x + (-dy / len) * off, p.y + (dx / len) * off, p.z, 2, 600);
      if (node < 0) continue;
      const mask = grid.nodeOpenDirs[node];
      if (mask === 0) continue;
      const w = grid.nodeWorld(node, { x: 0, y: 0, z: 0 });
      const towardRoute = dirIndexToward(p.x - w.x, p.y - w.y);
      if ((mask & (1 << towardRoute)) === 0) continue;
      const score = openCount(mask);
      if (score < bestScore && this.reachable(to, node)) {
        bestScore = score;
        best = node;
      }
    }
    if (best < 0) {
      this.posts.set(postKey, null);
      return false;
    }
    grid.nodeWorld(best, out);
    this.posts.set(postKey, { x: out.x, y: out.y, z: out.z });
    return true;
  };
}

function routeLength(points: Vec3Like[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

export default MapInsightService;
