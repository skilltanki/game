// Physics-only port of the original Tank:
// body creation, collision boxes, chassis wiring and the per-step physics hooks.
// Rendering, turret, weapons, sound and networking from the original are not here.
import { Matrix3 } from '../math/Matrix3';
import { Quaternion } from '../math/Quaternion';
import { Vector3 } from '../math/Vector3';
import { Body } from '../physics/Body';
import { PhysicsUtils } from '../physics/PhysicsUtils';
import { CollisionBoxesBuilder } from './CollisionBoxesBuilder';
import { CollisionGroup } from './CollisionGroup';
import { SuspensionParams } from './SuspensionParams';
import { TankBody } from './TankBody';
import { TankConst } from './TankConst';
import { TrackedChassis } from './TrackedChassis';
import { TurretController } from './TurretController';
import { SimpleValueSmoother, ValueSmoother } from './ValueSmoother';
import type { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import type { TankPhysicsScene } from './TankPhysicsScene';

/**
 * Original hull parameters come from the server (SpeedCharacteristicsModel) and
 * the hull mesh bounds. Linear values are in client units (1 m = 100 units),
 * angular values in radians.
 */
export interface TankSpec {
  mass: number;
  /** Full hull size (width, length, height) from the hull mesh bounds. */
  hullSize: { x: number; y: number; z: number };
  suspensionDampingCoeff: number;
  maxSpeed: number;
  maxTurnSpeed: number;
  acceleration: number;
  reverseAcceleration: number;
  sideAcceleration: number;
  turnAcceleration: number;
  reverseTurnAcceleration: number;
  /** Turret rotation (original: WeaponCommonData per turret). */
  turretRotationSpeed: number;
  turretRotationAcceleration: number;
  /** Hit points (original: Tank constructor's maxHealth, server-driven). */
  maxHealth: number;
}

/**
 * Stable per-tank identity.
 *
 * The original addressed every object by a server-assigned id (Model.object.id
 * in the original protocol); this port used object references, which cannot survive
 * a network boundary. A string keeps it readable in logs and lets the local
 * side mint ids before a server exists.
 */
export type TankId = string;

export type TeamType = 'red' | 'blue' | 'dm';

export class Tank {
  readonly tankBody: TankBody;
  readonly chassis: TrackedChassis;
  readonly turretController: TurretController;
  readonly suspensionParams = new SuspensionParams();

  // Health / team groundwork for team play (original: maxHealth + ClientTankState + teamType)
  readonly maxHealth: number;
  health: number;
  team: TeamType = 'dm';
  private dead = false;
  /** Original Tank.halfLength (hull bounds y/2) — used by splash occlusion. */
  readonly halfLength: number;

  // Supply effects (original: double damage / double armor)
  outgoingDamageMultiplier = 1;
  incomingDamageMultiplier = 1;
  /**
   * Status effects applied by enemy stream weapons, driven by the game layer:
   * Freeze doubles this tank's reload time, Firebird makes it take more damage.
   * Kept SEPARATE from the supply multipliers (Supplies owns those) so armour
   * and burning compose instead of overwriting each other.
   */
  reloadTimeMultiplier = 1;
  burnDamageMultiplier = 1;
  /**
   * Nuclear-fuel supply: speeds up weapon energy regen (stream/Shaft gauges)
   * and shortens reload. Kept SEPARATE from reloadTimeMultiplier above, which
   * the per-frame loop rewrites for the Freeze chill every tick — a supply
   * writing that field was silently wiped on the very next frame.
   */
  energyRegenMultiplier = 1;
  supplyReloadMultiplier = 1;
  /**
   * Nitro supply: the hull's top speed and acceleration scale (1 without it).
   * Supplies set them; the status-effect pass (jet slowdown, enemy chill)
   * multiplies ITS factor on top instead of restoring the bare hull figure —
   * which used to cancel the nitro the moment an Isida/Firebird/Freeze jet
   * stopped.
   */
  speedBoost = 1;
  accelerationBoost = 1;

  /** Effective reload scale: enemy chill and own supply compose. */
  getReloadScale(): number {
    return this.reloadTimeMultiplier * this.supplyReloadMultiplier;
  }

  // Original: EncryptedValueSmoother(100, 1000, 0, 0) / (0.3, 10, 0, 0)
  private maxSpeedSmoother = new SimpleValueSmoother(100, 1000, 0, 0);

  /** TracksAnimator needs the same smoother the chassis is driven by. */
  getMaxSpeedSmoother(): ValueSmoother {
    return this.maxSpeedSmoother;
  }

  private maxTurnSpeedSmoother = new SimpleValueSmoother(0.3, 10, 0, 0);

  constructor(spec: TankSpec) {
    this.maxHealth = spec.maxHealth;
    this.health = spec.maxHealth;
    this.suspensionParams.dampingCoeff = spec.suspensionDampingCoeff;
    const fullSize = new Vector3(spec.hullSize.x, spec.hullSize.y, spec.hullSize.z);
    const halfSize = new Vector3(fullSize.x / 2, fullSize.y / 2, fullSize.z / 2);
    this.halfLength = halfSize.y;

    // createBody()
    const invInertia = new Matrix3();
    const body = new Body(spec.mass, Matrix3.IDENTITY, 0);
    PhysicsUtils.setBoxInvInertia(spec.mass, halfSize, invInertia);
    body.invInertia.copy(invInertia);
    body.tank = this;
    this.tankBody = new TankBody(body);

    // createCollisionPrimitives()
    const fullHeight = 2 * halfSize.z - (this.suspensionParams.nominalRayLength - TankConst.RAY_OFFSET);
    CollisionBoxesBuilder.createTankCollisionBox(halfSize, fullHeight, this.tankBody);
    CollisionBoxesBuilder.createStaticCollisionBoxes(halfSize, fullHeight, this.tankBody);

    this.chassis = new TrackedChassis(body, this.suspensionParams, this.maxSpeedSmoother, fullSize);
    this.tankBody.hasTracksContactsWithStatic = () => this.hasTracksContactsWithStatic();

    this.turretController = new TurretController(spec.turretRotationSpeed, spec.turretRotationAcceleration, true);

    this.chassis.setAcceleration(spec.acceleration);
    this.chassis.setReverseAcceleration(spec.reverseAcceleration);
    this.chassis.setSideAcceleration(spec.sideAcceleration);
    this.chassis.setTurnAcceleration(spec.turnAcceleration);
    this.chassis.setReverseTurnAcceleration(spec.reverseTurnAcceleration);
    this.maxSpeedSmoother.reset(spec.maxSpeed);
    this.maxTurnSpeedSmoother.reset(spec.maxTurnSpeed);
  }

  addToScene(scene: TankPhysicsScene): void {
    scene.addBody(this.tankBody);
    this.tankBody.initSoaring(scene.getCollisionDetector());
    this.setActivatedState();
  }

  setActivatedState(): void {
    this.setBodyCollisionGroup(CollisionGroup.TANK | CollisionGroup.ACTIVE_TRACK | CollisionGroup.WEAPON);
    this.chassis.setTracksCollisionGroup(CollisionGroup.ACTIVE_TRACK);
    this.tankBody.body.postCollisionFilter = null;
  }

  setBodyCollisionGroup(group: number): void {
    this.tankBody.tankCollisionBox.collisionGroup = group;
  }

  getBody(): Body {
    return this.tankBody.body;
  }

  getMainCollisionBox(): CollisionBox {
    return this.tankBody.tankCollisionBox;
  }

  hasTracksContactsWithStatic(): boolean {
    return this.chassis.leftTrack.hasContactsWithStatic() || this.chassis.rightTrack.hasContactsWithStatic();
  }

  setMovementParams(movementDirection: number, turnDirection: number, reverseBackTurn: boolean): void {
    this.chassis.movementDirection = movementDirection;
    this.chassis.turnDirection = turnDirection;
    this.chassis.reverseBackTurn = reverseBackTurn;
  }

  setMaxSpeed(value: number, immediate: boolean): void {
    if (immediate) {
      this.maxSpeedSmoother.reset(value);
    } else {
      this.maxSpeedSmoother.setTargetValue(value);
    }
  }

  setMaxTurnSpeed(value: number, immediate: boolean): void {
    if (immediate) {
      this.maxTurnSpeedSmoother.reset(value);
    } else {
      this.maxTurnSpeedSmoother.setTargetValue(value);
    }
  }

  /** Original Tank.runBeforePhysicsUpdate (validators/sounds dropped). */
  runBeforePhysicsUpdate(dt: number): void {
    const maxSpeed = this.maxSpeedSmoother.update(dt);
    const maxTurnSpeed = this.maxTurnSpeedSmoother.update(dt);
    this.tankBody.body.setMaxSpeedXY(maxSpeed);
    this.chassis.applyForces(maxSpeed, maxTurnSpeed, dt);
    this.tankBody.body.slipperyMode = !this.hasTracksContactsWithStatic() && this.tankBody.isSoaring();
    this.turretController.rotate(dt); // Tank.rotateTurret (sound part dropped)
  }

  /** Original Tank.runAfterPhysicsUpdate (validators dropped). */
  runAfterPhysicsUpdate(): void {
    this.turretController.updatePhysics(this.tankBody.body);
  }

  setPosition(x: number, y: number, z: number): void {
    const body = this.tankBody.body;
    body.setPositionXYZ(x, y, z);
    body.setVelocityXYZ(0, 0, 0);
    body.setRotationXYZ(0, 0, 0);
    body.saveState();
    body.calcDerivedData();
  }

  interpolate(t: number, outPosition: Vector3, outOrientation: Quaternion): void {
    this.tankBody.body.interpolate(t, outPosition, outOrientation);
    outOrientation.normalize();
  }

  /** World yaw of the hull (original Tank.getTankDirection, simplified from baseMatrix). */
  getTankDirection(): number {
    const m = this.tankBody.body.baseMatrix;
    // hull forward = +Y column (m01, m11); yaw convention matches Rz: +Y -> (-sin, cos)
    return Math.atan2(-m.m01, m.m11);
  }

  /** Original Tank.applyWeaponHit (lastHitPoint tracking dropped). */
  applyWeaponHit(position: Vector3, direction: Vector3, force: number): void {
    if (this.health > 0) {
      this.tankBody.body.addWorldForceScaled(position, direction, force);
      this.tankBody.additionForcesSum.addScaled(force, direction);
    }
  }

  // --- health / team play groundwork ---

  isDead(): boolean {
    return this.dead;
  }

  /**
   * Spawn protection: no damage until this sim time (original battlefield
   * temporary invulnerability after respawn; multiplayer must replicate it
   * server-side). Managed by the game layer via setInvulnerableUntil.
   */
  invulnerableUntil = 0;
  private nowMs = 0;

  /** Game layer feeds the sim clock each physics step for invulnerability checks. */
  setSimTime(timeMs: number): void {
    this.nowMs = timeMs;
  }

  isInvulnerable(): boolean {
    return this.nowMs < this.invulnerableUntil;
  }

  /** Applies damage (scaled by armor supplies); returns true when this hit was lethal. */
  takeDamage(amount: number): boolean {
    if (this.dead || this.isInvulnerable()) {
      return false;
    }
    this.health -= amount * this.incomingDamageMultiplier * this.burnDamageMultiplier;
    if (this.health <= 0) {
      this.health = 0;
      this.kill();
      return true;
    }
    return false;
  }

  heal(amount: number): void {
    if (!this.dead) {
      this.health = Math.min(this.maxHealth, this.health + amount);
    }
  }

  /** Original Tank.kill: state DEAD + movement locked. */
  kill(): void {
    this.dead = true;
    this.chassis.movementLocked = true;
    this.setMovementParams(0, 0, false);
  }

  /** Original Tank.spawn: restore health/movement (position is set separately). */
  respawn(): void {
    this.dead = false;
    this.health = this.maxHealth;
    this.chassis.reset();
    this.turretController.reset();
    this.tankBody.body.clearAccumulators();
  }
}
