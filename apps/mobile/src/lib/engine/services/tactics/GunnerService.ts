// The turret half of a bot: picks a shootable target, aims with a human-like
// wandering error and reaction delay, and decides when to pull the trigger.
// Port of the desktop BotController's aiming model, tuned per difficulty.
import type { BotMemory } from '../../../../classes/engine/BotMemory';
import type { BotPerception, TankView } from '../../../../model/Perception';
import type { Vec3Like } from '../../../../model/TankCommand';

export interface GunnerProfile {
  /** Wandering aim error, in units of the target's angular half-width. */
  aimSpread: number;
  /** Seconds between re-drawn aim errors. */
  aimDriftPeriod: number;
  /** Extra error against fast targets, as a fraction of aimSpread. */
  movingPenalty: number;
  /** Delay before firing on a target that just entered the sights, ms. */
  reactionMs: number;
  /** Fires once within this many fire windows of its aim point. */
  fireTolerance: number;
  /** Aims where the target WAS this long ago. */
  targetLagMs: number;
  /** Max engagement distance, sim units. */
  fireRange: number;
  /** 0..1: how strongly a wounded enemy is preferred over the nearest one (focus fire; 1 = a half-dead tank counts as half the distance). */
  focusWounded: number;
}

/**
 * Measured (TDM 3v3 on island, 180 s, one side per difficulty against normal):
 * the first tuning gave hard a K/D of only 1.33 against normal, so the
 * profiles were spread further apart — see PLAN.md for the current numbers.
 */
export const GUNNER_PROFILES: Record<'easy' | 'normal' | 'hard', GunnerProfile> = {
  easy: { aimSpread: 2.1, aimDriftPeriod: 1.0, movingPenalty: 0.9, reactionMs: 750, fireTolerance: 3.0, targetLagMs: 450, fireRange: 6000, focusWounded: 0 },
  // Normal against the owner (TDM kolhoz, Hornet/Shaft, 7 min): K/D 0.58 at a target of 1 with spread 1.15 / 300 ms — softened one notch.
  normal: { aimSpread: 1.35, aimDriftPeriod: 0.8, movingPenalty: 0.7, reactionMs: 360, fireTolerance: 2.2, targetLagMs: 300, fireRange: 8000, focusWounded: 0.2 },
  // Hard against the owner (TDM barda, Hornet/Shaft, 10 min): K/D 1.11 with spread 0.5 / 110 ms / lag 100 — sharpened toward the 0.5 target.
  hard: { aimSpread: 0.38, aimDriftPeriod: 0.6, movingPenalty: 0.2, reactionMs: 80, fireTolerance: 1.15, targetLagMs: 60, fireRange: 9500, focusWounded: 1 },
};

export interface GunnerResult {
  turretTarget: Vec3Like | null;
  aimPoint: Vec3Like | null;
  fire: boolean;
  /** The tank being engaged, if any. */
  target: TankView | null;
}

/** Target hull half width for the angular fire window. */
const TARGET_HALF_WIDTH = 160;
/**
 * The turret stops traversing inside this many fire windows of its aim point
 * (keeps it from hunting by fractions of a degree) — but never outside the
 * fire tolerance: a persona-sharpened hard profile had a tolerance of 0.95
 * windows under a deadzone of 1, so the turret parked just outside the fire
 * window and the bot never pulled the trigger (hard lost to normal 12:9).
 */
const AIM_DEADZONE = 1;
const DEADZONE_OF_TOLERANCE = 0.6;
/** Beyond this elevation the gun cannot aim (GameTank.MAX_GUN_ELEVATION). */
const MAX_FIRE_ELEVATION = (20 * Math.PI) / 180;
/** Speed at which the moving penalty reaches full strength. */
const AIM_FULL_PENALTY_SPEED = 400;

const _muzzle = { x: 0, y: 0, z: 0 };

export class GunnerService {
  /**
   * Picks the best shootable enemy: the preferred one when given, else the
   * nearest living enemy, favouring those in line of sight and — by the
   * profile's focusWounded — the ones already hurt (focus fire finishes a
   * tank instead of spreading damage over the whole enemy team).
   */
  public pickTarget = (perception: BotPerception, preferred: TankView | null, profile: GunnerProfile): TankView | null => {
    const self = perception.self;
    // The objective's target only while it can be seen: a hunter driving at the enemy
    // leader used to hold its gun on it behind a cabin while a nearer enemy shot it.
    if (preferred != null && preferred.alive && perception.hasLineOfSight(self.position, preferred.position)) {
      return preferred;
    }
    let best: TankView | null = null;
    let bestScore = Infinity;
    for (const enemy of perception.enemies()) {
      if (!enemy.alive) {
        continue;
      }
      const dx = enemy.position.x - self.position.x;
      const dy = enemy.position.y - self.position.y;
      const distance = Math.hypot(dx, dy);
      const hp = enemy.health / Math.max(1, enemy.maxHealth);
      const wounded = 1 - profile.focusWounded * (1 - hp) * 0.5;
      // A visible enemy counts as closer than an occluded one.
      const score = (perception.hasLineOfSight(self.position, enemy.position) ? distance : distance * 1.8 + 1500) * wounded;
      if (score < bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    return best;
  };

  public aim = (
    perception: BotPerception,
    memory: BotMemory,
    target: TankView | null,
    profile: GunnerProfile,
    dtSec: number,
  ): GunnerResult => {
    const self = perception.self;
    if (target == null || !target.alive) {
      memory.targetId = null;
      memory.onTargetMs = 0;
      memory.trail.length = 0;
      memory.hasLineOfSight = false;
      return { turretTarget: null, aimPoint: null, fire: false, target: null };
    }
    if (memory.targetId !== target.id) {
      memory.targetId = target.id;
      memory.trail.length = 0;
      memory.onTargetMs = 0;
    }

    const distance = Math.hypot(
      target.position.x - self.position.x,
      target.position.y - self.position.y,
      target.position.z - self.position.z,
    );
    const fireWindow = Math.atan2(TARGET_HALF_WIDTH, Math.max(distance, 1));

    // Wandering aim error, re-drawn every drift period and interpolated.
    memory.aimDriftTime += dtSec;
    if (memory.aimDriftTime >= profile.aimDriftPeriod) {
      memory.aimDriftTime = 0;
      memory.aimErrorX = memory.aimErrorTargetX;
      memory.aimErrorZ = memory.aimErrorTargetZ;
      const speed = Math.hypot(target.velocity.x, target.velocity.y);
      const moving = Math.min(1, speed / AIM_FULL_PENALTY_SPEED) * profile.movingPenalty;
      const spread = profile.aimSpread * (1 + moving);
      memory.aimErrorTargetX = (Math.random() * 2 - 1) * spread;
      memory.aimErrorTargetZ = (Math.random() * 2 - 1) * spread * 0.5;
    }
    const blend = memory.aimDriftTime / profile.aimDriftPeriod;
    const errorX = memory.aimErrorX + (memory.aimErrorTargetX - memory.aimErrorX) * blend;
    const errorZ = memory.aimErrorZ + (memory.aimErrorTargetZ - memory.aimErrorZ) * blend;

    // Target lag: aim where the enemy was targetLagMs ago.
    memory.trailTime += dtSec * 1000;
    memory.trail.push({ t: memory.trailTime, x: target.position.x, y: target.position.y, z: target.position.z });
    while (memory.trail.length > 1 && memory.trailTime - memory.trail[0].t > profile.targetLagMs) {
      memory.trail.shift();
    }
    const lagged = memory.trail[0];

    // Error perpendicular to the line of fire (reads as a miss to the side).
    const ox = target.position.x - self.position.x;
    const oy = target.position.y - self.position.y;
    const flat = Math.hypot(ox, oy) || 1;
    const sideX = -oy / flat;
    const sideY = ox / flat;
    const aim = memory.aimPoint;
    aim.x = lagged.x + sideX * errorX * TARGET_HALF_WIDTH;
    aim.y = lagged.y + sideY * errorX * TARGET_HALF_WIDTH;
    aim.z = lagged.z + errorZ * TARGET_HALF_WIDTH;

    // Traverse only while actually off target (keeps the turret from hunting
    // by fractions of a degree and looping its rotation sound).
    let aimError = self.turretErrorTo(aim);
    let turretTarget: Vec3Like | null = null;
    if (aimError > fireWindow * Math.min(AIM_DEADZONE, profile.fireTolerance * DEADZONE_OF_TOLERANCE)) {
      memory.turretTarget.x = aim.x;
      memory.turretTarget.y = aim.y;
      memory.turretTarget.z = aim.z;
      turretTarget = memory.turretTarget;
    }

    // Gun elevation limit (relative to the HULL: on a slope the tilted hull
    // aims along it — in world terms the shot looked impossible and bots on a
    // climb never fired) and line of sight from BOTH the muzzle and the hull
    // centre (so the bot cannot snipe with only its barrel showing).
    const withinElevation = Math.abs(self.gunElevationTo(target.position)) <= MAX_FIRE_ELEVATION;
    self.muzzle(_muzzle);
    memory.hasLineOfSight =
      withinElevation && perception.canSee(_muzzle, target) && perception.canSee(self.position, target);

    const onTarget =
      self.upright &&
      memory.hasLineOfSight &&
      aimError < fireWindow * profile.fireTolerance &&
      distance < Math.min(profile.fireRange, self.weaponRange);
    memory.onTargetMs = onTarget ? memory.onTargetMs + dtSec * 1000 : 0;
    const fire = onTarget && memory.onTargetMs >= profile.reactionMs;
    return { turretTarget, aimPoint: aim, fire, target };
  };
}

export default GunnerService;
