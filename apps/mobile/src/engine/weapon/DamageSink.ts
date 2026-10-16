// The one place damage is applied.
//
// Every weapon used to call `target.takeDamage(amount)` itself, on the
// shooter's machine, with no record of who fired or with what. That is exactly
// the decision a server owns — the original's DamageProcessor took
// (source, target, amount) and answered with a damage type — so the weapons
// now REPORT damage here instead of applying it.
//
// Locally this applies the hit immediately, so behaviour is unchanged. With a
// server, `apply` becomes "send a hit report and wait for setHealth", and no
// weapon needs to know the difference.

import type { Tank } from '../tank/Tank';

export interface DamageReport {
  /** Who fired. Null for world damage (drowning, a wreck's blast). */
  source: Tank | null;
  target: Tank;
  /** Hit points, already scaled by range falloff and the shooter's buffs. */
  amount: number;
  /** Splash rather than a direct hit; the server distinguishes the two. */
  splash?: boolean;
  /**
   * Where the hit landed (ray hit point, or the shell's detonation point for
   * splash). The network applier sends it as the splash epicentre.
   */
  at?: { x: number; y: number; z: number };
  /**
   * Isida on a teammate: the amount HEALS the target instead of hurting it.
   * Routed through here (not a direct tank.heal) so the server applier sees
   * healing too — a silent local heal would desync hp from the server.
   */
  heal?: boolean;
}

/** True when the hit killed the target. */
export type DamageApplier = (report: DamageReport) => boolean;

/**
 * Applies damage locally — the port's default, and what a single-player
 * battle keeps using.
 */
export const applyDamageLocally: DamageApplier = ({ target, amount, heal }) => {
  if (heal === true) {
    target.heal(amount);
    return false;
  }
  return target.takeDamage(amount);
};

/**
 * The applier the weapons call. Swapping this one binding is what moves the
 * game from client-authoritative to server-authoritative damage.
 */
let applier: DamageApplier = applyDamageLocally;

export function setDamageApplier(next: DamageApplier): void {
  applier = next;
}

export function dealDamage(report: DamageReport): boolean {
  if (report.amount <= 0) {
    return false;
  }
  return applier(report);
}
