// Per-hull physics specs. In the original these came from the server
// (SpeedCharacteristicsModel init params + hull item properties) — numbers the
// original client never carried. They are now taken from the open-source
// ProTanki server, a hard fork of the same build this project ports:
// data/garage/items/hulls/*.json, modification "0" (M0).
//
//   HULL_ARMOR -> maxHealth, HULL_MASS -> mass,
//   HULL_SPEED (m/s) -> maxSpeed (units/s, 1 m = 100),
//   HULL_TURN_SPEED (deg/s) -> maxTurnSpeed (rad/s).
//
// The acceleration terms and damping BELOW were tuned by hand before the
// server's per-modification `physics` block was found (ModPhysics.ts: the
// four accelerations, damping and mass for every hull and M, exactly what
// the original server sent the client on spawn). getHullSpec now reads that
// block; this table remains the hull roster and the fallback for a hull or
// modification the block does not cover.
// Linear values in client units (1 m = 100 units), angular in rad/s.
import { HULL_MODS } from '../weapon/WeaponBalance';
import { HULL_PHYSICS } from '../weapon/ModPhysics';

export interface HullPhysicsSpec {
  mass: number;
  suspensionDampingCoeff: number;
  maxSpeed: number;
  maxTurnSpeed: number;
  acceleration: number;
  reverseAcceleration: number;
  sideAcceleration: number;
  turnAcceleration: number;
  reverseTurnAcceleration: number;
  maxHealth: number;
}

export const HULL_SPECS: Record<string, HullPhysicsSpec> = {
  Wasp: {
    mass: 1376,
    suspensionDampingCoeff: 600,
    maxSpeed: 1080,
    maxTurnSpeed: 1.64,
    acceleration: 1700,
    reverseAcceleration: 2100,
    sideAcceleration: 2600,
    turnAcceleration: 4.8,
    reverseTurnAcceleration: 6.5,
    maxHealth: 94,
  },
  Hornet: {
    mass: 1616,
    suspensionDampingCoeff: 700,
    maxSpeed: 1000,
    maxTurnSpeed: 1.58,
    acceleration: 1500,
    reverseAcceleration: 1900,
    sideAcceleration: 2400,
    turnAcceleration: 4.2,
    reverseTurnAcceleration: 5.8,
    maxHealth: 122,
  },
  Hunter: {
    mass: 1761,
    suspensionDampingCoeff: 1000,
    maxSpeed: 800,
    maxTurnSpeed: 1.32,
    acceleration: 1300,
    reverseAcceleration: 1700,
    sideAcceleration: 2200,
    turnAcceleration: 3.6,
    reverseTurnAcceleration: 5.0,
    maxHealth: 144,
  },
  Viking: {
    mass: 2235,
    suspensionDampingCoeff: 1200,
    maxSpeed: 780,
    maxTurnSpeed: 1.41,
    acceleration: 1150,
    reverseAcceleration: 1500,
    sideAcceleration: 2000,
    turnAcceleration: 3.2,
    reverseTurnAcceleration: 4.4,
    maxHealth: 195,
  },
  Dictator: {
    mass: 2410,
    suspensionDampingCoeff: 1400,
    maxSpeed: 700,
    maxTurnSpeed: 1.55,
    acceleration: 1000,
    reverseAcceleration: 1350,
    sideAcceleration: 1900,
    turnAcceleration: 2.9,
    reverseTurnAcceleration: 4.0,
    maxHealth: 188,
  },
  Titan: {
    mass: 3571,
    suspensionDampingCoeff: 1700,
    maxSpeed: 530,
    maxTurnSpeed: 0.97,
    acceleration: 900,
    reverseAcceleration: 1200,
    sideAcceleration: 1800,
    turnAcceleration: 2.6,
    reverseTurnAcceleration: 3.6,
    maxHealth: 224,
  },
  Mammoth: {
    mass: 4262,
    suspensionDampingCoeff: 2100,
    maxSpeed: 440,
    maxTurnSpeed: 0.94,
    acceleration: 800,
    reverseAcceleration: 1050,
    sideAcceleration: 1700,
    turnAcceleration: 2.3,
    reverseTurnAcceleration: 3.2,
    maxHealth: 268,
  },
};

/**
 * Hull physics for a modification — the server's `physics` block verbatim.
 *
 * HULL_PHYSICS carries, per hull and M, what the original server sent in
 * InitTankData: speed (m/s -> units/s), turn speed (rad/s), the four
 * acceleration terms (m/s^2 -> units/s^2; rad/s^2 as is), suspension
 * damping (the AS3 SuspensionParams.dampingCoeff, as is) and mass. Hit
 * points come from the garage table (HULL_MODS armor). This applies to M0
 * too: the hand-tuned HULL_SPECS numbers were hotter than the original's
 * (Hunter M0 accelerated at 13 m/s^2 here against the server's 9.09).
 *
 * Fallback, for a hull or M the block does not cover: the tuned M0 spec,
 * with the garage table's numbers applied where they map directly and the
 * rest scaled by the table's ratio to M0 (acceleration by HULL_ACCELERATION,
 * turn terms by turn speed, damping by mass).
 */
export function getHullSpec(hullName: string, modification = 'M0'): HullPhysicsSpec {
  const name = HULL_SPECS[hullName] != null ? hullName : 'Hunter';
  const base = HULL_SPECS[name];
  const physics = HULL_PHYSICS[name]?.[modification];
  const armor = HULL_MODS[name]?.[modification]?.armor;
  if (physics != null) {
    return {
      ...base,
      mass: physics.mass,
      maxSpeed: physics.speed * 100,
      maxTurnSpeed: physics.turnSpeed,
      acceleration: physics.acceleration * 100,
      reverseAcceleration: physics.reverseAcceleration * 100,
      sideAcceleration: physics.sideAcceleration * 100,
      turnAcceleration: physics.turnAcceleration,
      reverseTurnAcceleration: physics.reverseTurnAcceleration,
      suspensionDampingCoeff: physics.damping,
      maxHealth: armor ?? base.maxHealth,
    };
  }
  const mod = HULL_MODS[name]?.[modification];
  const m0 = HULL_MODS[name]?.M0;
  if (mod == null || m0 == null || modification === 'M0') {
    return base;
  }
  const accelerationRatio = mod.acceleration / m0.acceleration;
  const turnRatio = mod.turnSpeed / m0.turnSpeed;
  const massRatio = mod.mass / m0.mass;
  return {
    ...base,
    mass: mod.mass,
    maxSpeed: mod.speed * 100,
    maxTurnSpeed: (mod.turnSpeed * Math.PI) / 180,
    maxHealth: mod.armor,
    acceleration: base.acceleration * accelerationRatio,
    reverseAcceleration: base.reverseAcceleration * accelerationRatio,
    turnAcceleration: base.turnAcceleration * turnRatio,
    reverseTurnAcceleration: base.reverseTurnAcceleration * turnRatio,
    suspensionDampingCoeff: base.suspensionDampingCoeff * massRatio,
  };
}

/**
 * Nitro supply boost, shared by the client (Supplies applies it to the
 * chassis) and the server (the speed invariant must allow it, or every
 * nitro run slams into the correction "wall"). Raised by 30% over the
 * original's x1.3 speed / x1.5 acceleration.
 */
export const NITRO_SPEED_FACTOR = 1.69;
export const NITRO_ACCELERATION_FACTOR = 1.95;
