// Port of the original ShaftWeapon — the state
// machine simplified to the gameplay core: a short tap fires a weak QUICK
// shot; holding the trigger enters manual targeting where energy charges up
// (ShaftData.chargeRate -> maxEnergy) and the camera zooms in; releasing
// fires the AIMED shot with damage scaled by the stored energy; every shot
// is followed by afterShotPause. Dropped vs original: reticle/shrub-hiding
// SFX, turret slowdown coefficients, server shot validation.
import { Vector3 } from '../math/Vector3';
import { dealDamage } from './DamageSink';
import { RayHit } from '../physics/collision/types/RayHit';
import { MathUtils } from '../tank/MathUtils';
import type { Body } from '../physics/Body';
import type { IRayCollisionFilter } from '../physics/collision/filters';
import type { Tank } from '../tank/Tank';
import type { TanksCollisionDetector } from '../tank/TanksCollisionDetector';
import type { Weapon } from './Weapon';
import type { ShotResult, WeaponListener } from './RailgunWeapon';

const MAX_SHOT_DISTANCE = 100000;
/**
 * Elevation limit for the Shaft's own target snap, mirroring GameTank's
 * MAX_GUN_ELEVATION. Without it a close, low target made the correction below
 * steer the ray almost straight down.
 */
const MAX_SNAP_ELEVATION = (20 * Math.PI) / 180;
// Original ShaftWeapon.SWITCH_INTERVAL: shorter presses are quick shots
const SWITCH_INTERVAL_MS = 200;

export interface ShaftSpec {
  /** Balance profile id (WEAPON_BALANCE); see RailgunSpec.balance. */
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

// Port of MultibodyCollisionFilter (same as RailgunWeapon's)
class MultibodyCollisionFilter implements IRayCollisionFilter {
  private bodies: Body[] = [];
  addBody(body: Body): void {
    this.bodies.push(body);
  }
  clear(): void {
    this.bodies.length = 0;
  }
  considerBody(body: Body): boolean {
    return this.bodies.indexOf(body) < 0;
  }
}

const MIN_SHOT_PAUSE_MS = 300;

export class ShaftWeapon implements Weapon {
  /**
   * Charge fraction of the LAST shot (0 for a quick tap). The network layer
   * sends it with the hit claim so the server can recompute the same damage.
   */
  lastShotCharge = 0;
  private triggerPressed = false;
  private aiming = false;
  /**
   * A REMOTE Shaft's aim state, relayed over the network. Kept apart from
   * `aiming`: pulling the real trigger would FIRE a duplicate local shot on
   * release, so only this display flag is driven for remote tanks (it turns
   * the laser sight on in the render loop, nothing else).
   */
  private remoteAiming = false;
  /** Whether the shot being fired right now came out of sniper mode. */
  private aimedShot = false;
  private aimStartMs = 0;
  private readyTime = 0;
  /** Energy gauge 0..1 (ShaftData.maxEnergy) — shots spend it, time refills it. */
  private energy = 1;
  /** Energy available when targeting began — the charge can't exceed it. */
  private energyAtAimStart = 1;
  private lastUpdateMs = 0;

  private readonly filter = new MultibodyCollisionFilter();
  private readonly rayHit = new RayHit();
  private readonly _origin = new Vector3();
  private readonly _direction = new Vector3();

  constructor(
    private owner: Tank,
    private spec: ShaftSpec,
    private detector: TanksCollisionDetector,
    private listener: WeaponListener | null,
    private getAllTanks: () => Tank[] = () => [],
  ) {}

  // Port of VerticalAutoAiming (imported by the original ShaftWeapon): the
  // horizontal direction stays strictly along the barrel; only the vertical
  // component is corrected toward the enemy closest to the barrel line.
  private readonly _toTarget = new Vector3();

  private applyVerticalAutoAim(muzzle: Vector3, direction: Vector3): void {
    const AIM_CONE = 0.07; // ~4 degrees horizontally around the barrel
    let bestAngle = AIM_CONE;
    let bestTarget: Tank | null = null;
    for (const tank of this.getAllTanks()) {
      if (tank === this.owner || tank.isDead() || (tank.team !== 'dm' && tank.team === this.owner.team)) {
        continue;
      }
      this._toTarget.diff(tank.getBody().state.position, muzzle);
      const dot = direction.x * this._toTarget.x + direction.y * this._toTarget.y;
      if (dot <= 0) {
        continue;
      }
      const cross = direction.x * this._toTarget.y - direction.y * this._toTarget.x;
      const angle = Math.abs(Math.atan2(cross, dot));
      if (angle < bestAngle) {
        bestAngle = angle;
        bestTarget = tank;
      }
    }
    if (bestTarget != null) {
      const c = bestTarget.getBody().state.position;
      const dxy = Math.sqrt((c.x - muzzle.x) ** 2 + (c.y - muzzle.y) ** 2);
      if (dxy > 1) {
        // Clamp to the gun's elevation range. The old form set z from the raw
        // height/distance ratio, which for a close target far below resolved
        // to a near-vertical shot into the ground.
        const pitch = Math.max(
          -MAX_SNAP_ELEVATION,
          Math.min(MAX_SNAP_ELEVATION, Math.atan2(c.z - muzzle.z, dxy)),
        );
        const horizontal = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        if (horizontal > 1e-6) {
          const cos = Math.cos(pitch);
          direction.x = (direction.x / horizontal) * cos;
          direction.y = (direction.y / horizontal) * cos;
          direction.z = Math.sin(pitch);
          direction.normalize();
        }
      }
    }
  }

  setTrigger(pressed: boolean): void {
    this.triggerPressed = pressed;
  }

  /** HUD bar shows the energy gauge. */
  getStatus(): number {
    return this.energy;
  }

  /** 0..1 pumped charge while targeting — drives damage and the camera zoom. */
  getAimFraction(timeMs: number): number {
    if (!this.aiming) {
      return 0;
    }
    const pumped = MathUtils.clamp((timeMs - this.aimStartMs) / this.spec.chargeTimeMs, 0, 1);
    return Math.min(pumped, this.energyAtAimStart);
  }

  isAiming(): boolean {
    return this.aiming || this.remoteAiming;
  }

  setRemoteAiming(on: boolean): void {
    this.remoteAiming = on;
  }

  /** External energy change (Freeze vampirism etc.), clamped to 0..1. */
  addEnergy(delta: number): void {
    this.energy = Math.max(0, Math.min(1, this.energy + delta));
  }

  reset(): void {
    this.remoteAiming = false;
    this.triggerPressed = false;
    this.aiming = false;
    this.readyTime = 0;
    this.energy = 1;
  }

  update(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    const dtMs = this.lastUpdateMs > 0 ? timeMs - this.lastUpdateMs : 0;
    this.lastUpdateMs = timeMs;
    if (this.owner.isDead()) {
      this.aiming = false;
      return;
    }
    // Energy refills over time while not targeting (the tap "cooldown" is
    // simply waiting for the gauge to regain quickCost)
    if (!this.aiming) {
      this.energy = Math.min(1, this.energy + (dtMs * this.owner.energyRegenMultiplier) / this.spec.rechargeMsFull);
    }
    if (this.triggerPressed) {
      // The next shot unlocks only at a FULL gauge: a tap spends quickCost
      // and the cooldown is waiting for the gauge to refill to 100%
      if (!this.aiming && timeMs >= this.readyTime && this.energy >= 1) {
        this.aiming = true;
        this.aimStartMs = timeMs;
        this.energyAtAimStart = this.energy;
      }
    } else if (this.aiming) {
      // Release fires: a tap spends quickCost; holding pumped energy into the
      // charge — the aimed shot spends the charge and deals damage by it
      const heldMs = timeMs - this.aimStartMs;
      const charge = this.getAimFraction(timeMs);
      // A real aimed shot only if the player actually held the sight, not a
      // tap-and-release snap shot.
      this.aimedShot = heldMs >= SWITCH_INTERVAL_MS && charge >= this.spec.quickCost;
      this.aiming = false;
      this.readyTime = timeMs + MIN_SHOT_PAUSE_MS;
      let damage: number;
      if (heldMs < SWITCH_INTERVAL_MS || charge < this.spec.quickCost) {
        damage = this.spec.quickDamage;
        this.lastShotCharge = 0;
        this.energy = Math.max(0, this.energy - this.spec.quickCost);
      } else {
        damage = this.spec.quickDamage + (this.spec.maxDamage - this.spec.quickDamage) * charge;
        this.lastShotCharge = charge;
        this.energy = Math.max(0, this.energy - charge);
      }
      this.shoot(damage, getMuzzle, getDirection);
    }
  }

  // Penetrating hitscan ray — same core as the ported RailgunWeapon.shoot
  private shoot(baseDamage: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    getMuzzle(this._origin);
    getDirection(this._direction);
    const origin = this._origin;
    const direction = this._direction;
    // Sniper mode is hand-aimed (W/S set the elevation), so the target snap
    // must not override the angle the player dialled in. NOTE: the shot fires
    // on release, by which point `aiming` is already false — hence the
    // separate flag captured at that moment.
    if (!this.aimedShot) {
      this.applyVerticalAutoAim(origin, direction);
    }
    this.owner.getBody().addWorldForceScaled(origin, direction, -this.spec.recoilForce);
    const result: ShotResult = {
      origin: origin.clone(),
      direction: direction.clone(),
      endPoint: origin.clone().addScaled(MAX_SHOT_DISTANCE, direction),
      staticHit: false,
      hits: [],
    };
    this.filter.clear();
    this.filter.addBody(this.owner.getBody());
    let damage = baseDamage * this.owner.outgoingDamageMultiplier;
    let force = this.spec.impactForce;
    for (let i = 0; i < 8; i++) {
      const hasHit = this.detector.raycast(origin, direction, 0xffff, MAX_SHOT_DISTANCE, this.filter, this.rayHit);
      if (!hasHit) {
        break;
      }
      const hitBody = this.rayHit.shape!.body!;
      const target = hitBody.tank as Tank | null;
      if (target == null) {
        result.staticHit = true;
        result.endPoint.copy(this.rayHit.position);
        break;
      }
      if (target.team === 'dm' || target.team !== this.owner.team) {
        target.applyWeaponHit(this.rayHit.position, direction, force);
        const lethal = dealDamage({ source: this.owner, target, amount: damage, at: this.rayHit.position });
        result.hits.push({ tank: target, position: this.rayHit.position.clone(), lethal });
        damage *= this.spec.weakeningCoeff;
        force *= this.spec.weakeningCoeff;
      }
      this.filter.addBody(hitBody);
    }
    this.listener?.onShot(result);
  }
}
