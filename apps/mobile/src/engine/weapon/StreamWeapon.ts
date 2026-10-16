// Stream weapons (original flamethrower/streamweapon models: Firebird, Freeze,
// Isida). While the trigger is held the weapon damages every enemy inside a
// cone (ConicAreaData.coneAngle) each tick, draining an energy gauge; released
// it regenerates. Hitting empty overheats until partially recharged. Isida
// heals its owner by a fraction of the damage dealt (vampirism).
//
// Isida heals TEAMMATES: LocalHealingGun.getEffectType picks HEALING for a
// same-team target and DAMAGING otherwise, so one beam does both — it turns
// green (heal_start/heal_shaft/heal_end) while pointed at an ally and ticks
// восстанавливает ему здоровье вместо урона врагу. Понадобится при командах
// с ботами.
import { Vector3 } from '../math/Vector3';
import { dealDamage } from './DamageSink';
import { weakeningMultiplier, UNITS_PER_METER } from './DamageModel';
import { WEAPON_BALANCE, type WeaponBalance } from './WeaponBalance';
import { RayHit } from '../physics/collision/types/RayHit';
import type { Body } from '../physics/Body';
import type { IRayCollisionFilter } from '../physics/collision/filters';
import type { Tank } from '../tank/Tank';
import type { TanksCollisionDetector } from '../tank/TanksCollisionDetector';
import type { Weapon } from './Weapon';
import type { ShotResult, WeaponListener } from './RailgunWeapon';

export interface StreamSpec {
  /** Balance profile id (WEAPON_BALANCE); see RailgunSpec.balance. */
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
  /**
   * Isida's healing mode (LocalHealingGun): hp per tick restored to a TEAMMATE
   * caught in the cone. Omit for guns that only ever damage.
   */
  healPerTick?: number;
}

const PHYSICS_DT = 0.033;
// After overheating (energy = 0) the stream stays locked until this level
const OVERHEAT_UNLOCK = 0.3;

export class StreamWeapon implements Weapon {
  private triggerPressed = false;
  private energy = 1;
  private overheated = false;
  private nextTickTime = 0;
  private streaming = false;

  private readonly rayHit = new RayHit();
  private readonly filter: IRayCollisionFilter;
  private readonly _muzzle = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _toTarget = new Vector3();

  constructor(
    private owner: Tank,
    private spec: StreamSpec,
    private detector: TanksCollisionDetector,
    private listener: WeaponListener | null,
    private getAllTanks: () => Tank[],
  ) {
    const ownBody = owner.getBody();
    this.filter = { considerBody: (body: Body) => body !== ownBody };
  }

  /**
   * REMOTE tanks (multiplayer): their jet is driven by relayed fire on/off
   * messages, and the gauge that would end it lives on the OWNER's machine —
   * draining a local copy would cut their stream early, so it never drains.
   */
  infiniteEnergy = false;

  setTrigger(pressed: boolean): void {
    this.triggerPressed = pressed;
  }

  /** The gauge doubles as the HUD "charge" bar. */
  getStatus(): number {
    return this.energy;
  }

  /** True while the beam is pointed at a teammate (IsisState.HEALING). */
  isHealing(): boolean {
    return this.healing;
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  /** Beam length from the last stream tick (clipped by static geometry). */
  lastBeamLength = 0;
  /** IsisState.HEALING — the beam is on a teammate this tick. */
  private healing = false;

  /** External energy change (Freeze vampirism etc.), clamped to 0..1. */
  addEnergy(delta: number): void {
    this.energy = Math.max(0, Math.min(1, this.energy + delta));
  }

  reset(): void {
    this.triggerPressed = false;
    this.energy = 1;
    this.overheated = false;
    this.streaming = false;
    this.healing = false;
  }

  update(timeMs: number, getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    const wantsFire = this.triggerPressed && !this.owner.isDead() && !this.overheated && this.energy > 0;
    if (wantsFire) {
      if (!this.infiniteEnergy) {
        this.energy = Math.max(0, this.energy - PHYSICS_DT / this.spec.drainSeconds);
        if (this.energy === 0) {
          this.overheated = true;
        }
      }
      this.streaming = true;
      if (timeMs >= this.nextTickTime) {
        this.nextTickTime = timeMs + this.spec.tickInterval;
        this.streamTick(getMuzzle, getDirection);
      }
    } else {
      this.streaming = false;
      this.healing = false;
      this.energy = Math.min(1, this.energy + (PHYSICS_DT * this.owner.energyRegenMultiplier) / this.spec.regenSeconds);
      if (this.overheated && this.energy >= OVERHEAT_UNLOCK) {
        this.overheated = false;
      }
    }
  }

  private streamTick(getMuzzle: (out: Vector3) => void, getDirection: (out: Vector3) => void): void {
    getMuzzle(this._muzzle);
    getDirection(this._dir);
    const cosLimit = Math.cos(this.spec.coneHalfAngle);
    // Clip the visual beam against static geometry along the aim axis
    let beamLength = this.spec.maxRange;
    if (this.detector.raycast(this._muzzle, this._dir, 0xffff, this.spec.maxRange, this.filter, this.rayHit)) {
      beamLength = this.rayHit.t;
    }
    this.lastBeamLength = beamLength;
    const result: ShotResult = {
      origin: this._muzzle.clone(),
      direction: this._dir.clone(),
      endPoint: this._muzzle.clone().addScaled(beamLength, this._dir),
      staticHit: beamLength < this.spec.maxRange,
      hits: [],
    };
    let dealt = 0;
    let healedAnyone = false;
    for (const tank of this.getAllTanks()) {
      if (tank === this.owner || tank.isDead()) {
        continue;
      }
      // Teammates are healed, not damaged (Isida); other guns skip them.
      const friendly = tank.team !== 'dm' && tank.team === this.owner.team;
      if (friendly && (this.spec.healPerTick ?? 0) <= 0) {
        continue;
      }
      const center = tank.getBody().state.position;
      this._toTarget.diff(center, this._muzzle);
      const distance = this._toTarget.length();
      if (distance > this.spec.maxRange || distance < 1) {
        continue;
      }
      this._toTarget.scale(1 / distance);
      const cos = this._toTarget.x * this._dir.x + this._toTarget.y * this._dir.y + this._toTarget.z * this._dir.z;
      if (cos < cosLimit) {
        continue;
      }
      // Line of sight: the first thing hit toward the target must be the target
      if (!this.detector.raycast(this._muzzle, this._toTarget, 0xffff, distance, this.filter, this.rayHit)) {
        continue;
      }
      if ((this.rayHit.shape!.body!.tank as Tank | null) !== tank) {
        continue;
      }
      if (friendly) {
        // HEALING: no impact force and no damage — just restore hp. Routed
        // through the DamageSink so the server applier can own it too.
        if (tank.health < tank.maxHealth) {
          dealDamage({ source: this.owner, target: tank, amount: this.spec.healPerTick!, heal: true, at: this.rayHit.position });
        }
        healedAnyone = true;
        result.hits.push({ tank, position: this.rayHit.position.clone(), lethal: false });
        continue;
      }
      // Fixed per-tick damage, faded by range: Firebird and Freeze both carry
      // a weakening curve (full damage to 5 m, halved past ~24 m).
      const balance = (this.spec as { modBalance?: WeaponBalance }).modBalance
      ?? (this.spec.balance != null ? WEAPON_BALANCE[this.spec.balance] : undefined);
      let damage = this.spec.damagePerTick;
      if (balance?.damage.weakening != null) {
        const distance = this.rayHit.position.distanceTo(this._muzzle) / UNITS_PER_METER;
        damage *= weakeningMultiplier(balance.damage.weakening, distance);
      }
      damage *= this.owner.outgoingDamageMultiplier;
      tank.applyWeaponHit(this.rayHit.position, this._toTarget, this.spec.impactForce);
      const lethal = dealDamage({ source: this.owner, target: tank, amount: damage, at: this.rayHit.position });
      dealt += damage;
      result.hits.push({ tank, position: this.rayHit.position.clone(), lethal });
    }
    this.healing = healedAnyone && dealt === 0;
    if (dealt > 0 && this.spec.selfHealFraction > 0) {
      // Vampirism goes through the DamageSink too: locally it is the same
      // heal, but online a REMOTE Isida must not quietly inflate its own hp
      // (the network applier drops reports whose source is not the local
      // player; the server computes the shooter's self-heal itself).
      dealDamage({
        source: this.owner,
        target: this.owner,
        amount: dealt * this.spec.selfHealFraction,
        heal: true,
        at: this._muzzle,
      });
    }
    this.listener?.onShot(result);
  }
}
