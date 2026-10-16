// Port of the RailgunWeapon mechanics (charging -> penetrating ray shot ->
// recoil/impact forces -> reload) + DirectionProcessorForPenetratingWeapons
// (repeated raycast excluding already-hit bodies until static geometry stops
// the ray). Differences vs original: damage is applied locally (the original
// server decided damage), effects go through a callback, no OSGi/LogicUnit —
// the owner calls update() every physics step.
import { Vector3 } from '../math/Vector3';
import { dealDamage } from './DamageSink';
import { rollBaseDamage, weakeningMultiplier, UNITS_PER_METER } from './DamageModel';
import { WEAPON_BALANCE, type WeaponBalance } from './WeaponBalance';
import { RayHit } from '../physics/collision/types/RayHit';
import { MathUtils } from '../tank/MathUtils';
import type { Body } from '../physics/Body';
import type { IRayCollisionFilter } from '../physics/collision/filters';
import type { Tank } from '../tank/Tank';
import type { TanksCollisionDetector } from '../tank/TanksCollisionDetector';

const MAX_SHOT_DISTANCE = 100000; // RailgunUtils.BIG_DISTANCE
const SHOT_COLLISION_GROUP = 0xffff;

export interface WeaponSpec {
  /** ms between shots (nextTime += reloadTime). */
  reloadTime: number;
  /** ms of charge before the shot leaves the barrel (0 = instant). */
  chargingDuration: number;
  /**
   * Balance profile id (WEAPON_BALANCE). When set, base damage is rolled from
   * the server's gaussian range and faded by its distance weakening instead of
   * using the flat `damage` below.
   */
  balance?: string;
  /** hp damage on the first target; multiplied by weakeningCoeff per penetration. */
  damage: number;
  weakeningCoeff: number;
  impactForce: number;
  recoilForce: number;
  /** Max shot distance in units (stream weapons are short-ranged); default unlimited. */
  maxRange?: number;
}

export interface ShotHit {
  tank: Tank;
  position: Vector3;
  lethal: boolean;
}

export interface ShotResult {
  origin: Vector3;
  direction: Vector3;
  /** End of the tracer: static hit point or a distant point. */
  endPoint: Vector3;
  staticHit: boolean;
  hits: ShotHit[];
}

export interface WeaponListener {
  onShot(result: ShotResult): void;
  /**
   * RailgunCallback.onStartCharging — the trigger was pressed and the charge
   * began. The original plays the railgun sound HERE (RailgunWeapon.startCharging
   * calls effects.createSoundEffect), not on the shot itself: the mp3 is the
   * charge-up whine that resolves into the discharge.
   */
  onStartCharging?(): void;
}

// Port of MultibodyCollisionFilter
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

export class RailgunWeapon {
  private spec: WeaponSpec;
  private owner: Tank;
  private detector: TanksCollisionDetector;
  private listener: WeaponListener | null;

  private nextTime = 0;
  private charging = false;
  private triggerPressed = false;

  private readonly filter = new MultibodyCollisionFilter();
  private readonly rayHit = new RayHit();
  private readonly _origin = new Vector3();
  private readonly _direction = new Vector3();

  constructor(owner: Tank, spec: WeaponSpec, detector: TanksCollisionDetector, listener: WeaponListener | null = null) {
    this.owner = owner;
    this.spec = spec;
    this.detector = detector;
    this.listener = listener;
  }

  setTrigger(pressed: boolean): void {
    this.triggerPressed = pressed;
  }

  /** True while the pre-shot charge runs (drives the muzzle charge effect). */
  isCharging(): boolean {
    return this.charging;
  }

  /** ms the charge takes (ChargeEffect plays its frames over exactly this). */
  getChargingDuration(): number {
    return this.spec.chargingDuration;
  }

  /**
   * Nuclear fuel tops the weapon up. With no gauge to fill, the equivalent is
   * clearing the pending reload (a charge in progress is left alone — the shot
   * still has to finish charging).
   */
  addEnergy(delta: number): void {
    if (delta > 0 && !this.charging) {
      this.nextTime = 0;
    }
  }

  /** 0..1 reload/charge progress (original getStatus). */
  getStatus(timeMs: number): number {
    if (this.charging) {
      return MathUtils.clamp((this.nextTime - timeMs) / this.spec.chargingDuration, 0, 1);
    }
    const reload = this.spec.reloadTime * this.owner.getReloadScale();
    return MathUtils.clamp(1 - (this.nextTime - timeMs) / reload, 0, 1);
  }

  reset(): void {
    this.charging = false;
    this.nextTime = 0;
    this.triggerPressed = false;
  }

  /**
   * Original RailgunWeapon.runLogic. getMuzzle/getDirection supply the gun
   * params (original WeaponPlatform.getAllGunParams).
   */
  update(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    if (this.owner.isDead()) {
      this.charging = false;
      return;
    }
    if (this.charging) {
      if (timeMs >= this.nextTime) {
        this.shoot(timeMs, getMuzzle, getDirection);
      }
    } else if (this.triggerPressed && timeMs >= this.nextTime) {
      if (this.spec.chargingDuration > 0) {
        // RailgunWeapon.startCharging
        this.charging = true;
        this.nextTime = timeMs + this.spec.chargingDuration;
        this.listener?.onStartCharging?.();
      } else {
        this.shoot(timeMs, getMuzzle, getDirection);
      }
    }
  }

  private shoot(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    this.charging = false;
    this.nextTime = timeMs + this.spec.reloadTime * this.owner.getReloadScale();
    getMuzzle(this._origin);
    getDirection(this._direction);
    const origin = this._origin;
    const direction = this._direction;

    // Recoil on own hull (original: addWorldForceScaled(muzzle, dir, -recoil))
    this.owner.getBody().addWorldForceScaled(origin, direction, -this.spec.recoilForce);

    // Penetrating ray: keep casting past hit tanks until static geometry
    const range = this.spec.maxRange ?? MAX_SHOT_DISTANCE;
    const result: ShotResult = {
      origin: origin.clone(),
      direction: direction.clone(),
      endPoint: origin.clone().addScaled(range, direction),
      staticHit: false,
      hits: [],
    };
    this.filter.clear();
    this.filter.addBody(this.owner.getBody());
    // Base damage is rolled ONCE per shot (the server's gaussian range); the
    // distance weakening is applied per hit below, since each penetrated tank
    // sits at a different range. `weakeningCoeff` is a DIFFERENT mechanic —
    // the per-penetration falloff — so the two multiply independently.
    const balance = (this.spec as { modBalance?: WeaponBalance }).modBalance
      ?? (this.spec.balance != null ? WEAPON_BALANCE[this.spec.balance] : undefined);
    let damage = balance != null
      ? rollBaseDamage(balance.damage) * this.owner.outgoingDamageMultiplier
      : this.spec.damage * this.owner.outgoingDamageMultiplier;
    let force = this.spec.impactForce;
    for (let i = 0; i < 8; i++) {
      const hasHit = this.detector.raycast(origin, direction, SHOT_COLLISION_GROUP, range, this.filter, this.rayHit);
      if (!hasHit) {
        break;
      }
      const hitBody = this.rayHit.shape!.body!;
      const target = hitBody.tank as Tank | null;
      if (target == null) {
        // Static geometry stops the ray
        result.staticHit = true;
        result.endPoint.copy(this.rayHit.position);
        break;
      }
      // No friendly fire in team play (dm damages everyone)
      if (target.team === 'dm' || target.team !== this.owner.team) {
        // Original Tank.applyWeaponHit + local damage
        target.applyWeaponHit(this.rayHit.position, direction, force);
        const dealt = balance?.damage.weakening != null
          ? damage * weakeningMultiplier(
              balance.damage.weakening,
              this.rayHit.position.distanceTo(origin) / UNITS_PER_METER,
            )
          : damage;
        const lethal = dealDamage({ source: this.owner, target, amount: dealt, at: this.rayHit.position });
        result.hits.push({ tank: target, position: this.rayHit.position.clone(), lethal });
        damage *= this.spec.weakeningCoeff;
        force *= this.spec.weakeningCoeff;
      }
      this.filter.addBody(hitBody);
    }
    this.listener?.onShot(result);
  }
}
