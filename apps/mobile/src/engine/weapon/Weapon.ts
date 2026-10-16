// Common weapon contract: the hitscan (RailgunWeapon), projectile and stream
// weapons all plug into GameTank through this interface.
import type { Vector3 } from '../math/Vector3';

export interface Weapon {
  setTrigger(pressed: boolean): void;
  update(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void;
  /** 0..1 readiness (reload progress or stream energy). */
  getStatus(timeMs: number): number;
  reset(): void;
  /**
   * Gauge weapons (stream, Shaft) can be topped up externally — the nuclear
   * fuel supply refills them. Timer-reload weapons simply don't implement it.
   */
  addEnergy?(delta: number): void;
}
