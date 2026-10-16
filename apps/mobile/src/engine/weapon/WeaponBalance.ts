// Weapon balance, transcribed from the ProTanki server's garage data
// (src/main/resources/data/garage/items/weapons/*.json, modification "0" = M0).
//
// ProTanki is a hard fork of the same Tanki Online build this project ports,
// so these are the numbers the original client would have received from its
// server. They were NOT recoverable from the original client: the client only
// ever got damage already computed (see the port note on WEAPON_SPECS).
//
// Units, as the server stores them:
//  - damage           hit points
//  - reloadTime       SECONDS (WEAPON_CHARGE_RATE.WEAPON_RELOAD_TIME)
//  - turretTurnSpeed  DEGREES per second (TURRET_TURN_SPEED)
//  - weakening/splash radii in METRES
//  - impactForce      server units; the port's own forces are tuned separately
//                     and kept in WEAPON_SPECS, so these are recorded for
//                     reference rather than used.
//
// The json also carries a `damage.stream` block (capacity/charge/discharge),
// including on Ricochet which is not a stream weapon at all. Nothing in the
// server reads it — grep for `.stream` finds no consumer — so it is dropped
// here rather than presented as the gauge model.

import type { DamageConfig } from './DamageModel';

export interface WeaponBalance {
  damage: DamageConfig;
  /** Seconds between shots; absent for stream weapons. */
  reloadTime?: number;
  /** Degrees per second. */
  turretTurnSpeed: number;
  /** Server impact force, for reference. */
  impactForce?: number;
  /** Isida heals for this much per tick. */
  healFixed?: number;
  /** Isida heals ITSELF for this percentage of the healing it gives. */
  selfHealPercent?: number;
  /** Shaft's fully-charged aimed shot. */
  aimingModeMaxDamage?: number;
  /**
   * Smoky's crit, recorded from the data but NOT used: the server computes
   * `isCritical = false` unconditionally, so no shot ever crits there either.
   */
  criticalHitChance?: number;
  criticalHitDamage?: number;
  /** Firebird's heat cap (FIRE_DAMAGE.FLAME_TEMPERATURE_LIMIT). */
  flameTemperatureLimit?: number;
  /**
   * Vertical auto-aim arc, in RADIANS, from data/shots-data.json
   * (auto_aiming_up / auto_aiming_down). Every weapon has its own, and the
   * two directions differ — a gun reaches further DOWN than up.
   */
  aimUp?: number;
  aimDown?: number;
}

/** M0 balance for every weapon, keyed by the port's turret names. */
export const WEAPON_BALANCE: Record<string, WeaponBalance> = {
  Smoky: {
    aimUp: (9 * Math.PI) / 180,
    aimDown: (12 * Math.PI) / 180,
    damage: {
      range: { from: 22, to: 28 },
      weakening: { from: 44.35, to: 133.04, minimum: 0.1 },
    },
    // smoky.json has no WEAPON_RELOAD_TIME — the item is reload-less in the
    // server data and the client drove its own cadence.
    turretTurnSpeed: 71.5,
    impactForce: 175,
    criticalHitChance: 8,
    criticalHitDamage: 50,
  },
  Twins: {
    aimUp: (13 * Math.PI) / 180,
    aimDown: (16 * Math.PI) / 180,
    damage: {
      range: { from: 8.8, to: 10.5 },
      weakening: { from: 15, to: 65.03, minimum: 0.0578 },
    },
    turretTurnSpeed: 89.6,
    impactForce: 97,
  },
  Railgun: {
    aimUp: (6 * Math.PI) / 180,
    aimDown: (9 * Math.PI) / 180,
    damage: {
      range: { from: 68, to: 106 },
    },
    reloadTime: 5.85,
    turretTurnSpeed: 56.2,
    impactForce: 369,
  },
  Thunder: {
    aimUp: (9 * Math.PI) / 180,
    aimDown: (12 * Math.PI) / 180,
    damage: {
      range: { from: 42, to: 68 },
      weakening: { from: 56.93, to: 113.85, minimum: 0.5 },
      splash: { from: 0, to: 25, radius: 12 },
    },
    reloadTime: 3.15,
    turretTurnSpeed: 77,
    impactForce: 169,
  },
  Ricochet: {
    aimUp: (15 * Math.PI) / 180,
    aimDown: (18 * Math.PI) / 180,
    damage: {
      range: { from: 19, to: 23 },
      weakening: { from: 67.38, to: 81.06, minimum: 0 },
    },
    reloadTime: 0.56,
    turretTurnSpeed: 91.3,
    impactForce: 164,
  },
  Shaft: {
    aimUp: (12 * Math.PI) / 180,
    aimDown: (15 * Math.PI) / 180,
    damage: {
      range: { from: 41, to: 47 },
      // from === to === 100: no falloff at all, the floor is 1.
      weakening: { from: 100, to: 100, minimum: 1 },
    },
    reloadTime: 3.59,
    turretTurnSpeed: 71.5,
    impactForce: 199,
    aimingModeMaxDamage: 174,
  },
  Firebird: {
    damage: {
      fixed: 41,
      weakening: { from: 5, to: 23.74, minimum: 0.5 },
    },
    turretTurnSpeed: 95.3,
    reloadTime: 13.35,
    flameTemperatureLimit: 5.9,
  },
  Freeze: {
    damage: {
      fixed: 48,
      weakening: { from: 5, to: 24.75, minimum: 0.5 },
    },
    turretTurnSpeed: 125.1,
    reloadTime: 12.2,
  },
  Isida: {
    damage: {
      fixed: 36,
    },
    turretTurnSpeed: 91.7,
    reloadTime: 11.11,
    healFixed: 36,
    selfHealPercent: 35.97,
  },
};

/** Hull balance, from data/garage/items/hulls/*.json (modification "0"). */
export interface HullBalance {
  /** HULL_ARMOR — hit points. */
  armor: number;
  /** HULL_MASS — kilograms. */
  mass: number;
  /** HULL_SPEED — metres per second. */
  speed: number;
  /** HULL_TURN_SPEED — degrees per second. */
  turnSpeed: number;
  /** HULL_POWER.HULL_ACCELERATION. */
  acceleration: number;
}

export const HULL_BALANCE: Record<string, HullBalance> = {
  Wasp: { armor: 94, mass: 1376, speed: 10.8, turnSpeed: 93.9, acceleration: 9 },
  Hornet: { armor: 122, mass: 1616, speed: 10.0, turnSpeed: 90.8, acceleration: 10 },
  Hunter: { armor: 144, mass: 1761, speed: 8.0, turnSpeed: 75.8, acceleration: 9 },
  Viking: { armor: 195, mass: 2235, speed: 7.8, turnSpeed: 80.6, acceleration: 12 },
  Dictator: { armor: 188, mass: 2410, speed: 7.0, turnSpeed: 89.0, acceleration: 10 },
  Titan: { armor: 224, mass: 3571, speed: 5.3, turnSpeed: 55.7, acceleration: 11 },
  Mammoth: { armor: 268, mass: 4262, speed: 4.4, turnSpeed: 54.0, acceleration: 8 },
};

// --- modifications -----------------------------------------------------------
//
// Every weapon and hull ships in four modifications (M0..M3) with their own
// numbers: a Railgun M3 rolls 133..199 instead of M0's 68..106 and reloads in
// 4.44 s instead of 5.85. The tables below are generated verbatim from the
// server's garage data, so they are the real progression, not interpolation.
//
// The port does NOT gate these behind ranks or purchases — there is no
// progression here by design — they are simply selectable via ?mod=.

/** Per-modification weapon balance (M0..M3), from the same server data. */
export const WEAPON_MODS: Record<string, Record<string, WeaponBalance>> = {
  Firebird: {
    M0: { damage: { fixed: 41, weakening: { from: 5, to: 23.74, minimum: 0.5 } }, reloadTime: 13.35, turretTurnSpeed: 95.3 },
    M1: { damage: { fixed: 50, weakening: { from: 5, to: 25.65, minimum: 0.5 } }, reloadTime: 12.63, turretTurnSpeed: 116.9 },
    M2: { damage: { fixed: 60, weakening: { from: 5, to: 27.55, minimum: 0.5 } }, reloadTime: 11.92, turretTurnSpeed: 138.4 },
    M3: { damage: { fixed: 72, weakening: { from: 5, to: 30, minimum: 0.5 } }, reloadTime: 11.0, turretTurnSpeed: 166.2 },
  },
  Freeze: {
    M0: { damage: { fixed: 48, weakening: { from: 5, to: 24.75, minimum: 0.5 } }, reloadTime: 12.2, turretTurnSpeed: 125.1 },
    M1: { damage: { fixed: 60, weakening: { from: 5, to: 26.68, minimum: 0.5 } }, reloadTime: 11.43, turretTurnSpeed: 151.2 },
    M2: { damage: { fixed: 72, weakening: { from: 5, to: 28.62, minimum: 0.5 } }, reloadTime: 10.6, turretTurnSpeed: 177.3 },
    M3: { damage: { fixed: 80, weakening: { from: 5, to: 30, minimum: 0.5 } }, reloadTime: 10.0, turretTurnSpeed: 196 },
  },
  Isida: {
    M0: { damage: { fixed: 36 }, reloadTime: 11.11, turretTurnSpeed: 91.7, healFixed: 36, selfHealPercent: 35.97 },
    M1: { damage: { fixed: 47 }, reloadTime: 10.37, turretTurnSpeed: 106.7, healFixed: 47, selfHealPercent: 40.88 },
    M2: { damage: { fixed: 57 }, reloadTime: 9.63, turretTurnSpeed: 121.8, healFixed: 57, selfHealPercent: 45.79 },
    M3: { damage: { fixed: 66 }, reloadTime: 9.0, turretTurnSpeed: 134.7, healFixed: 66, selfHealPercent: 50.0 },
  },
  Railgun: {
    M0: { damage: { range: { from: 68, to: 106 } }, reloadTime: 5.85, turretTurnSpeed: 56.2, impactForce: 369 },
    M1: { damage: { range: { from: 90, to: 137 } }, reloadTime: 5.38, turretTurnSpeed: 70, impactForce: 479 },
    M2: { damage: { range: { from: 111, to: 168 } }, reloadTime: 4.91, turretTurnSpeed: 78.5, impactForce: 589 },
    M3: { damage: { range: { from: 133, to: 199 } }, reloadTime: 4.44, turretTurnSpeed: 97.4, impactForce: 700 },
  },
  Ricochet: {
    M0: { damage: { range: { from: 19, to: 23 }, weakening: { from: 67.38, to: 81.06, minimum: 0 } }, reloadTime: 0.56, turretTurnSpeed: 91.3, impactForce: 164 },
    M1: { damage: { range: { from: 24, to: 29 }, weakening: { from: 72.29, to: 88.43, minimum: 0 } }, reloadTime: 0.53, turretTurnSpeed: 110.2, impactForce: 193 },
    M2: { damage: { range: { from: 29, to: 35 }, weakening: { from: 77.19, to: 95.79, minimum: 0 } }, reloadTime: 0.49, turretTurnSpeed: 129, impactForce: 223 },
    M3: { damage: { range: { from: 32, to: 38 }, weakening: { from: 80, to: 100, minimum: 0 } }, reloadTime: 0.47, turretTurnSpeed: 139.8, impactForce: 240 },
  },
  Shaft: {
    M0: { damage: { range: { from: 41, to: 47 }, weakening: { from: 100, to: 100, minimum: 1 } }, reloadTime: 3.59, turretTurnSpeed: 71.5, impactForce: 199, aimingModeMaxDamage: 174 },
    M1: { damage: { range: { from: 51, to: 59 }, weakening: { from: 100, to: 100, minimum: 1 } }, reloadTime: 3.35, turretTurnSpeed: 86.8, impactForce: 253, aimingModeMaxDamage: 217 },
    M2: { damage: { range: { from: 62, to: 71 }, weakening: { from: 100, to: 100, minimum: 1 } }, reloadTime: 3.1, turretTurnSpeed: 102.1, impactForce: 307, aimingModeMaxDamage: 261 },
    M3: { damage: { range: { from: 66, to: 76 }, weakening: { from: 100, to: 100, minimum: 1 } }, reloadTime: 3.0, turretTurnSpeed: 108.7, impactForce: 330, aimingModeMaxDamage: 280 },
  },
  Smoky: {
    M0: { damage: { range: { from: 22, to: 28 }, weakening: { from: 44.35, to: 133.04, minimum: 0.1 } }, turretTurnSpeed: 71.5, impactForce: 175 },
    M1: { damage: { range: { from: 29, to: 37 }, weakening: { from: 49.11, to: 147.33, minimum: 0.1 } }, turretTurnSpeed: 87.1, impactForce: 222 },
    M2: { damage: { range: { from: 35, to: 45 }, weakening: { from: 53.88, to: 161.62, minimum: 0.1 } }, turretTurnSpeed: 102.6, impactForce: 269 },
    M3: { damage: { range: { from: 44, to: 56 }, weakening: { from: 60, to: 180, minimum: 0.1 } }, turretTurnSpeed: 122.6, impactForce: 330 },
  },
  Thunder: {
    M0: { damage: { range: { from: 42, to: 68 }, weakening: { from: 56.93, to: 113.85, minimum: 0.5 }, splash: { from: 0, to: 25, radius: 12 } }, reloadTime: 3.15, turretTurnSpeed: 77, impactForce: 169 },
    M1: { damage: { range: { from: 55, to: 83 }, weakening: { from: 61.75, to: 123.49, minimum: 0.5 }, splash: { from: 0, to: 25, radius: 12 } }, reloadTime: 2.91, turretTurnSpeed: 94.6, impactForce: 217 },
    M2: { damage: { range: { from: 68, to: 99 }, weakening: { from: 66.56, to: 133.12, minimum: 0.5 }, splash: { from: 0, to: 25, radius: 12 } }, reloadTime: 2.67, turretTurnSpeed: 112.3, impactForce: 265 },
    M3: { damage: { range: { from: 78, to: 110 }, weakening: { from: 70, to: 140, minimum: 0.5 }, splash: { from: 0, to: 25, radius: 12 } }, reloadTime: 2.5, turretTurnSpeed: 124.9, impactForce: 300 },
  },
  Twins: {
    M0: { damage: { range: { from: 8.8, to: 10.5 }, weakening: { from: 15, to: 65.03, minimum: 0.0578 } }, turretTurnSpeed: 89.6, impactForce: 97 },
    M1: { damage: { range: { from: 11.4, to: 13.9 }, weakening: { from: 15, to: 69.79, minimum: 0.103 } }, turretTurnSpeed: 103.9, impactForce: 117 },
    M2: { damage: { range: { from: 14, to: 17.2 }, weakening: { from: 15, to: 74.56, minimum: 0.1483 } }, turretTurnSpeed: 118.3, impactForce: 137 },
    M3: { damage: { range: { from: 17, to: 21 }, weakening: { from: 15, to: 80, minimum: 0.2 } }, turretTurnSpeed: 134.7, impactForce: 160 },
  },
};

/** Per-modification hull balance (M0..M3). */
export const HULL_MODS: Record<string, Record<string, HullBalance>> = {
  Dictator: {
    M0: { armor: 188, mass: 2410, speed: 7.0, turnSpeed: 89, acceleration: 10 },
    M1: { armor: 243, mass: 2722, speed: 7.3, turnSpeed: 103.3, acceleration: 12 },
    M2: { armor: 298, mass: 3033, speed: 7.7, turnSpeed: 117.7, acceleration: 13 },
    M3: { armor: 345, mass: 3300, speed: 8.0, turnSpeed: 130, acceleration: 15 },
  },
  Hornet: {
    M0: { armor: 122, mass: 1616, speed: 10.0, turnSpeed: 90.8, acceleration: 10 },
    M1: { armor: 154, mass: 1905, speed: 10.7, turnSpeed: 105.2, acceleration: 11 },
    M2: { armor: 187, mass: 2194, speed: 11.5, turnSpeed: 119.7, acceleration: 13 },
    M3: { armor: 210, mass: 2400, speed: 12.0, turnSpeed: 130, acceleration: 14 },
  },
  Hunter: {
    M0: { armor: 144, mass: 1761, speed: 8.0, turnSpeed: 75.8, acceleration: 9 },
    M1: { armor: 187, mass: 2047, speed: 8.6, turnSpeed: 95.3, acceleration: 10 },
    M2: { armor: 230, mass: 2333, speed: 9.2, turnSpeed: 114.9, acceleration: 11 },
    M3: { armor: 285, mass: 2700, speed: 10.0, turnSpeed: 140, acceleration: 13 },
  },
  Mammoth: {
    M0: { armor: 268, mass: 4262, speed: 4.4, turnSpeed: 54, acceleration: 8 },
    M1: { armor: 339, mass: 4743, speed: 4.6, turnSpeed: 64.1, acceleration: 10 },
    M2: { armor: 409, mass: 5225, speed: 4.9, turnSpeed: 74.2, acceleration: 11 },
    M3: { armor: 450, mass: 5500, speed: 5.0, turnSpeed: 80, acceleration: 12 },
  },
  Titan: {
    M0: { armor: 224, mass: 3571, speed: 5.3, turnSpeed: 55.7, acceleration: 11 },
    M1: { armor: 289, mass: 4047, speed: 5.5, turnSpeed: 67.1, acceleration: 13 },
    M2: { armor: 355, mass: 4524, speed: 5.8, turnSpeed: 78.6, acceleration: 14 },
    M3: { armor: 420, mass: 5000, speed: 6.0, turnSpeed: 90, acceleration: 16 },
  },
  Viking: {
    M0: { armor: 195, mass: 2235, speed: 7.8, turnSpeed: 80.6, acceleration: 12 },
    M1: { armor: 244, mass: 2550, speed: 8.3, turnSpeed: 92.7, acceleration: 14 },
    M2: { armor: 294, mass: 2865, speed: 8.8, turnSpeed: 104.8, acceleration: 16 },
    M3: { armor: 315, mass: 3000, speed: 9.0, turnSpeed: 110, acceleration: 17 },
  },
  Wasp: {
    M0: { armor: 94, mass: 1376, speed: 10.8, turnSpeed: 93.9, acceleration: 9 },
    M1: { armor: 121, mass: 1638, speed: 11.5, turnSpeed: 111.7, acceleration: 10 },
    M2: { armor: 149, mass: 1901, speed: 12.2, turnSpeed: 129.6, acceleration: 11 },
    M3: { armor: 180, mass: 2200, speed: 13.0, turnSpeed: 150, acceleration: 13 },
  },
};
