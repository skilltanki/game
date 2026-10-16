// Drives a hull along a planned path with pure pursuit: aim at a point a
// little way ahead on the path, steer proportionally, slow for sharp
// turns and narrow cells, back up when the next point is behind.
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { BotPerception } from '../../../../model/Perception';
import type { Vec3Like } from '../../../../model/TankCommand';

export interface SteerResult {
  move: number;
  turn: number;
}

export interface FollowResult extends SteerResult {
  /** The last waypoint is within the arrive radius. */
  arrived: boolean;
  /** Flat distance from the hull to the nearest path segment. */
  offPath: number;
}

/** A waypoint counts as passed inside this radius. */
const WAYPOINT_RADIUS = 160;
/** Pure pursuit lookahead: base + speed term, clamped. */
const LOOKAHEAD_MIN = 300;
/** 700 was tried: faster on kolhoz, but it cut corners over drop cells on island (drownings 0-1 -> 2-3 per 180 s). */
const LOOKAHEAD_MAX = 500;
const LOOKAHEAD_PER_SPEED = 0.4;
/** Heading tolerance before the hull steers. */
const STEER_DEAD_ZONE = 0.08;
/** Full lock beyond this heading error. */
const STEER_FULL_LOCK = 0.7;
/**
 * Turning: measured on kolhoz, a STATIONARY hull pivots at only 0.15 rad/s
 * (tracks barely bite), while a hull under throttle turns at 1.4 rad/s. So a
 * large heading error is never fixed in place: the hull turns under a
 * reduced throttle (PIVOT_THROTTLE scales acceleration, so the arc stays
 * tight while it is still slow) with full lock, until the error is under
 * PIVOT_EXIT. The speed governor below keeps that arc off shores and walls.
 */
const PIVOT_ENTER = 0.8;
const PIVOT_EXIT = 0.25;
const PIVOT_THROTTLE = 0.5;
/** On an edge cell the pivot arc must stay tight: less throttle. */
const PIVOT_THROTTLE_EDGE = 0.3;
/** Ease the throttle (acceleration) while still turning noticeably. */
const HARD_TURN = 0.5;
const HARD_TURN_THROTTLE = 0.7;
/**
 * J-turn: when the next point is this far behind, back out with the tail
 * steering toward it instead of pivoting on the spot for three seconds (a
 * carrier that has just grabbed a flag at the enemy base cannot afford to
 * stand still). The hull swings round while moving; once the error drops
 * under this the forward branch takes over.
 */
const REVERSE_BEYOND = (120 * Math.PI) / 180;
/** Reverse throttle for the J-turn (−1 ran the tail into the water on island). */
const REVERSE_THROTTLE = -0.6;
/** No J-turn within this many cells of a drop. */
const REVERSE_CLEARANCE = 2;
/**
 * Speed governor near drops: throttle does not cap speed, so on a cell
 * within NARROW_CELLS of an edge the throttle is cut whenever the hull is
 * faster than NARROW_SPEED (it coasts), and restored below it.
 */
const NARROW_CELLS = 1;
const NARROW_SPEED = 260;
/** Near a wall (not deadly, just a scrape) the cap is looser: measured on kolhoz, 260 made the bots crawl along every fence. */
const WALL_SPEED = 480;
/** Near a wall (wall clearance <= this) the lookahead shrinks so the hull tracks the corridor instead of cutting it. */
const WALL_CELLS = 2;

const _target: Vec3Like = { x: 0, y: 0, z: 0 };

export class PathFollowService {
  public follow = (perception: BotPerception, memory: BotMemory, grid: NavGrid | null, arriveRadius: number): FollowResult | null => {
    const follower = memory.follower;
    const path = follower.path;
    if (path == null || path.points.length === 0) {
      return null;
    }
    const self = perception.self;
    const pos = self.position;
    const points = path.points;
    const last = points.length - 1;

    // Pass waypoints as the hull reaches them (never the last one: it is the goal).
    while (follower.index < last && flatDistance(pos, points[follower.index]) < WAYPOINT_RADIUS) {
      follower.index++;
    }
    const remaining = flatDistance(pos, points[last]);
    if (follower.index >= last && remaining <= arriveRadius) {
      return { move: 0, turn: 0, arrived: true, offPath: 0 };
    }

    const speed = Math.hypot(self.velocity.x, self.velocity.y);
    const here = grid != null ? grid.nodeAt(pos.x, pos.y, pos.z) : -1;
    const nearWall = here >= 0 && grid != null && grid.nodeWallClearance[here] <= WALL_CELLS;
    const nearDrop = here >= 0 && grid != null && grid.nodeClearance[here] <= NARROW_CELLS;
    const reverseOk = here >= 0 && grid != null && grid.nodeClearance[here] > REVERSE_CLEARANCE;
    const lookahead = nearWall || nearDrop ? LOOKAHEAD_MIN : Math.min(LOOKAHEAD_MAX, LOOKAHEAD_MIN + speed * LOOKAHEAD_PER_SPEED);
    this.pointAhead(points, follower.index, pos, lookahead, _target);
    const offPath = this.distanceToPath(points, Math.max(0, follower.index - 1), pos);

    const error = self.headingErrorTo(_target);
    const size = Math.abs(error);
    const distance = flatDistance(pos, _target);
    let move: number;
    let turn: number;
    if (size > REVERSE_BEYOND && reverseOk) {
      // Target behind: back toward it (never on an edge cell: the tail went into
      // the water twice on island). The tail must swing onto it, and
      // +turn always yaws the hull counter-clockwise, so steer by the TAIL's error.
      const back = Math.atan2(Math.sin(error + Math.PI), Math.cos(error + Math.PI));
      turn = this.gain(back);
      move = REVERSE_THROTTLE;
      memory.pivoting = false;
    } else {
      turn = this.gain(error);
      if (memory.pivoting ? size < PIVOT_EXIT : size > PIVOT_ENTER) {
        memory.pivoting = !memory.pivoting;
      }
      move = memory.pivoting ? (nearDrop ? PIVOT_THROTTLE_EDGE : PIVOT_THROTTLE) : size > HARD_TURN ? HARD_TURN_THROTTLE : 1;
      if (memory.pivoting) turn = error > 0 ? 1 : -1;
      if (grid != null && move > 0 && here >= 0) {
        const nearDrop = grid.nodeClearance[here] <= NARROW_CELLS;
        if ((nearDrop && speed > NARROW_SPEED) || (nearWall && speed > WALL_SPEED)) {
          move = 0;
        }
      }
    }
    return { move, turn, arrived: false, offPath };
  };

  /** -1..1 turn toward a heading error (+1 = left, the chassis convention). */
  private gain(error: number): number {
    const size = Math.abs(error);
    if (size < STEER_DEAD_ZONE) {
      return 0;
    }
    const gain = Math.min(1, size / STEER_FULL_LOCK);
    return error > 0 ? gain : -gain;
  }

  /** The point `lookahead` along the path from the hull's projection near waypoint `index`. */
  private pointAhead(points: Vec3Like[], index: number, pos: Vec3Like, lookahead: number, out: Vec3Like): void {
    let budget = lookahead;
    let from: Vec3Like = pos;
    for (let i = index; i < points.length; i++) {
      const to = points[i];
      const segment = flatDistance(from, to);
      if (segment >= budget || i === points.length - 1) {
        const t = segment > 0 ? Math.min(1, budget / segment) : 1;
        out.x = from.x + (to.x - from.x) * t;
        out.y = from.y + (to.y - from.y) * t;
        out.z = from.z + (to.z - from.z) * t;
        return;
      }
      budget -= segment;
      from = to;
    }
    const end = points[points.length - 1];
    out.x = end.x;
    out.y = end.y;
    out.z = end.z;
  }

  private distanceToPath(points: Vec3Like[], from: number, pos: Vec3Like): number {
    let best = Infinity;
    const end = Math.min(points.length - 1, from + 3);
    for (let i = from; i < end; i++) {
      best = Math.min(best, segmentDistance(points[i], points[i + 1], pos));
    }
    if (best === Infinity) {
      best = flatDistance(pos, points[Math.min(from, points.length - 1)]);
    }
    return best;
  }
}

export function flatDistance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentDistance(a: Vec3Like, b: Vec3Like, p: Vec3Like): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y);
}

export default PathFollowService;
