// Per-bot mutable state. The engine's services are singletons (di-kit), so
// what a brain remembers between ticks lives here, one instance per actor,
// owned by BotEngineService.
import type { Vec3Like } from '../../model/TankCommand';
import type { BotRole } from '../../model/Objective';
import { PathFollower } from './PathFollower';

export type NavState = 'drive' | 'reverse';
export type SteerSource = 'none' | 'recovery' | 'avoid-drop' | 'avoid-wall' | 'avoid-tank' | 'follow' | 'straight' | 'no-path' | 'hunt-hold' | 'jink' | 'keep-away' | 'arrived' | 'hold-idle';

export interface TrailPoint {
  t: number;
  x: number;
  y: number;
  z: number;
}

export class BotMemory {
  // --- navigation ---
  readonly follower = new PathFollower();
  navState: NavState = 'drive';
  navStateTime = 0;
  navStateDuration = 3;
  turnDirection: 1 | -1 = 1;
  stuckTime = 0;
  /** Sim time of the last stuck recovery, for the bench and for escalating. */
  lastStuckAt = -Infinity;
  /** Hull yaw a tick ago: a pivoting hull is turning, not stuck. */
  lastHeading = 0;
  /** Sim time since which the hull has been on its roof (0 = upright). */
  overturnedSince = 0;
  /** Staggered start: until this sim time a fresh life waits for higher-ordinal teammates to drive off (0 = on its way). */
  departUntil = 0;
  /** CTF staging: sim time since this attacker started waiting for a buddy near the enemy flag (0 = not waiting). */
  stagingSince = 0;
  /** CTF: sim time since this attacker started clearing the flag's guard (0 = not clearing). */
  guardSince = 0;
  /** CTF route choice: which of the base-to-base routes this bot takes (attackers spread, a carrier picks the safer one), and whether its waypoint is behind it. */
  routeIndex = 0;
  routeWaypointDone = false;
  /** Slot among the team's bots (assignRole), used to spread attackers over routes. */
  slot = 0;
  /** Utility planner: the action being executed and since when (hysteresis). */
  action: 'mission' | 'hunt' | 'retreat' | 'ambush' = 'mission';
  actionSince = 0;
  /** Ambush post picked for this life. */
  ambushPoint: Vec3Like | null = null;
  /** Turning in place toward the next waypoint (hysteresis: enter at a big error, leave once aligned). */
  pivoting = false;
  chasing = true;
  /** Hunt: a reachable spot with a shot at the target, when the target itself is out of the gun's reach (below a ledge, up a bank). */
  vantagePoint: Vec3Like | null = null;
  vantageFor: string | null = null;
  vantageAt = 0;
  /** Sim time since the chase has had no shot and no progress (0 = fine). */
  noShotSince = 0;
  /** Sim time since a flank chase (goto with `flank`) has been held behind a teammate (0 = moving). */
  queuedSince = 0;
  /** Right of way: after giving way the hull waits until this time for the other to pass (no approach-yield-approach loop). */
  yieldUntil = 0;
  yieldTo: string | null = null;
  /** Guard vetoes (wall / drop ahead) at one spot: count and where; three in a row mark the spot as a learned block. */
  vetoCount = 0;
  vetoAt = 0;
  vetoX = 0;
  vetoY = 0;
  /** Random roam target, re-picked when reached or stale. */
  roamPoint: Vec3Like | null = null;
  roamPickedAt = 0;
  /** What the navigator last asked of the hull and which stage decided it (diagnostics: the bench's stuck logger reads it). */
  lastMove = 0;
  lastTurn = 0;
  lastSteerSource: SteerSource = 'none';
  /** Diagnostics: why the drop/wall guard last vetoed a move (probe tag + failed test), '' when it passed. */
  lastVeto = '';
  /** Cliff avoidance: committed turn direction and until when. */
  dropAvoidTurn = 1;
  dropAvoidMove = 0;
  dropAvoidUntil = 0;
  /** The cached guard move is a gap-threading crawl (reported as 'avoid-wall'), not a veto. */
  dropAvoidThreading = false;

  // --- gunner ---
  targetId: string | null = null;
  /** Battle time the gunner last had a target (the turret holds its aim a while after). */
  lastTargetAt = 0;
  hasLineOfSight = false;
  aimErrorX = 0;
  aimErrorZ = 0;
  aimErrorTargetX = 0;
  aimErrorTargetZ = 0;
  aimDriftTime = 0;
  onTargetMs = 0;
  trail: TrailPoint[] = [];
  trailTime = 0;
  /** Trigger finger on a release-to-fire weapon (TriggerService): down since when, and for how long it meant to hold. */
  triggerDown = false;
  triggerDownSince = 0;
  triggerHoldMs = 0;
  /** Scratch aim point (reused to avoid per-tick allocations). */
  readonly aimPoint: Vec3Like = { x: 0, y: 0, z: 0 };
  readonly turretTarget: Vec3Like = { x: 0, y: 0, z: 0 };

  // --- strategy ---
  role: BotRole = 'hunter';
  /** Next time the strategy may re-evaluate its objective. */
  nextDecisionAt = 0;
  /** Supply policy cooldown (don't spam decisions). */
  nextSupplyCheckAt = 0;
  /** Jink (shooting on the move): which way the current sideways leg goes (0 = none yet) and when it ends. */
  jinkSide = 0;
  jinkUntil = 0;

  reset(): void {
    this.follower.reset();
    this.navState = 'drive';
    this.navStateTime = 0;
    this.navStateDuration = 3;
    this.stuckTime = 0;
    this.chasing = true;
    this.pivoting = false;
    this.vantagePoint = null;
    this.vantageFor = null;
    this.noShotSince = 0;
    this.queuedSince = 0;
    this.yieldUntil = 0;
    this.yieldTo = null;
    this.vetoCount = 0;
    this.vetoAt = 0;
    this.overturnedSince = 0;
    this.departUntil = 0;
    this.stagingSince = 0;
    this.guardSince = 0;
    this.routeIndex = 0;
    this.routeWaypointDone = false;
    this.action = 'mission';
    this.actionSince = 0;
    this.ambushPoint = null;
    this.roamPoint = null;
    this.dropAvoidUntil = 0;
    this.dropAvoidThreading = false;
    this.jinkSide = 0;
    this.jinkUntil = 0;
    this.targetId = null;
    this.lastTargetAt = 0;
    this.hasLineOfSight = false;
    this.onTargetMs = 0;
    this.trail.length = 0;
    this.triggerDown = false;
    this.triggerDownSince = 0;
    this.triggerHoldMs = 0;
    this.nextDecisionAt = 0;
  }
}
