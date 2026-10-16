// Keeps hulls off each other in every mode: a tank in the cone ahead (ally
// or enemy) is steered AROUND on the freer side, the throttle is cut when
// it is close, and a hull that still cannot move reports itself blocked so
// the stuck recovery backs it out after a second instead of two tanks
// waiting for each other forever.
//
// Right of way (the owner's rule): the flag run has it, in both directions.
// A carrier outranks an attacker on its way to the flag, who outranks
// everyone else (defenders, escorts, interceptors). A hull with a
// higher-ranked teammate close by gives way EVEN WHILE STANDING (bots
// parked at the pedestal used to sit in their own carrier's way): it moves
// off away from it when close, slows and pulls aside when it approaches
// from ahead, and never steers round a lower-ranked one beyond nose
// distance (three tanks nose to tail at a wall, the carrier in front, was
// a deadlock).
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { BotPerception, TankView } from '../../../../model/Perception';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BlackboardService from '../squad/BlackboardService';
import type RoleAuctionService from '../squad/RoleAuctionService';
import type NavQueryService from '../nav/NavQueryService';
import type { SteerResult } from './PathFollowService';

// All distances below are between hull CENTRES. Two hulls touching nose to
// tail are 500 apart (half length 250 each), nose to nose the same, so a
// threshold under ~550 acts only after the contact (the stuck forensics on
// kolhoz and island showed most jams in contact with a tank whose centre was
// 450-550 away, past the old 320/450 limits).
/** A tank inside this cone ahead is an obstacle... */
const AHEAD_DISTANCE = 1100;
const AHEAD_HALF_ANGLE = 0.6;
/** Nearly dead ahead (lateral offset under this) both hulls pass on the RIGHT, so they never mirror each other. */
const HEAD_ON_LATERAL = 120;
/** Reversing: a tank in the cone BEHIND stops the reverse. */
const BEHIND_DISTANCE = 680;
/** ...and this close it is a wall: coast, and count as blocked. */
const CLOSE_DISTANCE = 640;
/** Lateral steer added to go round, scaled by proximity. */
const AVOID_TURN = 0.9;
/** Coast (throttle 0) when moving faster than this toward a close tank. */
const COAST_SPEED = 120;
/**
 * A tank ahead that is moving away (closing speed along my nose under this,
 * u/s) is a convoy mate, not an obstacle: measured on kolhoz, a carrier spent
 * a minute crawling behind its own front escort because the escort sat in
 * its cone the whole way home.
 */
const CONVOY_CLOSING_SPEED = 150;
/** Right of way: a higher-ranked teammate within this -> move off... */
const YIELD_BACK_DISTANCE = 800;
/** ...within this ahead -> slow down and pull aside. */
const YIELD_SLOW_DISTANCE = 1500;
const YIELD_HALF_ANGLE = 0.9;
const YIELD_THROTTLE = 0.3;
/**
 * Opponents shoot each other but never ram (the owner's rule, every mode):
 * of two hulls nose to nose, the one with the LOWER ordinal (bot1 < bot2 <
 * ... < player) backs off and pulls aside; the other keeps its line. The
 * same tie-break settles two teammates of equal rank. Applies to a tank in
 * the cone ahead within this, closing or standing.
 */
const RAM_YIELD_DISTANCE = 950;
const RAM_YIELD_THROTTLE = -0.7;
/** Personal space: a hull this close (centres) in ANY direction is already touching or about to; the yielder moves straight away from it. */
const SPACE_DISTANCE = 560;
/** After giving way the hull holds for this long while the other is still within YIELD_HOLD_DISTANCE (the owner saw bots yield to each other in a loop). */
const YIELD_HOLD_MS = 1200;
const YIELD_HOLD_DISTANCE = 1100;
/**
 * A yield step (aside / ahead / back) prefers the direction where the grid has
 * room (this far out, passable, this many cells off any wall); with none, the
 * plain step is taken and the wall guard vetoes it if it must. Standing instead
 * (first attempt) jammed three teammates between two cabins: kolhoz stuck
 * 6 -> 28 in CTF, 13 -> 38 in TDM.
 */
const ROOM_DISTANCE = 320;
const ROOM_WALL_CELLS = 2;

export interface AvoidResult extends SteerResult {
  /** True when a tank right ahead keeps this hull from moving (feeds stuck detection). */
  blocked: boolean;
}

interface YieldResult extends AvoidResult {
  /** Who the hull gave way to. */
  to: string;
  /** A close yield (backed off / stepped aside): hold afterwards until the other has passed. The far "slow and pull aside" does not hold. */
  hold: boolean;
}

export class LocalAvoidanceService {
  private readonly blackboardService = inject<BlackboardService>(TYPES.blackboardService);
  private readonly roleAuctionService = inject<RoleAuctionService>(TYPES.roleAuctionService);
  private readonly navQueryService = inject<NavQueryService>(TYPES.navQueryService);

  /** Room for a hull at a step from `p` along the hull-relative (forward, left) offset: passable and off the walls (no grid = assume room). */
  private room(perception: BotPerception, forward: number, left: number): boolean {
    const grid = this.navQueryService.current;
    if (grid == null) return true;
    const self = perception.self;
    const h = self.heading;
    const x = self.position.x - Math.sin(h) * forward - Math.cos(h) * left;
    const y = self.position.y + Math.cos(h) * forward - Math.sin(h) * left;
    const node = grid.nodeAt(x, y, self.position.z, 250);
    return node >= 0 && grid.isPassable(node) && grid.nodeWallClearance[node] >= ROOM_WALL_CELLS;
  }

  /** The yield step: back when the other is ahead, ahead when behind, aside otherwise — the first of those with room, else the plain one. */
  private stepAway(perception: BotPerception, ahead: number, side: number, to: string, throttle: number): YieldResult {
    const back = this.room(perception, -ROOM_DISTANCE, 0);
    const fwd = this.room(perception, ROOM_DISTANCE, 0);
    const aside = this.room(perception, ROOM_DISTANCE * 0.6, side * ROOM_DISTANCE);
    const asideOther = this.room(perception, ROOM_DISTANCE * 0.6, -side * ROOM_DISTANCE);
    const stepBack: YieldResult = { move: throttle, turn: 0, blocked: false, to, hold: true };
    const stepFwd: YieldResult = { move: 0.6, turn: 0, blocked: false, to, hold: true };
    const stepAside: YieldResult = { move: 0.5, turn: side, blocked: false, to, hold: true };
    const stepAsideOther: YieldResult = { move: 0.5, turn: -side, blocked: false, to, hold: true };
    if (ahead > 0.3) {
      if (back) return stepBack;
      if (aside) return stepAside;
      if (asideOther) return stepAsideOther;
      return stepBack;
    }
    if (ahead < -0.3) {
      if (fwd) return stepFwd;
      if (aside) return stepAside;
      if (asideOther) return stepAsideOther;
      return stepFwd;
    }
    if (aside) return stepAside;
    if (asideOther) return stepAsideOther;
    if (fwd) return stepFwd;
    if (back) return stepBack;
    return stepAside;
  }

  /** 3 = carrier, 2 = attacker on a flag run (hunter in a flag mode), 1 = everyone else. */
  private priorityOf(perception: BotPerception, tank: TankView): number {
    if (tank.carriesFlag != null) return 3;
    if (perception.flagRules == null) return 1;
    const board = this.blackboardService.boardFor(tank.team);
    return this.roleAuctionService.roleOf(board, tank.id) === 'hunter' ? 2 : 1;
  }

  /**
   * The nearest higher-ranked teammate within YIELD_SLOW_DISTANCE decides:
   * closer than YIELD_BACK_DISTANCE (any direction) the hull moves straight
   * away from it — backs off when it is ahead, drives on when it is behind,
   * pulls forward and away when it is beside; further out, only one coming
   * from ahead matters: slow down and pull aside.
   */
  private yieldTo(perception: BotPerception, steer: SteerResult, rank: number): YieldResult | null {
    const self = perception.self;
    const p = self.position;
    const h = self.heading;
    const fx = -Math.sin(h);
    const fy = Math.cos(h);
    const lx = -Math.cos(h);
    const ly = -Math.sin(h);
    const v = self.velocity;
    let best: TankView | null = null;
    let bestD = YIELD_SLOW_DISTANCE;
    for (const other of perception.tanks()) {
      if (!other.alive || other.team !== self.team || this.priorityOf(perception, other) <= rank) continue;
      const dx = other.position.x - p.x;
      const dy = other.position.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d >= bestD) continue;
      // Pulling away ahead of me (a convoy: the escort behind its carrier) is not in my way.
      if (d >= YIELD_BACK_DISTANCE) {
        const closing = ((v.x - other.velocity.x) * dx + (v.y - other.velocity.y) * dy) / d;
        if (closing < CONVOY_CLOSING_SPEED) continue;
      }
      bestD = d;
      best = other;
    }
    if (best == null) return null;
    const dx = best.position.x - p.x;
    const dy = best.position.y - p.y;
    const ahead = (dx * fx + dy * fy) / bestD;
    const lateral = dx * lx + dy * ly;
    const side = lateral > 0 ? -1 : 1;
    if (bestD < YIELD_BACK_DISTANCE) {
      return this.stepAway(perception, ahead, side, best.id, -0.6);
    }
    if (ahead < Math.cos(YIELD_HALF_ANGLE)) return null;
    return { move: Math.min(Math.abs(steer.move), YIELD_THROTTLE) * (steer.move < 0 ? -1 : 1), turn: Math.max(-1, Math.min(1, steer.turn + side * AVOID_TURN)), blocked: false, to: best.id, hold: false };
  }

  /** Deterministic order for the no-ramming rule: botN -> N, the player last, anything else by name hash. */
  private ordinalOf(id: string): number {
    const m = /^bot(\d+)$/.exec(id);
    if (m != null) return Number(m[1]);
    if (id === 'player') return 1e9;
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return 1e6 + (hash % 1e6);
  }

  /**
   * No ramming: the nearest tank in the cone ahead within RAM_YIELD_DISTANCE
   * that is an opponent, or a teammate of my own rank, and outranks me by
   * ordinal -> I back off, tail swinging away from it. Wrecks and lower
   * ordinals are left to the obstacle logic below.
   */
  private yieldByOrdinal(perception: BotPerception, rank: number): YieldResult | null {
    const self = perception.self;
    const p = self.position;
    const h = self.heading;
    const fx = -Math.sin(h);
    const fy = Math.cos(h);
    const lx = -Math.cos(h);
    const ly = -Math.sin(h);
    const mine = this.ordinalOf(self.id);
    const v = self.velocity;
    let best: TankView | null = null;
    let bestD = RAM_YIELD_DISTANCE;
    let bestLateral = 0;
    for (const other of perception.tanks()) {
      if (!other.alive) continue;
      const dx = other.position.x - p.x;
      const dy = other.position.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d >= bestD) continue;
      if ((dx * fx + dy * fy) / d < Math.cos(AHEAD_HALF_ANGLE)) continue;
      const ally = other.team === self.team;
      if (ally && this.priorityOf(perception, other) !== rank) continue;
      if (this.ordinalOf(other.id) < mine) continue;
      // Moving away at my pace: a convoy mate, not a head-on.
      if (d >= SPACE_DISTANCE && ((v.x - other.velocity.x) * dx + (v.y - other.velocity.y) * dy) / d < CONVOY_CLOSING_SPEED) continue;
      best = other;
      bestD = d;
      bestLateral = dx * lx + dy * ly;
    }
    if (best == null) {
      // Nobody in the cone: anyone (or any wreck) inside the personal space, in any direction?
      let close: TankView | null = null;
      let closeD = SPACE_DISTANCE;
      for (const other of perception.tanks()) {
        const d = Math.hypot(other.position.x - p.x, other.position.y - p.y);
        if (d < 1 || d >= closeD) continue;
        if (other.alive) {
          const ally = other.team === self.team;
          if (ally && this.priorityOf(perception, other) !== rank) continue;
          if (this.ordinalOf(other.id) < mine) continue;
        }
        close = other;
        closeD = d;
      }
      if (close == null) return null;
      const dx = close.position.x - p.x;
      const dy = close.position.y - p.y;
      const ahead = (dx * fx + dy * fy) / closeD;
      const side = dx * lx + dy * ly > 0 ? -1 : 1;
      return this.stepAway(perception, ahead, side, close.id, RAM_YIELD_THROTTLE);
    }
    // Nose away from it: it sits left (lateral > 0) -> yaw right (turn -1) while backing — if there is room behind.
    const turn = bestLateral > 0 ? -0.6 : 0.6;
    if (!this.room(perception, -ROOM_DISTANCE, 0)) {
      return this.stepAway(perception, 1, bestLateral > 0 ? -1 : 1, best.id, RAM_YIELD_THROTTLE);
    }
    return { move: RAM_YIELD_THROTTLE, turn, blocked: false, to: best.id, hold: true };
  }

  /** Backing into someone helps nobody: a tank in the cone behind stops the reverse (the recovery picks another way). */
  private guardReverse(perception: BotPerception, steer: AvoidResult): AvoidResult {
    const self = perception.self;
    const p = self.position;
    const h = self.heading;
    const bx = Math.sin(h);
    const by = -Math.cos(h);
    for (const other of perception.tanks()) {
      const dx = other.position.x - p.x;
      const dy = other.position.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d > BEHIND_DISTANCE) continue;
      if ((dx * bx + dy * by) / d >= Math.cos(AHEAD_HALF_ANGLE)) {
        return { move: 0, turn: steer.turn, blocked: true };
      }
    }
    return steer;
  }

  public adjust = (perception: BotPerception, steer: SteerResult, memory: BotMemory): AvoidResult => {
    const self = perception.self;
    const p = self.position;
    const h = self.heading;
    const now = perception.now;
    // Right of way first, standing or driving: give room to a higher-ranked teammate...
    const rank = this.priorityOf(perception, self);
    let yielded: YieldResult | null = rank < 3 ? this.yieldTo(perception, steer, rank) : null;
    // The right-of-way yield never holds: an escort within 600 of its carrier gives way to it all
    // the way home and a hold after each step kept it standing (hold share 28 % on island CTF).
    let hold = false;
    // ...then the no-ramming tie-break against opponents and equals (unless already reversing: the tail is free to go).
    if (yielded == null && steer.move >= 0) {
      const byOrdinal = this.yieldByOrdinal(perception, rank);
      if (byOrdinal != null) {
        const guarded = this.guardReverse(perception, byOrdinal);
        // Boxed in (someone behind too): report the jam instead of grinding sideways into a wall — the
        // recovery sorts out who backs out.
        yielded = guarded.blocked ? { ...byOrdinal, move: 0, turn: 0, blocked: true } : byOrdinal;
        hold = byOrdinal.hold;
      }
    }
    if (yielded != null) {
      if (hold) {
        memory.yieldUntil = now + YIELD_HOLD_MS;
        memory.yieldTo = yielded.to;
      }
      return yielded;
    }
    // Nothing to give way to right now; having just given way, hold until the other has passed
    // instead of driving straight back into its path (the owner saw bots yield to each other in a
    // loop). The hold is a decision, not a jam: it starts only once the yield itself is over (set
    // on the first yield tick it replaced the yield move with 1.2 s of standing — hulls in contact,
    // hold share 21 % on island) and is not reported as blocked (as blocked it outlived the stuck
    // threshold and every hold ended in a recovery reverse: kolhoz CTF stuck 6 -> 47).
    if (now < memory.yieldUntil && memory.yieldTo != null) {
      const other = perception.tanks().find((o) => o.id === memory.yieldTo);
      if (other != null && other.alive && Math.hypot(other.position.x - p.x, other.position.y - p.y) < YIELD_HOLD_DISTANCE) {
        return { move: 0, turn: 0, blocked: false };
      }
      memory.yieldUntil = 0;
    }
    if (steer.move === 0) {
      return { ...steer, blocked: false };
    }
    // Hull forward for yaw h is (-sin h, cos h); left is (-cos h, -sin h).
    const reversing = steer.move < 0;
    const fx = -Math.sin(h) * (reversing ? -1 : 1);
    const fy = Math.cos(h) * (reversing ? -1 : 1);
    const lx = -Math.cos(h);
    const ly = -Math.sin(h);
    // A wreck keeps its body in the physics until it respawns (2.5 s), so a
    // dead tank is an obstacle too — the stuck logger on kolhoz put most
    // "open ground, full throttle" jams on wrecks the avoidance looked past.
    if (reversing) {
      return this.guardReverse(perception, { ...steer, blocked: false });
    }
    let nearest: TankView | null = null;
    let nearestD = AHEAD_DISTANCE;
    let nearestLateral = 0;
    const v = self.velocity;
    for (const other of perception.tanks()) {
      const dx = other.position.x - p.x;
      const dy = other.position.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= nearestD || d < 1) continue;
      // A hull does not steer round lower-ranked teammates (they yield); only one right under its nose still coasts.
      if (other.alive && other.team === self.team && d > CLOSE_DISTANCE && this.priorityOf(perception, other) < rank) continue;
      const cos = (dx * fx + dy * fy) / d;
      if (cos < Math.cos(AHEAD_HALF_ANGLE)) continue;
      // Closing speed along my nose: positive = we are getting closer (a wreck stands still).
      const closing = other.alive ? (v.x - other.velocity.x) * fx + (v.y - other.velocity.y) * fy : v.x * fx + v.y * fy;
      if (d > CLOSE_DISTANCE && closing < CONVOY_CLOSING_SPEED) continue;
      nearest = other;
      nearestD = d;
      nearestLateral = dx * lx + dy * ly;
    }
    if (nearest == null) {
      return { ...steer, blocked: false };
    }
    // Go round on the side the obstacle is NOT on (it sits left -> steer right);
    // dead ahead, everyone keeps right (turn -1 = clockwise = right).
    const side = Math.abs(nearestLateral) < HEAD_ON_LATERAL ? -1 : nearestLateral > 0 ? -1 : 1;
    const weight = 1 - nearestD / AHEAD_DISTANCE;
    let turn = steer.turn + side * AVOID_TURN * weight;
    turn = Math.max(-1, Math.min(1, turn));
    const speed = Math.hypot(self.velocity.x, self.velocity.y);
    if (nearestD < CLOSE_DISTANCE) {
      // Too close to swing past: stop pushing; crawl-turn toward the free side (a hull barely pivots in place).
      return { move: speed > COAST_SPEED ? 0 : 0.4, turn: side, blocked: true };
    }
    return { move: steer.move, turn, blocked: false };
  };
}

export default LocalAvoidanceService;
