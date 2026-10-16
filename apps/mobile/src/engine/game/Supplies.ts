// Battle supplies (original: the bottom-left panel, keys 1-5): first aid,
// double armor, double damage, nitro, nuclear fuel. No stock counting —
// cooldown only.
import { getHullSpec, NITRO_SPEED_FACTOR, NITRO_ACCELERATION_FACTOR } from '../tank/HullSpecs';
import type { GameTank } from './GameTank';

export type SupplyType = 'health' | 'armor' | 'damage' | 'nitro' | 'nuclear';

export const SUPPLY_TYPES: SupplyType[] = ['health', 'armor', 'damage', 'nitro', 'nuclear'];

/**
 * Nuclear fuel: tops the weapon up instantly — a full gauge for the stream and
 * Shaft guns, a cleared reload for the timer ones — then speeds BOTH recovery
 * paths by 45% for the duration, so the supply is worth taking whatever turret
 * is mounted.
 */
const NUCLEAR_BOOST = 1.45;

/**
 * RepairKitEffect on the ProTanki server is NOT instant: it heals
 * HEAL_PER_TICK every HEAL_TICK_MS for its duration, so a kit can be
 * out-damaged while it runs. Only the healing is taken from the server —
 * the timings here stay as tuned for this port, since supplies are free
 * hotkeys rather than the original's purchased inventory.
 *
 * 300 per tick is the server's own figure, and it exceeds every hull's total
 * health (94..268), so in practice the first tick tops the tank up. That is
 * the original behaviour: the kit is interruptible, not slow. Lowering it to
 * stretch the heal out would be this port inventing balance.
 */
const HEAL_PER_TICK = 300;
const HEAL_TICK_MS = 500;

const DURATION_MS: Record<SupplyType, number> = {
  health: 3000,
  armor: 15000,
  damage: 15000,
  nitro: 15000,
  nuclear: 15000,
};
const COOLDOWN_MS: Record<SupplyType, number> = {
  health: 15000,
  armor: 30000,
  damage: 30000,
  nitro: 30000,
  nuclear: 60000,
};

export interface SupplyState {
  /** 0 = ready, 1 = just used. */
  cooldownFraction: number;
  cooldownMsLeft: number;
  active: boolean;
  /** Milliseconds the effect still runs (0 when not active). */
  effectMsLeft: number;
}

export class Supplies {
  private cooldownLeft: Record<SupplyType, number> = { health: 0, armor: 0, damage: 0, nitro: 0, nuclear: 0 };
  private effectLeft: Record<SupplyType, number> = { health: 0, armor: 0, damage: 0, nitro: 0, nuclear: 0 };

  constructor(private gameTank: GameTank) {}

  isReady(type: SupplyType): boolean {
    return this.cooldownLeft[type] <= 0 && !this.gameTank.tank.isDead();
  }

  /** Fired on a SUCCESSFUL activation; the network layer reports it there. */
  onActivate: ((type: SupplyType) => void) | null = null;

  activate(type: SupplyType): boolean {
    if (!this.isReady(type)) {
      return false;
    }
    this.cooldownLeft[type] = COOLDOWN_MS[type];
    this.startEffect(type);
    this.onActivate?.(type);
    return true;
  }

  private startEffect(type: SupplyType): void {
    this.effectLeft[type] = DURATION_MS[type];
    const tank = this.gameTank.tank;
    switch (type) {
      case 'health':
        // Heals over time in update(), not in one lump.
        this.healTickLeft = HEAL_TICK_MS;
        break;
      case 'armor':
        tank.incomingDamageMultiplier = 0.5;
        break;
      case 'damage':
        // Original was x2; reduced to x1.5 so Railgun+supply (85*1.5=127.5)
        // no longer one-shots medium hulls (Hunter 130)
        tank.outgoingDamageMultiplier = 1.5;
        break;
      case 'nitro': {
        const spec = getHullSpec(this.gameTank.hullName);
        // Factors live in HullSpecs, shared with the server's speed invariant.
        // Immediate, not smoothed: the smoother raises the cap at only 100 u/s²
        // and the chassis scales its push by the reserve under the CURRENT cap,
        // so a tank already at top speed gained nothing until the driver let go
        // of the throttle and pressed again (5.5 s from 800 to 1352 otherwise).
        tank.speedBoost = NITRO_SPEED_FACTOR;
        tank.accelerationBoost = NITRO_ACCELERATION_FACTOR;
        tank.setMaxSpeed(spec.maxSpeed * NITRO_SPEED_FACTOR, true);
        tank.chassis.setAcceleration(spec.acceleration * NITRO_ACCELERATION_FACTOR);
        break;
      }
      case 'nuclear':
        // Instant top-up: a full gauge on stream/Shaft, a finished reload on
        // the timer turrets (every weapon implements addEnergy). Overdrive
        // restores the GUN only — healing is the repair kit's job.
        this.gameTank.weapon.addEnergy?.(1);
        tank.energyRegenMultiplier = NUCLEAR_BOOST;
        tank.supplyReloadMultiplier = 1 / NUCLEAR_BOOST;
        break;
    }
  }

  /**
   * `immediate` drops the nitro speed cap at once (respawn): the smoother
   * lowers it at only 100 u/s², so a tank that died under nitro kept its
   * boosted cap for ~5 s after spawning. The natural expiry keeps the fade.
   */
  private endEffect(type: SupplyType, immediate = false): void {
    const tank = this.gameTank.tank;
    switch (type) {
      case 'armor':
        tank.incomingDamageMultiplier = 1;
        break;
      case 'damage':
        tank.outgoingDamageMultiplier = 1;
        break;
      case 'nitro': {
        const spec = getHullSpec(this.gameTank.hullName);
        tank.speedBoost = 1;
        tank.accelerationBoost = 1;
        tank.setMaxSpeed(spec.maxSpeed, immediate);
        tank.chassis.setAcceleration(spec.acceleration);
        break;
      }
      case 'nuclear':
        tank.energyRegenMultiplier = 1;
        tank.supplyReloadMultiplier = 1;
        break;
    }
  }

  /** Ends one running effect early (the repair kit when its tank is hit); the cooldown keeps ticking. */
  cancel(type: SupplyType): void {
    if (this.effectLeft[type] > 0) {
      this.effectLeft[type] = 0;
      this.endEffect(type);
    }
  }

  /** Clears running effects at once (death/respawn); cooldowns keep ticking. */
  clearEffects(): void {
    for (const type of SUPPLY_TYPES) {
      if (this.effectLeft[type] > 0) {
        this.effectLeft[type] = 0;
        this.endEffect(type, true);
      }
    }
  }

  /** Countdown to the repair kit's next heal tick. */
  private healTickLeft = 0;

  update(dtMs: number): void {
    if (this.effectLeft.health > 0) {
      this.healTickLeft -= dtMs;
      if (this.healTickLeft <= 0) {
        this.healTickLeft += HEAL_TICK_MS;
        const tank = this.gameTank.tank;
        if (tank.health < tank.maxHealth) {
          tank.heal(HEAL_PER_TICK);
        }
      }
    }
    for (const type of SUPPLY_TYPES) {
      if (this.cooldownLeft[type] > 0) {
        this.cooldownLeft[type] = Math.max(0, this.cooldownLeft[type] - dtMs);
      }
      if (this.effectLeft[type] > 0) {
        this.effectLeft[type] -= dtMs;
        if (this.effectLeft[type] <= 0) {
          this.effectLeft[type] = 0;
          this.endEffect(type);
        }
      }
    }
  }

  getState(type: SupplyType): SupplyState {
    return {
      cooldownFraction: this.cooldownLeft[type] / COOLDOWN_MS[type],
      cooldownMsLeft: this.cooldownLeft[type],
      active: this.effectLeft[type] > 0,
      effectMsLeft: Math.max(0, this.effectLeft[type]),
    };
  }
}
