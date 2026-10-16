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
// Acceleration and suspension are NOT from the server: HULL_ACCELERATION is a
// single scalar there (7..12) with no documented mapping onto this port's
// four acceleration terms, so those stay as tuned.
// Linear values in client units (1 m = 100 units), angular in rad/s.

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

export function getHullSpec(hullName: string): HullPhysicsSpec {
  return HULL_SPECS[hullName] ?? HULL_SPECS.Hunter;
}

/**
 * Nitro supply boost, shared by the client (Supplies applies it to the
 * chassis) and the server (the speed invariant must allow it, or every
 * nitro run slams into the correction "wall"). Raised by 30% over the
 * original's x1.3 speed / x1.5 acceleration.
 */
export const NITRO_SPEED_FACTOR = 1.69;
export const NITRO_ACCELERATION_FACTOR = 1.95;
