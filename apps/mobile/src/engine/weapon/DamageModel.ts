// Port of the ProTanki server's damage model
// (jp.assasans.protanki.server.battles.DamageCalculator + extensions/Random.kt).
//
// ProTanki is a hard fork of the same Tanki Online build this project ports,
// and its server is open source — which is where these formulas and the
// balance table in WeaponBalance.ts come from. The original client never
// saw them: damage arrived from the server already computed, so no amount of
// reading the decompile could recover them.
//
// The model has three independent parts, multiplied together:
//
//   damage = gaussianRange(from, to) * weakening(distance) * splash(distance)
//
// Differences from the server:
//  - critical hits are NOT implemented. The server reads CRITICAL_HIT_CHANCE /
//    CRITICAL_HIT_DAMAGE from the item (Smoky has 8% / 50) but then hardcodes
//    `isCritical = false` in DamageCalculator.calculate, so no shot ever crits.
//    Porting the data without the (absent) behaviour would be inventing it.
//  - distances here are in SIM UNITS; the server works in metres. Callers
//    convert at the boundary — see WEAKENING_UNITS_PER_METER.

/** The sim runs at 1 m = 100 units (see simRoot in main.ts). */
export const UNITS_PER_METER = 100;

/** Damage falls off between two radii, down to a floor multiplier. */
export interface Weakening {
  /** Full damage up to this distance, in metres. */
  from: number;
  /** Minimum damage from this distance on, in metres. */
  to: number;
  /** The floor, as a fraction of base damage. */
  minimum: number;
}

/** Splash ring around a shell's impact point. */
export interface Splash {
  from: number;
  to: number;
  /** Radius in metres. */
  radius: number;
}

/** Base damage is rolled from this range per shot. */
export interface DamageRange {
  from: number;
  to: number;
}

/**
 * Port of Random.nextGaussianRange.
 *
 * The server does NOT roll uniformly: it centres a normal distribution on the
 * middle of the range with sigma = width / 6 (the three-sigma rule, so ~99.7%
 * of rolls land inside without clamping) and then clamps the tails. Shots
 * therefore cluster near the average, and the extremes are rare — a uniform
 * roll would feel noticeably swingier.
 */
export function gaussianRange(from: number, to: number, random: () => number = Math.random): number {
  const mean = (from + to) / 2;
  const deviation = (to - from) / 6;
  const value = mean + deviation * standardNormal(random);
  return Math.min(to, Math.max(from, value));
}

/**
 * Box–Muller transform: Java's Random.nextGaussian(), which the server calls
 * through asJavaRandom(), draws from the standard normal distribution. There
 * is no such primitive in JS, so it is generated here.
 */
function standardNormal(random: () => number): number {
  // u must not be 0: log(0) is -Infinity.
  let u = 0;
  while (u === 0) {
    u = random();
  }
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Port of DamageCalculator.getWeakeningMultiplier. `distance` is in METRES,
 * matching the server's units.
 */
export function weakeningMultiplier(weakening: Weakening, distance: number): number {
  const { from: maxDamageRadius, to: minDamageRadius, minimum } = weakening;
  // The server throws when the radii are inverted; Shaft's own config has
  // from === to (100/100), which is not inverted and means "no falloff".
  if (maxDamageRadius > minDamageRadius) {
    throw new Error('weakening.from must not exceed weakening.to');
  }
  if (distance <= maxDamageRadius) {
    return 1;
  }
  if (distance >= minDamageRadius) {
    return minimum;
  }
  return (
    minimum +
    ((minDamageRadius - distance) * (1 - minimum)) / (minDamageRadius - maxDamageRadius)
  );
}

/**
 * Port of DamageCalculator.getSplashMultiplier.
 *
 * NOTE: the server's own source marks this "TODO(Assasans): Incorrect
 * implementation" — at distance 0 it returns (to - from) rather than `to`,
 * so it is a damage DELTA, not a multiplier, despite the name. It is ported
 * verbatim anyway: matching the fork's behaviour is the point, and "fixing"
 * it here would silently change every shell's splash.
 */
export function splashMultiplier(splash: Splash, distance: number): number {
  const { from: minimumDamage, to: maximumDamage, radius } = splash;
  if (minimumDamage > maximumDamage) {
    throw new Error('splash.from must not exceed splash.to');
  }
  if (distance >= radius) {
    return minimumDamage;
  }
  return (1 - distance / radius) * (maximumDamage - minimumDamage);
}

/**
 * Base damage for one shot, before any distance falloff: a gaussian roll for
 * weapons with a range, the flat value for stream weapons. Split out from
 * calculateDamage so a penetrating shot can roll once and then fade the result
 * per target.
 */
export function rollBaseDamage(config: DamageConfig, random: () => number = Math.random): number {
  if (config.range != null) {
    return gaussianRange(config.range.from, config.range.to, random);
  }
  if (config.fixed == null) {
    throw new Error('DamageConfig needs either a range or a fixed value');
  }
  return config.fixed;
}

export interface DamageConfig {
  /** Rolled per shot; weapons with `fixed` instead use that value. */
  range?: DamageRange;
  /** Streams (Firebird/Freeze/Isida) deal a fixed amount per tick. */
  fixed?: number;
  weakening?: Weakening;
  splash?: Splash;
}

/**
 * Port of DamageCalculator.calculate.
 *
 * `distanceUnits` is in SIM UNITS and converted here, so callers can pass the
 * raw distance the physics gives them.
 */
export function calculateDamage(
  config: DamageConfig,
  distanceUnits: number,
  options: { splash?: boolean; random?: () => number } = {},
): number {
  const random = options.random ?? Math.random;
  const base =
    config.range != null
      ? gaussianRange(config.range.from, config.range.to, random)
      : config.fixed;
  if (base == null) {
    throw new Error('DamageConfig needs either a range or a fixed value');
  }
  const distance = distanceUnits / UNITS_PER_METER;
  const weakening = config.weakening != null ? weakeningMultiplier(config.weakening, distance) : 1;
  const splash =
    options.splash === true && config.splash != null ? splashMultiplier(config.splash, distance) : 1;
  return base * weakening * splash;
}
