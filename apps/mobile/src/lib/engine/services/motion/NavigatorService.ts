// Turns an objective into hull movement, by road: plan a path over the
// grid to where the objective points, follow it, re-plan when the goal
// moves or the hull strays, back out when stuck, and — as the very last
// guard — never drive into a drop the grid did not know about.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { Rng } from '../../../../classes/engine/Rng';
import type { Objective } from '../../../../model/Objective';
import type { BotPerception, TankView } from '../../../../model/Perception';
import type { Vec3Like } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type PathfindingService from '../nav/PathfindingService';
import type PathSmoothingService from '../nav/PathSmoothingService';
import type NavQueryService from '../nav/NavQueryService';
import type PathFollowService from './PathFollowService';
import { flatDistance, type SteerResult } from './PathFollowService';
import type StuckRecoveryService from './StuckRecoveryService';
import type LocalAvoidanceService from './LocalAvoidanceService';
import type LearnedBlockService from '../nav/LearnedBlockService';
import { NAV_DIR_COUNT, type CostLayer } from '../../../../model/engine/Nav';
import type { NavGrid } from '../../../../classes/engine/NavGrid';

const CHASE_STOP_DISTANCE = 1300;
/**
 * Vantage: the gun cannot elevate past this (GameTank.MAX_GUN_ELEVATION), so a
 * target below a ledge or up a bank within VANTAGE_NEAR is unshootable from
 * here; after VANTAGE_AFTER_MS without a shot the bot looks for a reachable
 * spot VANTAGE_MIN..VANTAGE_MAX from the target with a line of sight at a
 * shootable angle, and drives there instead of staring down the edge.
 */
const MAX_FIRE_ELEVATION = (20 * Math.PI) / 180;
const VANTAGE_ELEVATION = (16 * Math.PI) / 180;
const VANTAGE_NEAR = 2600;
const VANTAGE_AFTER_MS = 2500;
const VANTAGE_MIN = 700;
const VANTAGE_MAX = 2200;
const VANTAGE_TRIES = 10;
const VANTAGE_TTL_MS = 5000;
/**
 * Flank: a chase to a last-seen point held behind a teammate (the avoidance
 * decided the hull's move) for this long approaches from another side — a
 * vantage-like spot around the point — instead of queueing. Babylon TDM: a
 * column of five on the ramp, the front one shooting, the rest "avoid-tank"
 * behind it because the sighting they chased sat right behind the front hull.
 */
const FLANK_AFTER_MS = 2500;
const FLANK_ARRIVE = 250;
const FLANK_KEY = 'flank';
const EYE_HEIGHT = 120;
const CHASE_RESUME_DISTANCE = 1800;
/** Keep-away band against a buffed enemy. */
const KEEP_AWAY_DISTANCE = 2600;
const BACK_OFF_DISTANCE = 2000;
const HARD_TURN = 0.9;
/** Re-plan when the goal moved this far from where the path was planned to. */
const GOAL_MOVED = 500;
/** Re-plan period for a moving goal (hunt) and a fixed one. */
const REPLAN_MOVING_MS = 1000;
const REPLAN_FIXED_MS = 4000;
/** Off the path by this much for this long: re-plan. */
const OFF_PATH = 300;
const OFF_PATH_MS = 800;
/** After a failed request, wait this long before asking again. */
const RETRY_MS = 1000;
/**
 * Without a path the hull drives straight at the goal only while the grid
 * line to it (this far at most) is floor off the walls; otherwise it stands
 * (kolhoz: a hunter with its target behind a cabin ran at the wall, backed
 * off on the guard's veto and ran again — the "straight / follow" shuttle).
 */
const STRAIGHT_MAX = 1500;
const STRAIGHT_STEP = 100;
/** Gap threading: a wall on the near probe dead ahead is first tried this much to either side (rad) before backing off; on success the hull crawls into the gap with a gentle turn. */
const THREAD_ANGLES = [0.2, -0.2, 0.4, -0.4];
const THREAD_TURN = 0.6;
const THREAD_THROTTLE = 0.4;
const THREAD_HOLD_MS = 300;
/**
 * Jink: at the hold distance a mobile hunter (persona.mobility) shuffles
 * sideways instead of standing — legs of JINK_LEG along the tangent to the
 * target, alternating, each checked on the grid; the hull drives forward
 * or in reverse along its own axis (no pivot), the turret aims on its own.
 */
const JINK_LEG = 650;
const JINK_LEG_MS = 1500;
const JINK_THROTTLE = 0.8;
/** Drift back toward this distance from the target while jinking. */
const JINK_DISTANCE = 1100;
/** Search budget with cost layers (threat discs make A* expand much more before the detour is found). */
const LAYERED_MAX_NODES = 80000;
/** Roam target distance band. */
const ROAM_MIN = 1500;
const ROAM_MAX = 4500;
const ROAM_STALE_MS = 9000;
/** Ground probes ahead of the hull (sim units; 1 m = 100). */
const PROBE_DISTANCE = 500;
const PROBE_NEAR = 260;
const SLIDE_SPEED = 120;
const BRAKE_SPEED = 350;
const PROBE_ANGLE = 0.6;
const PROBE_UP = 300;
const PROBE_DROP = 450;
/**
 * Grid guard: a probe point must sit on a floor within GUARD_DZ_BASE plus
 * the drop a 50 deg slope would make over the probe distance (a ramp 600
 * ahead is 360 lower, and still a floor)...
 */
const GUARD_DZ_BASE = 150;
const GUARD_DZ_PER_UNIT = 1.2;
/** ...that is at least this many cells from void or a wall (1 = the hull centre stays >= 150 away). */
const GUARD_CLEARANCE = 1;
/** See groundStep: throttle of the off-grid crawl. */
const GROUND_STEP_THROTTLE = 0.35;
/**
 * Hull corners: the front corners sit (±150, 250) from the centre, so a cell
 * 330 out at ±0.5 rad is where a corner lands next. A corner over a wall
 * cell means the fence is about to be clipped (the stuck logger put most
 * kolhoz jams there), so the hull turns away from that side and eases off.
 */
const CORNER_DISTANCE = 330;
const CORNER_ANGLE = 0.5;
const CORNER_THROTTLE = 0.4;
/** A corner cell must be reachable from the hull's own cell within this many grid edges (330 ≈ 3-4 cells). */
const CORNER_REACH_EDGES = 5;
/** Side probes: beside the hull's middle (half width 150) at ±1.25 rad, 230 out. */
const SIDE_DISTANCE = 230;
const SIDE_ANGLE = 1.25;
const SIDE_THROTTLE = 0.6;

const STEER_DEAD_ZONE = 0.12;
/**
 * A guard veto (wall or drop ahead) repeated VETO_LIMIT times within
 * VETO_WINDOW_MS within VETO_RADIUS of the first one is a path that keeps
 * leading into the same gap (the owner's bot shuttling in and out of a slot
 * between two cabins): the spot ahead is marked as a learned block and the
 * path is replanned round it.
 */
const VETO_LIMIT = 3;
const VETO_WINDOW_MS = 4000;
const VETO_RADIUS = 400;
const VETO_MARK_AHEAD = 300;
/** Arc probe: with |turn| above ARC_TURN the far probe is repeated ARC_ANGLE off the nose toward the turn. */
const ARC_TURN = 0.3;
const ARC_ANGLE = 0.5;
const ARC_FAR_FRACTION = 0.7;
/** At this much lock the hull pivots: the near fan toward the turn (ARC_ANGLE and 2×ARC_ANGLE) must be floor too. */
const PIVOT_TURN = 0.9;

export interface NavigatorHooks {
  onPathRequest?: (ok: boolean) => void;
  onPath?: (actorId: string, points: Vec3Like[]) => void;
}

export class NavigatorService {
  private readonly pathfindingService = inject<PathfindingService>(TYPES.pathfindingService);
  private readonly pathSmoothingService = inject<PathSmoothingService>(TYPES.pathSmoothingService);
  private readonly navQueryService = inject<NavQueryService>(TYPES.navQueryService);
  private readonly pathFollowService = inject<PathFollowService>(TYPES.pathFollowService);
  private readonly stuckRecoveryService = inject<StuckRecoveryService>(TYPES.stuckRecoveryService);
  private readonly localAvoidanceService = inject<LocalAvoidanceService>(TYPES.localAvoidanceService);
  private readonly learnedBlockService = inject<LearnedBlockService>(TYPES.learnedBlockService);
  /** Cost layers for the path requests of the bot currently being steered. */
  private layers: CostLayer[] = [];

  private hooks: NavigatorHooks = {};

  /** di-kit hands out accessors, so hooks are SET through a method, never assigned as a field. */
  public setHooks = (hooks: NavigatorHooks): void => {
    this.hooks = hooks;
  };

  public steer = (perception: BotPerception, memory: BotMemory, rng: Rng, objective: Objective, dtSec: number, layers: CostLayer[] = []): SteerResult => {
    const result = this.decide(perception, memory, rng, objective, dtSec, layers);
    memory.lastMove = result.move;
    memory.lastTurn = result.turn;
    return result;
  };

  private decide(perception: BotPerception, memory: BotMemory, rng: Rng, objective: Objective, dtSec: number, layers: CostLayer[]): SteerResult {
    this.layers = layers;
    // A running recovery owns the hull until it ends.
    if (memory.navState === 'reverse') {
      const recovery = this.stuckRecoveryService.update(perception, memory, rng, true, dtSec);
      if (recovery != null) {
        memory.lastSteerSource = 'recovery';
        return this.avoidDrops(perception, memory, recovery);
      }
    }
    let result: SteerResult;
    switch (objective.kind) {
      case 'hunt':
        result = this.hunt(perception, memory, rng, objective.target, objective.mobile === true);
        break;
      case 'goto':
        result = objective.flank
          ? this.chaseTo(perception, memory, rng, objective.point, objective.arriveRadius)
          : this.driveTo(perception, memory, rng, objective.point, objective.arriveRadius, false);
        break;
      case 'hold':
        result = this.hold(perception, memory, rng, objective.point, objective.radius);
        break;
      case 'roam':
      default:
        result = this.roam(perception, memory, rng);
        break;
    }
    // Waiting behind a teammate is a decision, not a jam: apply it first, so
    // "stuck" is judged against what the hull was finally asked to do (a hull
    // that stands still to shoot, pivot, hold a post or queue is not stuck).
    const polite = this.localAvoidanceService.adjust(perception, result, memory);
    if (polite.blocked || polite.turn !== result.turn || polite.move !== result.move) memory.lastSteerSource = 'avoid-tank';
    const holdingDistance = objective.kind === 'hunt' && objective.target.buffed && objective.target.alive;
    // A commanded pivot that does not turn (yaw rate under the stuck threshold) is a jam too:
    // a carrier that cannot swing round at the enemy base must back out instead. A hull held
    // up by a tank right ahead is also still "wanting" to move, so a mutual block backs out.
    // A hull standing on purpose next to another (a post, a shot, a yield hold) is not jammed: an
    // escalation that reversed it anyway doubled the stuck count on kolhoz (reversal every 4-5 s per bot).
    const wantsToMove = (Math.abs(polite.move) >= 0.3 || Math.abs(polite.turn) >= 0.9 || polite.blocked) && !holdingDistance;
    const recovery = this.stuckRecoveryService.update(perception, memory, rng, wantsToMove, dtSec, this.onSteepGround(perception));
    if (recovery != null) memory.lastSteerSource = 'recovery';
    return this.avoidDrops(perception, memory, recovery ?? polite);
  }

  // --- behaviours ----------------------------------------------------------

  private hunt(perception: BotPerception, memory: BotMemory, rng: Rng, target: TankView, mobile: boolean): SteerResult {
    const self = perception.self;
    const distance = flatDistance(self.position, target.position);
    if (target.buffed) {
      // Keep away, but stay faced toward it so the turret keeps working.
      memory.chasing = false;
      const steer = this.steerToward(perception, target.position);
      if (distance < BACK_OFF_DISTANCE) {
        memory.lastSteerSource = 'keep-away';
        // Full reverse, except on an edge cell (island: a tail-first dive from a keep-away).
        return { move: this.onEdgeCell(perception) ? 0 : -1, turn: -steer };
      }
      if (distance > KEEP_AWAY_DISTANCE || !memory.hasLineOfSight) {
        return this.driveTo(perception, memory, rng, target.position, CHASE_STOP_DISTANCE * 0.5, true);
      }
      memory.lastSteerSource = 'keep-away';
      return { move: 0, turn: steer };
    }
    // No shot from here (the target is below a ledge or up a bank, the path
    // to it does not exist, or a teammate stands in the line of fire and the
    // avoidance held the hull behind it last tick): after a moment, go and
    // find a spot that has one. Once started, the clock runs until there is a
    // shot: a hull queued behind a teammate is held on and off, and a clock
    // reset by every gap never fired (Babylon TDM: five hulls in a column on
    // the ramp, only the front one shooting).
    const steep = distance < VANTAGE_NEAR && Math.abs(self.gunElevationTo(target.position)) > MAX_FIRE_ELEVATION;
    const stalled = memory.follower.path?.status === 'partial' || (memory.follower.path == null && memory.follower.retryAfter > perception.now);
    const queued = memory.lastSteerSource === 'avoid-tank';
    if (memory.hasLineOfSight) {
      memory.noShotSince = 0;
    } else if (memory.noShotSince === 0 && (steep || stalled || queued)) {
      memory.noShotSince = perception.now;
    }
    if (memory.noShotSince > 0 && perception.now - memory.noShotSince > VANTAGE_AFTER_MS) {
      const vantage = this.vantageFor(perception, memory, rng, target);
      if (vantage != null) {
        memory.lastSteerSource = 'follow';
        return this.driveTo(perception, memory, rng, vantage, 250, false);
      }
    }
    // Hysteresis: close in while the shot is blocked, stop once in range with LOS.
    if (distance < CHASE_STOP_DISTANCE && memory.hasLineOfSight) {
      memory.chasing = false;
    } else if (distance > CHASE_RESUME_DISTANCE || !memory.hasLineOfSight) {
      memory.chasing = true;
    }
    if (!memory.chasing) {
      memory.follower.reset();
      if (mobile) {
        const jink = this.jink(perception, memory, rng, target);
        if (jink != null) return jink;
      }
      memory.lastSteerSource = 'hunt-hold';
      return { move: 0, turn: this.steerToward(perception, target.position) };
    }
    return this.driveTo(perception, memory, rng, target.position, 700, true);
  }

  /** See JINK_*: a sideways leg with room on the grid, or null to stand. */
  private jink(perception: BotPerception, memory: BotMemory, rng: Rng, target: TankView): SteerResult | null {
    const self = perception.self;
    const now = perception.now;
    const p = self.position;
    const dx = target.position.x - p.x;
    const dy = target.position.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    if (memory.jinkSide === 0 || now >= memory.jinkUntil) {
      memory.jinkSide = memory.jinkSide === 0 ? (rng.chance(0.5) ? 1 : -1) : -memory.jinkSide;
      memory.jinkUntil = now + JINK_LEG_MS;
    }
    const grid = this.navQueryService.current;
    const radial = Math.max(-0.5, Math.min(0.5, (JINK_DISTANCE - d) / 600));
    const point = { x: 0, y: 0, z: p.z };
    for (let attempt = 0; attempt < 2; attempt++) {
      // Tangent (left of the line to the target) times the side, drifting toward the preferred ring.
      let gx = -uy * memory.jinkSide - ux * radial;
      let gy = ux * memory.jinkSide - uy * radial;
      const g = Math.hypot(gx, gy) || 1;
      gx /= g;
      gy /= g;
      point.x = p.x + gx * JINK_LEG;
      point.y = p.y + gy * JINK_LEG;
      if (grid == null || this.lineClear(grid, p, point)) {
        memory.lastSteerSource = 'jink';
        const h = self.heading;
        const along = -Math.sin(h) * gx + Math.cos(h) * gy;
        if (Math.abs(along) >= 0.5) {
          // Already across the line of fire: forward or reverse along the hull, no pivot.
          if (along > 0) return { move: JINK_THROTTLE, turn: this.steerToward(perception, point) };
          return { move: -JINK_THROTTLE, turn: 0 };
        }
        return this.straight(perception, memory, point);
      }
      memory.jinkSide = -memory.jinkSide;
      memory.jinkUntil = now + JINK_LEG_MS;
    }
    return null;
  }

  /** See FLANK_*: a goto to a last-seen point that goes round a teammate in the way after a wait. */
  private chaseTo(perception: BotPerception, memory: BotMemory, rng: Rng, point: Vec3Like, arriveRadius: number): SteerResult {
    const now = perception.now;
    const self = perception.self;
    // On a flank already: finish it (or let it go stale), then chase the point itself.
    if (memory.vantageFor === FLANK_KEY && memory.vantagePoint != null) {
      if (now - memory.vantageAt < VANTAGE_TTL_MS && flatDistance(self.position, memory.vantagePoint) > FLANK_ARRIVE) {
        return this.driveTo(perception, memory, rng, memory.vantagePoint, FLANK_ARRIVE, false);
      }
      memory.vantagePoint = null;
      memory.vantageFor = null;
      memory.follower.reset();
    }
    const queued = memory.lastSteerSource === 'avoid-tank';
    if (!queued) {
      memory.queuedSince = 0;
    } else if (memory.queuedSince === 0) {
      memory.queuedSince = now;
    } else if (now - memory.queuedSince >= FLANK_AFTER_MS) {
      memory.queuedSince = 0;
      const flank = this.flankFor(perception, rng, point);
      if (flank != null) {
        memory.vantagePoint = flank;
        memory.vantageFor = FLANK_KEY;
        memory.vantageAt = now;
        memory.follower.reset();
        return this.driveTo(perception, memory, rng, flank, FLANK_ARRIVE, false);
      }
    }
    return this.driveTo(perception, memory, rng, point, arriveRadius, false);
  }

  /** A reachable spot VANTAGE_MIN..VANTAGE_MAX from `point` with a line of sight to it, off the line the hull is on. */
  private flankFor(perception: BotPerception, rng: Rng, point: Vec3Like): Vec3Like | null {
    const self = perception.self;
    const eye = { x: 0, y: 0, z: 0 };
    const aim = { x: point.x, y: point.y, z: point.z + 60 };
    const out = { x: 0, y: 0, z: 0 };
    const toPoint = Math.atan2(point.y - self.position.y, point.x - self.position.x);
    for (let i = 0; i < VANTAGE_TRIES; i++) {
      if (!this.navQueryService.randomReachable(point, VANTAGE_MIN, VANTAGE_MAX, rng, out)) continue;
      // Not the side the queue is on: the spot has to sit at least 60° off the hull's own line to the point.
      const fromPoint = Math.atan2(out.y - point.y, out.x - point.x);
      const off = fromPoint - toPoint - Math.PI;
      if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < Math.PI / 3) continue;
      eye.x = out.x;
      eye.y = out.y;
      eye.z = out.z + EYE_HEIGHT;
      if (!perception.hasLineOfSight(eye, aim)) continue;
      return { x: out.x, y: out.y, z: out.z };
    }
    return null;
  }

  /** A reachable point VANTAGE_MIN..VANTAGE_MAX from the target with a shootable line of sight; cached per target for VANTAGE_TTL_MS. */
  private vantageFor(perception: BotPerception, memory: BotMemory, rng: Rng, target: TankView): Vec3Like | null {
    const now = perception.now;
    if (memory.vantagePoint != null && memory.vantageFor === target.id && now - memory.vantageAt < VANTAGE_TTL_MS) {
      return memory.vantagePoint;
    }
    memory.vantageAt = now;
    memory.vantageFor = target.id;
    memory.vantagePoint = null;
    const eye = { x: 0, y: 0, z: 0 };
    const aim = { x: target.position.x, y: target.position.y, z: target.position.z + 60 };
    const out = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < VANTAGE_TRIES; i++) {
      if (!this.navQueryService.randomReachable(target.position, VANTAGE_MIN, VANTAGE_MAX, rng, out)) continue;
      const flat = flatDistance(out, target.position);
      if (Math.abs(Math.atan2(target.position.z - out.z, Math.max(flat, 1))) > VANTAGE_ELEVATION) continue;
      eye.x = out.x;
      eye.y = out.y;
      eye.z = out.z + EYE_HEIGHT;
      if (!perception.hasLineOfSight(eye, aim)) continue;
      memory.vantagePoint = { x: out.x, y: out.y, z: out.z };
      return memory.vantagePoint;
    }
    return null;
  }

  private hold(perception: BotPerception, memory: BotMemory, rng: Rng, point: Vec3Like, radius: number): SteerResult {
    const distance = flatDistance(perception.self.position, point);
    if (distance > radius) {
      return this.driveTo(perception, memory, rng, point, radius * 0.6, false);
    }
    // Inside the post: slow patrol so the hull keeps presenting its front.
    const roam = this.roamPoint(perception, memory, rng, point, ROAM_MIN * 0.5, radius * 0.8);
    if (roam == null) {
      memory.lastSteerSource = 'hold-idle';
      return { move: 0, turn: 0 };
    }
    const result = this.driveTo(perception, memory, rng, roam, 300, false);
    return { move: result.move * 0.5, turn: result.turn };
  }

  private roam(perception: BotPerception, memory: BotMemory, rng: Rng): SteerResult {
    const point = this.roamPoint(perception, memory, rng, perception.self.position, ROAM_MIN, ROAM_MAX);
    if (point == null) {
      return { move: 0, turn: 0 };
    }
    return this.driveTo(perception, memory, rng, point, 350, false);
  }

  /** A random reachable point, re-picked when reached or stale. */
  private roamPoint(perception: BotPerception, memory: BotMemory, rng: Rng, around: Vec3Like, minRadius: number, maxRadius: number): Vec3Like | null {
    const now = perception.now;
    const current = memory.roamPoint;
    if (current == null || now - memory.roamPickedAt > ROAM_STALE_MS || flatDistance(perception.self.position, current) < 350) {
      const out = { x: 0, y: 0, z: 0 };
      memory.roamPoint = this.navQueryService.randomReachable(around, minRadius, maxRadius, rng, out) ? out : null;
      memory.roamPickedAt = now;
    }
    return memory.roamPoint;
  }

  // --- path driving ----------------------------------------------------------

  /** Plans (when needed) and follows a path to `goal`; falls back to a straight line when the grid has no answer. */
  private driveTo(perception: BotPerception, memory: BotMemory, _rng: Rng, goal: Vec3Like, arriveRadius: number, moving: boolean): SteerResult {
    const self = perception.self;
    const now = perception.now;
    const follower = memory.follower;
    if (flatDistance(self.position, goal) <= arriveRadius) {
      follower.reset();
      memory.lastSteerSource = 'arrived';
      return { move: 0, turn: 0 };
    }
    const grid = this.navQueryService.current;
    if (grid == null) {
      return this.straight(perception, memory, goal);
    }
    const stale =
      follower.path == null ||
      !follower.hasGoal ||
      flatDistance(follower.goal, goal) > GOAL_MOVED ||
      now - follower.plannedAt > (moving ? REPLAN_MOVING_MS : REPLAN_FIXED_MS) ||
      (follower.offPathSince > 0 && now - follower.offPathSince > OFF_PATH_MS);
    if (stale && now >= follower.retryAfter) {
      const raw = this.pathfindingService.find({ from: self.position, to: goal, layers: this.layers, maxNodes: this.layers.length > 0 ? LAYERED_MAX_NODES : undefined });
      // A partial path that does not even leave the hull's own cell is a failure too:
      // following it "arrives" at once and would ask again next tick.
      const ok = raw.status === 'ok' || (raw.status === 'partial' && raw.points.length > 2);
      this.hooks.onPathRequest?.(ok);
      if (ok) {
        const path = this.pathSmoothingService.smooth(grid, raw);
        follower.setPath(path, goal, now);
        this.hooks.onPath?.(self.id, path.points);
      } else {
        follower.reset();
        follower.retryAfter = now + RETRY_MS;
      }
    }
    const followed = this.pathFollowService.follow(perception, memory, grid, arriveRadius);
    if (followed == null) {
      return this.straightIfClear(perception, memory, grid, goal);
    }
    if (followed.arrived) {
      // A partial path ends short of the goal: nudge straight at it from here,
      // and do not ask the grid again for a moment (it would give the same answer).
      if (follower.path?.status === 'partial') {
        follower.reset();
        follower.retryAfter = now + RETRY_MS;
        return this.straightIfClear(perception, memory, grid, goal);
      }
      memory.lastSteerSource = 'arrived';
      return { move: 0, turn: 0 };
    }
    memory.lastSteerSource = 'follow';
    if (followed.offPath > OFF_PATH) {
      if (follower.offPathSince === 0) follower.offPathSince = now;
    } else {
      follower.offPathSince = 0;
    }
    return { move: followed.move, turn: followed.turn };
  }

  /** Breadth-first over the grid's edges from `from`, up to `depth` steps: is `target` among the cells reached? */
  private connected(grid: NavGrid, from: number, target: number, depth: number): boolean {
    if (from === target) return true;
    let frontier = [from];
    const seen = new Set<number>([from]);
    for (let step = 0; step < depth && frontier.length > 0; step++) {
      const next: number[] = [];
      for (const node of frontier) {
        for (let dir = 0; dir < NAV_DIR_COUNT; dir++) {
          const other = grid.edge(node, dir);
          if (other < 0 || seen.has(other)) continue;
          if (other === target) return true;
          seen.add(other);
          next.push(other);
        }
      }
      frontier = next;
    }
    return false;
  }

  /** See VETO_*: the third veto at one spot marks the gap ahead as a learned block and drops the path. */
  private noteVeto(perception: BotPerception, memory: BotMemory, heading: number): void {
    const now = perception.now;
    const p = perception.self.position;
    const near = now - memory.vetoAt < VETO_WINDOW_MS && Math.hypot(p.x - memory.vetoX, p.y - memory.vetoY) < VETO_RADIUS;
    memory.vetoCount = near ? memory.vetoCount + 1 : 1;
    memory.vetoAt = now;
    if (!near) {
      memory.vetoX = p.x;
      memory.vetoY = p.y;
    }
    if (memory.vetoCount >= VETO_LIMIT) {
      memory.vetoCount = 0;
      this.learnedBlockService.mark({ x: p.x - Math.sin(heading) * VETO_MARK_AHEAD, y: p.y + Math.cos(heading) * VETO_MARK_AHEAD, z: p.z }, now);
      memory.follower.reset();
    }
  }

  private tankWithin(perception: BotPerception, distance: number): boolean {
    const p = perception.self.position;
    for (const o of perception.tanks()) {
      if (Math.hypot(o.position.x - p.x, o.position.y - p.y) < distance) return true;
    }
    return false;
  }

  /** Off the grid: a crawl ahead (or back) when the ground ray finds floor within PROBE_DROP there, else nothing. */
  private groundStep(perception: BotPerception, heading: number, sign: 1 | -1): number {
    const p = perception.self.position;
    const drop = (a: number): number | null => {
      const ground = perception.groundHeightAt(p.x - Math.sin(a) * PROBE_NEAR, p.y + Math.cos(a) * PROBE_NEAR, p.z + PROBE_UP, PROBE_UP + PROBE_DROP);
      return ground == null ? null : p.z - ground;
    };
    const ahead = drop(heading);
    if (ahead != null && ahead < PROBE_DROP) return GROUND_STEP_THROTTLE * sign;
    const behind = drop(heading + Math.PI);
    if (behind != null && behind < PROBE_DROP) return -GROUND_STEP_THROTTLE * sign;
    return 0;
  }

  /** True when the hull's own cell touches a drop (clearance <= 1). */
  private onEdgeCell(perception: BotPerception): boolean {
    const grid = this.navQueryService.current;
    if (grid == null) return false;
    const p = perception.self.position;
    const node = grid.nodeAt(p.x, p.y, p.z);
    return node >= 0 && grid.nodeClearance[node] <= 1;
  }

  /** True when the hull stands on a marginal (steep) floor of the grid. */
  private onSteepGround(perception: BotPerception): boolean {
    const grid = this.navQueryService.current;
    if (grid == null) return false;
    const p = perception.self.position;
    const node = grid.nodeAt(p.x, p.y, p.z);
    return node >= 0 && grid.isMarginal(node);
  }

  /** Straight at a point: a big error is turned off under half throttle with full lock (a stationary hull barely pivots, see PathFollowService). */
  private straight(perception: BotPerception, memory: BotMemory, point: Vec3Like): SteerResult {
    memory.lastSteerSource = 'straight';
    const steer = this.steerToward(perception, point);
    const error = perception.self.headingErrorTo(point);
    const size = Math.abs(error);
    if (memory.pivoting ? size < 0.25 : size > 0.8) {
      memory.pivoting = !memory.pivoting;
    }
    if (memory.pivoting) {
      return { move: 0.5, turn: error > 0 ? 1 : -1 };
    }
    return { move: Math.abs(steer) > HARD_TURN ? 0.55 : 1, turn: steer };
  }

  /** See STRAIGHT_MAX: straight at the goal when the grid line there is clear, else stand (the gunner and the vantage search still work). */
  private straightIfClear(perception: BotPerception, memory: BotMemory, grid: NavGrid, goal: Vec3Like): SteerResult {
    if (this.lineClear(grid, perception.self.position, goal)) {
      return this.straight(perception, memory, goal);
    }
    memory.lastSteerSource = 'no-path';
    return { move: 0, turn: 0 };
  }

  /** Every STRAIGHT_STEP along the line (up to STRAIGHT_MAX) lands on a floor cell off the walls and drops. */
  private lineClear(grid: NavGrid, from: Vec3Like, to: Vec3Like): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.min(STRAIGHT_MAX, Math.hypot(dx, dy));
    if (length < STRAIGHT_STEP) return true;
    const ux = dx / Math.hypot(dx, dy);
    const uy = dy / Math.hypot(dx, dy);
    let z = from.z;
    for (let d = STRAIGHT_STEP; d <= length; d += STRAIGHT_STEP) {
      const node = grid.nodeAt(from.x + ux * d, from.y + uy * d, z, GUARD_DZ_BASE + STRAIGHT_STEP * GUARD_DZ_PER_UNIT);
      if (node < 0 || !grid.isFloor(node) || grid.nodeClearance[node] < GUARD_CLEARANCE || grid.nodeWallClearance[node] < 1) return false;
      z = grid.nodeZ[node];
    }
    return true;
  }

  /** -1..1 turn toward a world point (+1 = left, the chassis convention). */
  private steerToward(perception: BotPerception, point: Vec3Like): number {
    const error = perception.self.headingErrorTo(point);
    if (Math.abs(error) < STEER_DEAD_ZONE) {
      return 0;
    }
    const gain = Math.min(1, Math.abs(error) / 0.7);
    return error > 0 ? gain : -gain;
  }

  /**
   * Cliff and water guard (the map's water has no collision). The grid keeps
   * paths away from edges; this catches what the paths did not cover — a
   * keep-away reverse, a slide, a push, a straight fallback — by checking
   * the GRID under the points the hull is heading for (a shore skirt is a
   * 60-80 deg plane that a raw ground ray still "sees" as ground) and
   * refusing to move onto a cell that is not a floor well inside the map.
   */
  private avoidDrops(perception: BotPerception, memory: BotMemory, steer: SteerResult): SteerResult {
    if (steer.move === 0) {
      return steer;
    }
    const self = perception.self;
    const p = self.position;
    if (perception.groundHeightAt(p.x, p.y, p.z + PROBE_UP, PROBE_UP + PROBE_DROP) == null) {
      return steer;
    }
    const grid = this.navQueryService.current;
    const speed = Math.hypot(self.velocity.x, self.velocity.y);
    const commandSign: 1 | -1 = steer.move > 0 ? 1 : -1;
    const velocityYaw = Math.atan2(-self.velocity.x, self.velocity.y);
    const slip = Math.abs(Math.atan2(Math.sin(velocityYaw - self.heading), Math.cos(velocityYaw - self.heading)));
    const sliding = speed > SLIDE_SPEED;
    const sign: 1 | -1 = sliding ? (slip < Math.PI / 2 ? 1 : -1) : commandSign;
    const heading = self.heading + (sign > 0 ? 0 : Math.PI);
    const far = PROBE_DISTANCE + Math.min(900, speed * 0.9);
    memory.lastVeto = '';
    const safe = (angleOffset: number, distance: number): boolean => {
      const a = heading + angleOffset;
      const x = p.x - Math.sin(a) * distance;
      const y = p.y + Math.cos(a) * distance;
      if (grid != null) {
        const node = grid.nodeAt(x, y, p.z, GUARD_DZ_BASE + distance * GUARD_DZ_PER_UNIT);
        const tag = `${angleOffset.toFixed(1)}@${Math.round(distance)}`;
        if (node < 0) {
          memory.lastVeto = `${tag}:none`;
          return false;
        }
        if (!grid.isFloor(node)) {
          memory.lastVeto = `${tag}:floor`;
          return false;
        }
        if (grid.nodeClearance[node] < GUARD_CLEARANCE) {
          memory.lastVeto = `${tag}:edge`;
          return false;
        }
        // Close in, a cell touching a wall is a wall for the hull's nose.
        if (distance <= PROBE_NEAR && grid.nodeWallClearance[node] < 1) {
          memory.lastVeto = `${tag}:wall`;
          return false;
        }
        return true;
      }
      const ground = perception.groundHeightAt(x, y, p.z + PROBE_UP, PROBE_UP + PROBE_DROP);
      return ground != null && p.z - ground < PROBE_DROP;
    };
    // A turning hull sweeps an arc, not a line: probe along the bend too, and
    // at full lock (a pivot) the near fan on the side the nose swings to.
    const bend = Math.abs(steer.turn) > ARC_TURN ? Math.sign(steer.turn) * sign * ARC_ANGLE : 0;
    const pivot = Math.abs(steer.turn) >= PIVOT_TURN;
    const front =
      safe(0, PROBE_NEAR) &&
      safe(0, far) &&
      (bend === 0 || safe(bend, far * ARC_FAR_FRACTION)) &&
      (!pivot || (safe(bend * 2, PROBE_NEAR) && safe(bend, PROBE_NEAR)));
    if (front) {
      memory.dropAvoidUntil = 0;
      // Corners: a fence beside the nose is cleared by yawing away from it, not by pushing on.
      const here = grid != null ? grid.nodeAt(p.x, p.y, p.z) : -1;
      if (grid != null && here >= 0) {
        // Off the graph (an edge cell on a rim, a rock top: no edges lead anywhere)
        // the reach test can only fail; the probes alone decide then — kolhoz: a hull
        // on the tunnel's lip with clear floor ahead stood pivoting on the spot for good.
        const anchored = grid.isPassable(here);
        const cornerClear = (angleOffset: number): boolean => {
          const a = heading + angleOffset;
          const node = grid.nodeAt(p.x - Math.sin(a) * CORNER_DISTANCE, p.y + Math.cos(a) * CORNER_DISTANCE, p.z, GUARD_DZ_BASE + CORNER_DISTANCE * GUARD_DZ_PER_UNIT);
          if (node < 0 || !grid.isFloor(node) || grid.nodeClearance[node] < GUARD_CLEARANCE) return false;
          // The lookup may land on a rock's TOP (a floor 375 up): only a cell the
          // hull can actually drive to within a few edges counts as clear.
          return grid.nodeWallClearance[node] >= 1 && (!anchored || this.connected(grid, here, node, CORNER_REACH_EDGES));
        };
        const leftClear = cornerClear(CORNER_ANGLE);
        const rightClear = cornerClear(-CORNER_ANGLE);
        if (leftClear !== rightClear) {
          memory.lastSteerSource = 'avoid-wall';
          // Left corner into a wall -> yaw right (turn -1) when driving forward; the tail mirrors it in reverse.
          const away = (leftClear ? 1 : -1) * sign;
          return { move: CORNER_THROTTLE * sign, turn: away };
        }
        if (!leftClear && !rightClear) {
          memory.lastSteerSource = 'avoid-wall';
          // Nowhere to back into: creep on with full lock (the probes ahead passed; a standing hull does not pivot at all).
          return { move: safe(Math.PI, PROBE_NEAR) ? -0.6 * sign : CORNER_THROTTLE * sign, turn: steer.turn >= 0 ? 1 : -1 };
        }
        // Side walls: a wall right beside the hull (DM on kolhoz: hulls wedged
        // along building walls at full throttle) — never yaw into it, and
        // do not run flat out along it.
        const sideClear = (angleOffset: number): boolean => {
          const a = heading + angleOffset;
          const node = grid.nodeAt(p.x - Math.sin(a) * SIDE_DISTANCE, p.y + Math.cos(a) * SIDE_DISTANCE, p.z, GUARD_DZ_BASE + SIDE_DISTANCE * GUARD_DZ_PER_UNIT);
          return node >= 0 && grid.isFloor(node) && grid.nodeWallClearance[node] >= 1 && (!anchored || this.connected(grid, here, node, CORNER_REACH_EDGES));
        };
        const leftSide = sideClear(SIDE_ANGLE);
        const rightSide = sideClear(-SIDE_ANGLE);
        if (!leftSide || !rightSide) {
          // +turn yaws the nose left when driving forward (the tail when reversing).
          let turn = steer.turn;
          const intoLeft = turn * sign > 0;
          if ((!leftSide && intoLeft) || (!rightSide && !intoLeft && turn !== 0)) turn = 0;
          memory.lastSteerSource = 'avoid-wall';
          return { move: Math.max(-SIDE_THROTTLE, Math.min(SIDE_THROTTLE, steer.move)), turn };
        }
      }
      return steer;
    }
    if (sliding && sign !== commandSign) {
      memory.dropAvoidUntil = 0;
      return { move: commandSign, turn: 0 };
    }
    if (sliding && speed > BRAKE_SPEED) {
      memory.dropAvoidUntil = 0;
      return { move: -sign, turn: 0 };
    }
    if (perception.now < memory.dropAvoidUntil) {
      memory.lastSteerSource = memory.dropAvoidThreading ? 'avoid-wall' : 'avoid-drop';
      return { move: memory.dropAvoidMove, turn: memory.dropAvoidTurn };
    }
    // A wall on the near probe dead ahead with floor a little to one side is a gap
    // (kolhoz: 500-wide passages between cabins, hull 400 wide): thread it with a
    // gentle turn instead of backing off and running at it again. Not a veto for
    // the learned-block count — threading a corridor takes several probes.
    if (grid != null && !safe(0, PROBE_NEAR) && memory.lastVeto.endsWith(':wall')) {
      for (const offset of THREAD_ANGLES) {
        if (safe(offset, PROBE_NEAR) && safe(offset, far * ARC_FAR_FRACTION)) {
          memory.dropAvoidUntil = perception.now + THREAD_HOLD_MS;
          memory.dropAvoidThreading = true;
          memory.dropAvoidTurn = Math.sign(offset) * sign * THREAD_TURN;
          memory.dropAvoidMove = THREAD_THROTTLE * sign;
          memory.lastSteerSource = 'avoid-wall';
          return { move: memory.dropAvoidMove, turn: memory.dropAvoidTurn };
        }
      }
    }
    memory.dropAvoidThreading = false;
    this.noteVeto(perception, memory, heading);
    const left = safe(PROBE_ANGLE, PROBE_NEAR) && safe(PROBE_ANGLE, far);
    const right = safe(-PROBE_ANGLE, PROBE_NEAR) && safe(-PROBE_ANGLE, far);
    memory.dropAvoidUntil = perception.now + 500;
    memory.lastSteerSource = 'avoid-drop';
    if (left && !right) {
      memory.dropAvoidTurn = sign;
      memory.dropAvoidMove = 0.45 * sign;
    } else if (right && !left) {
      memory.dropAvoidTurn = (-sign) as 1 | -1;
      memory.dropAvoidMove = 0.45 * sign;
    } else if (left && right) {
      memory.dropAvoidTurn = ((steer.turn >= 0 ? 1 : -1) * sign) as 1 | -1;
      memory.dropAvoidMove = 0.45 * sign;
    } else {
      const backSafe = safe(Math.PI, PROBE_NEAR);
      memory.dropAvoidTurn = steer.turn >= 0 ? 1 : -1;
      // Nothing on the grid in any direction (a rim, a hollow off the graph): the
      // ground ray decides — a step that lands on ground within PROBE_DROP is a
      // crawl, not a stand (kolhoz: a hull that slid off the tunnel's lip stood
      // pivoting at zero throttle until it was shot).
      memory.dropAvoidMove = backSafe ? -0.6 * sign : this.groundStep(perception, heading, sign);
    }
    // The path stays: the guard only vetoes this moment's move, and the
    // follower picks the route back up once the probes clear (throwing the
    // path away here caused a re-plan storm on ramps).
    return { move: memory.dropAvoidMove, turn: memory.dropAvoidTurn };
  }
}

export default NavigatorService;
