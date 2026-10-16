// Per-turret weapon DATA, extracted from GameTank.ts so the multiplayer server
// can import it: this module is pure values and types — no PlayCanvas, no DOM,
// no engine classes — and must stay that way (the Cloudflare worker bundles it,
// and its tsc runs with lib ES2022). GameTank re-exports everything, so game
// code keeps importing from there.
//
// Per-turret weapon behavior (original: server-driven weapon configs).
// Three honest mechanics like the original models: hitscan (railgun/shaft/
// smoky family), projectile (plasma Twins, Ricochet with bounces, Thunder
// with SplashParams falloff) and stream (flamethrower/streamweapon models:
// cone ticks + energy gauge; Isida vampirism).

export interface SplashSpec {
  /** Full-damage radius (SplashParams.maxSplashDamageRadius). */
  fullRadius: number;
  /** Zero-ish damage radius (minSplashDamageRadius). */
  minRadius: number;
  /** Percent of damage at minRadius (minSplashDamagePercent, 0..100). */
  minPercent: number;
}

// Original SplashParams.getSplashImpactCoeff
export function splashCoeff(distance: number, splash: SplashSpec): number {
  if (distance < splash.fullRadius) {
    return 1;
  }
  if (distance > splash.minRadius) {
    return 0;
  }
  return 0.01 * (splash.minPercent + ((splash.minRadius - distance) * (100 - splash.minPercent)) / (splash.minRadius - splash.fullRadius));
}

// Structural mirrors of the weapon classes' spec interfaces (WeaponSpec,
// ProjectileSpec, StreamSpec, ShaftSpec). They are duplicated here RATHER THAN
// imported because the weapon classes pull in PlayCanvas, which the server
// cannot type-check; TypeScript's structural typing keeps the two in lockstep —
// a drifted field fails to compile at the weapon constructors in GameTank.

export interface HitscanSpecData {
  /** ms between shots (nextTime += reloadTime). */
  reloadTime: number;
  /** ms of charge before the shot leaves the barrel (0 = instant). */
  chargingDuration: number;
  /** Balance profile id (WEAPON_BALANCE): gaussian base roll + weakening. */
  balance?: string;
  /** hp damage on the first target; multiplied by weakeningCoeff per penetration. */
  damage: number;
  weakeningCoeff: number;
  impactForce: number;
  recoilForce: number;
  /** Max shot distance in units; default unlimited. */
  maxRange?: number;
}

export interface ProjectileSpecData {
  balance?: string;
  reloadTime: number;
  damage: number;
  speed: number; // units/s
  impactForce: number;
  recoilForce: number;
  maxRange: number;
  bounces: number; // Ricochet
  splash: SplashSpec | null; // Thunder
  color: { r: number; g: number; b: number };
  /** Original shell sprite (horizontal flipbook strip when frames > 1). */
  sprite?: { url: string; frames: number; size: number };
  alphaFadeDistance?: number;
  spinRate?: number;
}

export interface StreamSpecData {
  balance?: string;
  /** ms between damage ticks while streaming. */
  tickInterval: number;
  damagePerTick: number;
  /** Cone half-angle in radians (ConicAreaData.coneAngle). */
  coneHalfAngle: number;
  maxRange: number;
  impactForce: number;
  /** Seconds of continuous fire from full to empty. */
  drainSeconds: number;
  /** Seconds from empty back to full. */
  regenSeconds: number;
  /** Fraction of dealt damage returned to the owner as healing (Isida). */
  selfHealFraction: number;
  /** Isida's healing mode: hp per tick restored to a TEAMMATE in the cone. */
  healPerTick?: number;
}

export interface ShaftSpecData {
  balance?: string;
  quickDamage: number;
  /** Aimed shot damage at full charge. */
  maxDamage: number;
  /** ms of holding to pump a FULL charge (ShaftData.dischargeRate analog). */
  chargeTimeMs: number;
  /** ms for the energy gauge to refill from empty (chargeRate analog). */
  rechargeMsFull: number;
  /** Energy cost of a quick tap shot (quickShotEnergy, fraction of the gauge). */
  quickCost: number;
  weakeningCoeff: number;
  impactForce: number;
  recoilForce: number;
}

export type AnyWeaponSpec =
  | ({ kind: 'hitscan' } & HitscanSpecData)
  | ({ kind: 'projectile' } & ProjectileSpecData)
  | ({ kind: 'stream' } & StreamSpecData)
  | ({ kind: 'shaft' } & ShaftSpecData);

// Damage/reload values: the original client received them from the server
// (SplashCC and friends carry no numbers in the decompiled code), so these
// follow the classic game's M0 balance tables: Smoky ~19, Twins ~10/shot,
// Thunder ~36, Railgun ~85, Shaft ~100 (no zoom), Ricochet ~20.
// impactForce / recoilForce are scaled to match the buffed damage: in the
// original both are a coefficient times WeaponConst.BASE_IMPACT_FORCE (5e6)
// and track the punch of ONE shot, so each weapon's force is multiplied by its
// own per-shot damage ratio against the pre-buff baseline:
//   Railgun 85->240 (x2.82)   Smoky 28->48 (x1.71)   Thunder 60->100 (x1.67)
//   Ricochet 32->50 (x1.56)   Freeze 4->7 (x1.75)    Firebird 6->10 (x1.67)
//   Isida 7->8 (x1.14)        Shaft 120->85 (x0.71)  Twins: force unchanged
// Shaft scales DOWN: its per-shot damage fell (it makes it up with the charge
// mechanic), and knockback is per hit, not per second.
export const WEAPON_SPECS: Record<string, AnyWeaponSpec> = {
  // Railgun: charge 1160 ms, reload 5846 ms, penetration falloff 0.3536.
  Railgun: {
    kind: 'hitscan', balance: 'Railgun', reloadTime: 5846, chargingDuration: 1160,
    damage: 87, weakeningCoeff: 0.3536, impactForce: 25.4e6, recoilForce: 12.7e6,
  },
  // Shaft: reload 3590 ms. Aimed-shot damage is SHAFT_AIMING_MODE_MAX_DAMAGE
  // (174); a snap shot rolls the plain 41..47 range, so quickDamage is its
  // midpoint. The gauge (max_energy 1000, fastShotEnergy 443.28) maps onto
  // quickCost = 443.28 / 1000.
  Shaft: {
    kind: 'shaft', balance: 'Shaft', quickDamage: 44, maxDamage: 174,
    chargeTimeMs: 3000, rechargeMsFull: 10000, quickCost: 0.443,
    weakeningCoeff: 1, impactForce: 8.5e6, recoilForce: 4.25e6,
  },
  // Smoky: reload 1848 ms (shots-data; the garage item carries no reload).
  Smoky: {
    kind: 'hitscan', balance: 'Smoky', reloadTime: 1848, chargingDuration: 0,
    damage: 25, weakeningCoeff: 1, impactForce: 5.14e6, recoilForce: 2.57e6,
  },
  // Thunder: reload 3153 ms, splash radius 12 m with a 25% floor.
  Thunder: {
    kind: 'projectile', balance: 'Thunder', reloadTime: 3153, damage: 55, speed: 3800,
    impactForce: 11.7e6, recoilForce: 5.83e6,
    maxRange: 20000, bounces: 0,
    splash: { fullRadius: 0, minRadius: 1200, minPercent: 25 },
    color: { r: 1, g: 0.75, b: 0.3 },
    sprite: { url: '/turrets/thunder/m0/shot.png', frames: 1, size: 110 },
  },
  Twins: {
    // PlasmaShotParams: sprite fades over the last 500 units of range and
    // spins at 3 rad/s (PlasmaShot.render).
    // Server: reload 250 ms, shell speed and range both 65.03 m.
    kind: 'projectile', balance: 'Twins', reloadTime: 250, damage: 9.65, speed: 6503,
    impactForce: 1.14e6, recoilForce: 0.57e6,
    alphaFadeDistance: 500, spinRate: 3,
    maxRange: 6503, bounces: 0, splash: null, color: { r: 0.4, g: 0.8, b: 1 },
    sprite: { url: '/turrets/twins/m0/shot.png', frames: 1, size: 90 },
  },
  Ricochet: {
    // Server: reload 565 ms, shell speed 94.75 m/s, range 81.06 m,
    // maxRicochetCount 20 (the original client bounced until the range ran out).
    kind: 'projectile', balance: 'Ricochet', reloadTime: 565, damage: 21, speed: 9475,
    impactForce: 5e6, recoilForce: 2.5e6,
    maxRange: 8106, bounces: 20, splash: null, color: { r: 1, g: 0.35, b: 0.75 },
    sprite: { url: '/turrets/ricochet/m0/ricochet_shot.png', frames: 10, size: 110 },
  },
  // Streams deal DAMAGE_PER_PERIOD over a 500 ms tick (shots-data
  // tickIntervalMsec). The port keeps its finer tick for smoother feel, so the
  // per-tick damage is scaled to the same DPS: Firebird 82, Freeze 96,
  // Isida 72 damage per second.
  Firebird: {
    kind: 'stream', balance: 'Firebird', tickInterval: 160, damagePerTick: 13.12,
    coneHalfAngle: 0.3490658503988659, maxRange: 2255, impactForce: 0.67e6,
    drainSeconds: 5, regenSeconds: 13.35, selfHealFraction: 0,
  },
  Freeze: {
    kind: 'stream', balance: 'Freeze', tickInterval: 160, damagePerTick: 15.36,
    coneHalfAngle: 0.35, maxRange: 2475, impactForce: 0.53e6,
    drainSeconds: 9, regenSeconds: 12.2, selfHealFraction: 0,
  },
  // Isida: ISIS_SELF_HEALING_PERCENT 35.97 — it heals ITSELF for ~36% of what
  // it deals/heals, which the original client never showed (it lived server-side).
  Isida: {
    kind: 'stream', balance: 'Isida', tickInterval: 180, damagePerTick: 12.96,
    healPerTick: 12.96, coneHalfAngle: 0.18, maxRange: 1800, impactForce: 0.34e6,
    drainSeconds: 7, regenSeconds: 11.11, selfHealFraction: 0.3597,
  },
};
