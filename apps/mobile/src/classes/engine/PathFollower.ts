// Per-bot path-following state: the path being driven, how far along it
// the bot is, and when/why it was planned, so the follower can decide when
// to re-plan. Pure data; PathFollowService does the driving.
import type { Path } from '../../model/engine/Path';
import type { Vec3Like } from '../../model/TankCommand';

export class PathFollower {
  path: Path | null = null;
  /** Index of the waypoint currently being pursued. */
  index = 0;
  /** Where the path was asked to go (world), to detect a moved goal. */
  readonly goal: Vec3Like = { x: 0, y: 0, z: 0 };
  hasGoal = false;
  /** Sim time of the last plan, for the periodic re-plan. */
  plannedAt = -Infinity;
  /** Sim time since which the hull has been far from the path (0 = on it). */
  offPathSince = 0;
  /** Sim time until which path requests are suppressed after a failure. */
  retryAfter = 0;

  reset(): void {
    this.path = null;
    this.index = 0;
    this.hasGoal = false;
    this.plannedAt = -Infinity;
    this.offPathSince = 0;
    this.retryAfter = 0;
  }

  setPath(path: Path, goal: Vec3Like, now: number): void {
    this.path = path;
    this.index = 0;
    this.goal.x = goal.x;
    this.goal.y = goal.y;
    this.goal.z = goal.z;
    this.hasGoal = true;
    this.plannedAt = now;
    this.offPathSince = 0;
  }
}
