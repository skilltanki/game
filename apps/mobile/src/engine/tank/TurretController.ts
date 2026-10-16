// Port of the original TurretController.
// Dropped vs original: WeaponObject/WeaponCommonData (speed/acceleration come in
// via the constructor), WeaponRotationLimit (defaults to +-PI), the injected
// TargetingInputManager (input is wired externally via rotateLeft/Right/center).
import { MathUtils } from './MathUtils';
import { SimpleValueSmoother, ValueSmoother } from './ValueSmoother';
import { Vector3 } from '../math/Vector3';
import type { Body } from '../physics/Body';

export interface ITurretControllerListener {
  onTurretControlStateChanged(controlState: number): void;
}

// Port of the original BitMask
export class BitMask {
  private mask: number;

  constructor(mask = 0) {
    this.mask = mask;
  }

  setBits(bits: number): void {
    this.mask |= bits;
  }

  clearBits(bits: number): void {
    this.mask &= ~bits;
  }

  setBit(bit: number): void {
    this.setBits(1 << bit);
  }

  clearBit(bit: number): void {
    this.clearBits(1 << bit);
  }

  getBitValue(bit: number): number {
    return 1 & (this.mask >> bit);
  }

  clear(): void {
    this.mask = 0;
  }

  isEmpty(): boolean {
    return this.mask === 0;
  }

  hasAnyBit(bits: number): boolean {
    return (this.mask & bits) !== 0;
  }

  change(bits: number, set: boolean): void {
    if (set) {
      this.setBits(bits);
    } else {
      this.clearBits(bits);
    }
  }
}

const ROTATION_FIXER = 5;
const ROTATION_IGNORE = 20;
const IGNORE_TARGET_ANGLE = 0.05;
const IGNORE_TARGET_ANGLE_VALUE = (IGNORE_TARGET_ANGLE * Math.PI) / 180;
const EPSILON = 0.000001;

const zAxisPrev = new Vector3();
const yAxisPrev = new Vector3();
const yAxisNext = new Vector3();
const tmpVector = new Vector3();

export class TurretController {
  static readonly BIT_LEFT = 5;
  static readonly BIT_RIGHT = 6;
  static readonly BIT_CENTER = 7;
  static readonly BIT_UP = 8;
  static readonly BIT_DOWN = 9;

  private maxTurnSpeedSmoother: ValueSmoother = new SimpleValueSmoother(0.3, 10, 0, 0);
  private maxTurnSpeed = 0;
  private turnAcceleration = 0;
  private turnSpeed = 0;
  private prevDirection = 0;
  private currDirection = 0;
  private prevTurnDirection = 0;
  private turnDirection = 0;
  private centerTurret = false;
  private initialDirection = 0;
  private lockMask = new BitMask();
  private clearDirectionOnReset: boolean;
  protected controlState = 0;
  private appliedControlState = 0;
  private gyroscopePower = 0;
  protected freeRotation = 0;
  private targetAngle = 0;
  private rotationMode = false;
  private listener: ITurretControllerListener | null = null;
  private _hasCameraRotation = false;
  private forceControlState = false;
  private targetAngleChanged = false;
  private keyState: boolean[] = new Array(256).fill(false);
  private maxAngle = Math.PI;
  private minAngle = -Math.PI;

  constructor(
    maxTurretRotationSpeed: number,
    turretRotationAcceleration: number,
    clearDirectionOnReset: boolean,
    rotationLimit: { minAngle: number; maxAngle: number } | null = null,
  ) {
    this.clearDirectionOnReset = clearDirectionOnReset;
    this.setMaxTurnSpeed(maxTurretRotationSpeed, true);
    this.turnAcceleration = turretRotationAcceleration;
    if (rotationLimit != null) {
      this.minAngle = rotationLimit.minAngle;
      this.maxAngle = rotationLimit.maxAngle;
    }
    this.lockMask.clear();
  }

  setInitialDirection(direction: number): void {
    this.initialDirection = direction;
  }

  lock(bits: number): void {
    this.lockMask.change(bits, true);
    if (this.isLocked()) {
      this.turnSpeed = 0;
      this.applyControlState(0);
    }
  }

  unlock(bits: number): void {
    const wasLocked = this.isLocked();
    this.lockMask.change(bits, false);
    if (!this.isLocked() && wasLocked) {
      this.centerTurret = false;
      this.applyControlState(this.controlState);
    }
  }

  setControlState(controlState: number, force = false): void {
    this.controlState = controlState;
    if (this.isEnabled()) {
      this.applyControlState(controlState, force);
    }
  }

  private applyControlState(controlState: number, force = false): void {
    const previous = this.appliedControlState;
    this.appliedControlState = controlState;
    const left = MathUtils.getBitValue(controlState, TurretController.BIT_LEFT);
    const right = MathUtils.getBitValue(controlState, TurretController.BIT_RIGHT);
    this.turnDirection = left - right;
    this.centerTurret =
      left + right === 0 && (this.centerTurret || MathUtils.getBitValue(controlState, TurretController.BIT_CENTER) === 1);
    if (this.appliedControlState !== previous || force) {
      this.onControlStateChanged(this.appliedControlState);
    }
  }

  protected onControlStateChanged(controlState: number): void {
    this.listener?.onTurretControlStateChanged(controlState);
  }

  setDirectionImmediate(direction: number): void {
    this.currDirection = direction;
  }

  setTargetDirection(direction: number): void {
    const diff = this.angleDiff(direction, this.targetAngle);
    if (Math.abs(diff) > IGNORE_TARGET_ANGLE_VALUE) {
      this.targetAngle = direction;
      this.rotationMode = true;
      this.targetAngleChanged = true;
    }
  }

  getDirection(): number {
    return this.currDirection;
  }

  getControl(): number {
    return this.isEnabled() ? this.controlState : 0;
  }

  rotate(dt: number): void {
    if (this.rotationMode) {
      this.computeRotation(dt);
    }
    this.setControlState(this.controlState, this.forceControlState);
    this.forceControlState = false;
    this.prevDirection = this.currDirection;
    this.maxTurnSpeed = this.maxTurnSpeedSmoother.update(dt);
    if (this.lockMask.isEmpty()) {
      let direction: number;
      if (this.centerTurret) {
        if (this.currDirection === this.initialDirection) {
          this.finishTurretCentering();
          return;
        }
        direction = this.currDirection < this.initialDirection ? 1 : -1;
      } else {
        direction = this.turnDirection;
      }
      if (this.prevTurnDirection !== direction) {
        this.turnSpeed = 0;
        this.prevTurnDirection = direction;
      }
      if (direction === 0) {
        this.turnSpeed = 0;
        return;
      }
      this.turnSpeed += direction * this.turnAcceleration * dt;
      this.turnSpeed = MathUtils.clamp(this.turnSpeed, -this.maxTurnSpeed, this.maxTurnSpeed);
      const wasBelow = this.currDirection < this.initialDirection;
      this.currDirection += this.turnSpeed * dt;
      if (this.centerTurret && wasBelow !== this.currDirection < this.initialDirection) {
        this.currDirection = this.initialDirection;
        this.finishTurretCentering();
        return;
      }
      this.currDirection = MathUtils.clampAngle(this.currDirection);
      this.currDirection = MathUtils.clamp(this.currDirection, this.minAngle, this.maxAngle);
    }
  }

  private computeRotation(dt: number): void {
    this.controlState = 0;
    const diff = this.angleDiff(this.targetAngle, this.getDirection());
    const absDiff = Math.abs(diff);
    if (absDiff >= EPSILON) {
      const maxStep = this.getMaxTurnSpeed() * dt;
      if (absDiff < maxStep && !this.targetAngleChanged) {
        const snapStep = maxStep / ROTATION_FIXER;
        if (absDiff <= snapStep) {
          this.setDirectionImmediate(this.targetAngle);
          this.rotationMode = false;
          if (absDiff >= maxStep / ROTATION_IGNORE) {
            this.forceControlState = true;
          }
        } else {
          this.setDirectionImmediate(this.getDirection() + diff / 2);
        }
      } else {
        if (diff < 0) {
          this.controlState = MathUtils.changeBitValue(this.controlState, TurretController.BIT_RIGHT, true);
          this.controlState = MathUtils.changeBitValue(this.controlState, TurretController.BIT_LEFT, false);
        } else if (diff > 0) {
          this.controlState = MathUtils.changeBitValue(this.controlState, TurretController.BIT_LEFT, true);
          this.controlState = MathUtils.changeBitValue(this.controlState, TurretController.BIT_RIGHT, false);
        }
        this.targetAngleChanged = false;
      }
    }
  }

  private angleDiff(a: number, b: number): number {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  private finishTurretCentering(): void {
    this.centerTurret = false;
    this.turnSpeed = 0;
  }

  updatePhysics(body: Body): void {
    this.applyGyroscopeEffect(body);
  }

  // Keeps the turret pointing the same way in the world while the hull turns
  private applyGyroscopeEffect(body: Body): void {
    if (this.gyroscopePower > 0) {
      body.prevState.orientation.getYAxis(yAxisPrev);
      body.prevState.orientation.getZAxis(zAxisPrev);
      body.state.orientation.getYAxis(yAxisNext);
      tmpVector.cross2(yAxisNext, yAxisPrev);
      const sin = tmpVector.dot(zAxisPrev);
      const cos = yAxisPrev.dot(yAxisNext);
      const hullTurnAngle = Math.atan2(sin, cos);
      this.currDirection += hullTurnAngle * this.gyroscopePower;
    }
  }

  getInterpolatedDirection(t: number): number {
    const delta = this.currDirection - this.prevDirection;
    let result: number;
    if (delta < -Math.PI) {
      result = this.prevDirection + t * (MathUtils.PI2 + delta);
      if (result > Math.PI) {
        result -= MathUtils.PI2;
      }
    } else if (delta > Math.PI) {
      result = this.prevDirection - t * (MathUtils.PI2 - delta);
      if (result < -Math.PI) {
        result += MathUtils.PI2;
      }
    } else {
      result = this.prevDirection + t * delta;
    }
    return result;
  }

  isRotating(): boolean {
    return this.turnSpeed !== 0;
  }

  reset(): void {
    this.turnSpeed = 0;
    this.prevDirection = 0;
    this.currDirection = this.initialDirection;
    this.maxTurnSpeedSmoother.reset(this.maxTurnSpeedSmoother.getTargetValue());
    this.centerTurret = false;
    if (this.clearDirectionOnReset) {
      this.turnDirection = 0;
    }
  }

  setListener(listener: ITurretControllerListener): void {
    this.listener = listener;
    this.setControlState(0);
    this.targetAngle = 0;
  }

  setMaxTurnSpeed(value: number, immediate: boolean): void {
    if (immediate) {
      this.maxTurnSpeed = value;
      this.maxTurnSpeedSmoother.reset(value);
    } else {
      this.maxTurnSpeedSmoother.setTargetValue(value);
    }
  }

  getMaxTurnSpeed(): number {
    return this.maxTurnSpeedSmoother.getTargetValue();
  }

  setTurnAcceleration(value: number): void {
    this.turnAcceleration = value;
  }

  getTurnAcceleration(): number {
    return this.turnAcceleration;
  }

  protected isLocked(): boolean {
    return !this.lockMask.isEmpty();
  }

  isEnabled(): boolean {
    return this.lockMask.isEmpty();
  }

  setGyroscopePower(power: number): void {
    this.gyroscopePower = power;
  }

  rotateLeft(pressed: boolean): void {
    this.setState(TurretController.BIT_LEFT, pressed);
    this.rotationMode = false;
  }

  rotateRight(pressed: boolean): void {
    this.setState(TurretController.BIT_RIGHT, pressed);
    this.rotationMode = false;
  }

  rotateUp(pressed: boolean): void {
    this.setState(TurretController.BIT_UP, pressed);
    this.rotationMode = false;
  }

  rotateDown(pressed: boolean): void {
    this.setState(TurretController.BIT_DOWN, pressed);
    this.rotationMode = false;
  }

  center(pressed: boolean): void {
    this.setState(TurretController.BIT_CENTER, pressed);
    this.rotationMode = false;
  }

  private setState(bit: number, pressed: boolean): void {
    this.controlState = MathUtils.changeBitValue(this.controlState, bit, pressed);
  }

  setCameraRotation(rotation: number): void {
    this.freeRotation = rotation;
    this._hasCameraRotation = true;
  }

  getCameraRotation(): number {
    return this.freeRotation;
  }

  hasCameraRotation(): boolean {
    return this._hasCameraRotation;
  }

  resetCameraRotation(): void {
    this.freeRotation = 0;
    this._hasCameraRotation = false;
  }

  stopCameraRotation(): void {
    this.targetAngle = this.getDirection();
  }

  saveKeyState(keyCode: number, pressed: boolean): void {
    if (keyCode < this.keyState.length) {
      this.keyState[keyCode] = pressed;
    }
  }

  loadKeyState(keyCode: number): boolean {
    return keyCode < this.keyState.length ? this.keyState[keyCode] : false;
  }

  resetSavedKeyStates(): void {
    this.keyState.fill(false);
  }
}
