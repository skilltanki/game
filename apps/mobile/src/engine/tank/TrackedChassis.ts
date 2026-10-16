// Port of the original TrackedChassis —
// the heart of tank movement. EncryptedNumber fields -> plain numbers.
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import { MathUtils } from './MathUtils';
import { TankConst } from './TankConst';
import { Track } from './Track';
import type { Body } from '../physics/Body';
import type { SuspensionParams } from './SuspensionParams';
import type { SuspensionRay } from './SuspensionRay';
import type { ValueSmoother } from './ValueSmoother';

const MIN_ACCELERATION = 400;

const _xAxis = new Vector3();
const _yAxis = new Vector3();
const _zAxis = new Vector3();
const _surfaceVelocity = new Vector3();
const _surfaceAngularVelocity = new Vector3();
const _relativeVelocity = new Vector3();
const _relativeAngularVelocity = new Vector3();
const _forceVector = new Vector3();
const _midPoint = new Vector3();

export class TrackedChassis {
  leftTrack!: Track;
  rightTrack!: Track;
  movementLocked = false;
  movementDirection = 0;
  turnDirection = 0;
  reverseBackTurn = false;

  private body: Body;
  private suspensionParams: SuspensionParams;
  private maxSpeedSmoother: ValueSmoother;

  private _acceleration = 0;
  private _reverseAcceleration = 0;
  private _sideAcceleration = 0;
  private _turnAcceleration = 0;
  private _reverseTurnAcceleration = 0;

  constructor(body: Body, suspensionParams: SuspensionParams, maxSpeedSmoother: ValueSmoother, hullSize: Vector3) {
    this.body = body;
    this.suspensionParams = suspensionParams;
    this.maxSpeedSmoother = maxSpeedSmoother;
    this.createTracks(TankConst.NUM_RAYS_PER_TRACK, hullSize);
  }

  private createTracks(numRays: number, hullSize: Vector3): void {
    const trackLength = hullSize.y * 0.8;
    const trackSeparation = hullSize.x - 40;
    this.leftTrack = new Track(this.body, numRays, new Vector3(-0.5 * trackSeparation, 0, -0.5 * hullSize.z + TankConst.RAY_OFFSET), trackLength, this.suspensionParams, -1);
    this.rightTrack = new Track(this.body, numRays, new Vector3(0.5 * trackSeparation, 0, -0.5 * hullSize.z + TankConst.RAY_OFFSET), trackLength, this.suspensionParams, 1);
  }

  setAcceleration(value: number): void {
    this._acceleration = value;
  }

  setReverseAcceleration(value: number): void {
    this._reverseAcceleration = value;
  }

  setSideAcceleration(value: number): void {
    this._sideAcceleration = value;
  }

  setTurnAcceleration(value: number): void {
    this._turnAcceleration = value;
  }

  setReverseTurnAcceleration(value: number): void {
    this._reverseTurnAcceleration = value;
  }

  getAcceleration(): number {
    return this._acceleration;
  }

  getActualMovementDirection(): number {
    return this.movementLocked ? 0 : this.movementDirection;
  }

  getActualTurnDirection(): number {
    return this.movementLocked ? 0 : this.turnDirection;
  }

  setTracksCollisionGroup(group: number): void {
    this.leftTrack.setCollisionGroup(group);
    this.rightTrack.setCollisionGroup(group);
  }

  applyForces(maxSpeed: number, maxTurnSpeed: number, dt: number): void {
    this.adjustSuspensionSpringCoeff();
    this.calculateSuspensionContacts(dt);
    this.applyMovementForces(maxSpeed, maxTurnSpeed, dt);
    this.applySlopeHack();
  }

  private adjustSuspensionSpringCoeff(): void {
    const weight = this.body.scene!.gravity.length() * this.body.mass;
    this.suspensionParams.springCoeff = weight / (2 * TankConst.NUM_RAYS_PER_TRACK * (this.suspensionParams.maxRayLength - this.suspensionParams.nominalRayLength));
  }

  private calculateSuspensionContacts(dt: number): void {
    this.leftTrack.calculateSuspensionContacts(dt);
    this.rightTrack.calculateSuspensionContacts(dt);
  }

  private applyMovementForces(maxSpeed: number, maxTurnSpeed: number, dt: number): void {
    if (this.leftTrack.numContacts + this.rightTrack.numContacts > 0) {
      this.doApplyMovementForces(maxSpeed, maxTurnSpeed, dt);
    }
  }

  private doApplyMovementForces(maxSpeed: number, maxTurnSpeed: number, dt: number): void {
    const moveDir = this.movementLocked ? 0 : this.movementDirection;
    const turnDir = this.movementLocked ? 0 : this.turnDirection;
    const velocity = this.body.state.velocity;
    const angularVelocity = this.body.state.angularVelocity;
    const m: Matrix3 = this.body.baseMatrix;
    _xAxis.x = m.m00;
    _xAxis.y = m.m10;
    _xAxis.z = m.m20;
    _yAxis.x = m.m01;
    _yAxis.y = m.m11;
    _yAxis.z = m.m21;
    _zAxis.x = m.m02;
    _zAxis.y = m.m12;
    _zAxis.z = m.m22;
    // Traction factor: fades to 0 between 45° and 60° slope
    let tractionFactor = 1;
    const fadeStartAngle = Math.PI / 4;
    const maxSlopeAngle = TankConst.MAX_SLOPE_ANGLE;
    if (_zAxis.z < Math.cos(fadeStartAngle)) {
      if (_zAxis.z < Math.cos(maxSlopeAngle)) {
        tractionFactor = 0;
      } else {
        tractionFactor = (maxSlopeAngle - Math.acos(_zAxis.z)) / (maxSlopeAngle - fadeStartAngle);
      }
    }
    this.calculateSurfaceVelocities(_surfaceVelocity, _surfaceAngularVelocity);
    _relativeVelocity.x = velocity.x - _surfaceVelocity.x;
    _relativeVelocity.y = velocity.y - _surfaceVelocity.y;
    _relativeVelocity.z = velocity.z - _surfaceVelocity.z;
    _relativeAngularVelocity.x = angularVelocity.x - _surfaceAngularVelocity.x;
    _relativeAngularVelocity.y = angularVelocity.y - _surfaceAngularVelocity.y;
    _relativeAngularVelocity.z = angularVelocity.z - _surfaceAngularVelocity.z;
    const forwardSpeed = _relativeVelocity.x * _yAxis.x + _relativeVelocity.y * _yAxis.y + _relativeVelocity.z * _yAxis.z;
    const turnSpeed = _relativeAngularVelocity.x * _zAxis.x + _relativeAngularVelocity.y * _zAxis.y + _relativeAngularVelocity.z * _zAxis.z;
    // Damp lateral (side) velocity — simulates track grip
    let sideSpeed = _relativeVelocity.x * _xAxis.x + _relativeVelocity.y * _xAxis.y + _relativeVelocity.z * _xAxis.z;
    const sideSpeedDelta = this._sideAcceleration * tractionFactor * dt;
    if (sideSpeed < 0) {
      if (sideSpeedDelta > -sideSpeed) {
        sideSpeed = 0;
      } else {
        sideSpeed += sideSpeedDelta;
      }
    } else if (sideSpeed > 0) {
      if (sideSpeedDelta > sideSpeed) {
        sideSpeed = 0;
      } else {
        sideSpeed -= sideSpeedDelta;
      }
    }
    _relativeVelocity.setLengthAlongDirection(_xAxis, sideSpeed);
    velocity.x = _surfaceVelocity.x + _relativeVelocity.x;
    velocity.y = _surfaceVelocity.y + _relativeVelocity.y;
    velocity.z = _surfaceVelocity.z + _relativeVelocity.z;
    const leftContacts = this.leftTrack.numContacts;
    const rightContacts = this.rightTrack.numContacts;
    let acceleration = this._acceleration;
    let turnAcceleration = this._turnAcceleration;
    if (leftContacts > 0 || rightContacts > 0) {
      // Longitudinal movement
      let speedDelta = 0;
      if (moveDir === 0) {
        speedDelta = -MathUtils.sign(forwardSpeed) * acceleration * dt;
        if (MathUtils.sign(forwardSpeed) !== MathUtils.sign(forwardSpeed + speedDelta)) {
          speedDelta = -forwardSpeed;
        }
      } else {
        if (MathUtils.sign(forwardSpeed) * MathUtils.sign(moveDir) < 0) {
          acceleration = this._reverseAcceleration;
        }
        speedDelta = moveDir * acceleration * dt;
      }
      const newForwardSpeed = MathUtils.clamp(forwardSpeed + speedDelta, -maxSpeed, maxSpeed);
      let effectiveSpeedDelta = newForwardSpeed - forwardSpeed;
      const fullPowerThreshold = 1;
      const speedReserve = MathUtils.clamp(1 - Math.abs(forwardSpeed / maxSpeed), 0, 1);
      if (speedReserve < fullPowerThreshold && moveDir * MathUtils.sign(forwardSpeed) > 0) {
        effectiveSpeedDelta *= speedReserve / fullPowerThreshold;
      }
      let effectiveAcceleration = effectiveSpeedDelta / dt;
      if (Math.abs(effectiveAcceleration) < MIN_ACCELERATION && Math.abs(newForwardSpeed) > 0.5 * this.maxSpeedSmoother.getTargetValue()) {
        effectiveAcceleration = MathUtils.numberSign(effectiveAcceleration, 0.1) * MIN_ACCELERATION;
      }
      const totalForce = effectiveAcceleration * this.body.mass;
      const totalContacts = leftContacts + rightContacts;
      const scaledForce = (totalForce * (totalContacts + 0.21 * (20 - totalContacts))) / 10;
      const forcePerRay = scaledForce / totalContacts;
      const forceFadeStartAngle = Math.PI / 4;
      const forceMaxAngle = Math.PI / 3;
      for (let i = 0; i < TankConst.NUM_RAYS_PER_TRACK; i++) {
        this.applyForceFromRay(this.leftTrack.rays[i], _yAxis, forcePerRay, forceMaxAngle, forceFadeStartAngle);
        this.applyForceFromRay(this.rightTrack.rays[i], _yAxis, forcePerRay, forceMaxAngle, forceFadeStartAngle);
      }
      // Turning
      let turnSpeedFactor = 1;
      if (leftContacts === 0 || rightContacts === 0) {
        turnSpeedFactor = 0.5;
      }
      let turnSpeedDelta = 0;
      if (turnDir === 0) {
        turnSpeedDelta = -MathUtils.sign(turnSpeed) * turnAcceleration * tractionFactor * dt;
        if (MathUtils.sign(turnSpeed) !== MathUtils.sign(turnSpeed + turnSpeedDelta)) {
          turnSpeedDelta = -turnSpeed;
        }
      } else {
        if (this.isReversedTurn(turnDir, turnSpeed)) {
          turnAcceleration = this._reverseTurnAcceleration;
        }
        turnSpeedDelta = turnDir * turnAcceleration * tractionFactor * dt;
        if (moveDir === -1 && this.reverseBackTurn) {
          turnSpeedDelta = -turnSpeedDelta;
        }
      }
      const newTurnSpeed = MathUtils.clamp(turnSpeed + turnSpeedDelta, -maxTurnSpeed * turnSpeedFactor, maxTurnSpeed * turnSpeedFactor);
      _relativeAngularVelocity.setLengthAlongDirection(_zAxis, newTurnSpeed);
      angularVelocity.x = _surfaceAngularVelocity.x + _relativeAngularVelocity.x;
      angularVelocity.y = _surfaceAngularVelocity.y + _relativeAngularVelocity.y;
      angularVelocity.z = _surfaceAngularVelocity.z + _relativeAngularVelocity.z;
    }
  }

  private isReversedTurn(turnDir: number, turnSpeed: number): boolean {
    return turnDir * turnSpeed < 0;
  }

  private calculateSurfaceVelocities(outVelocity: Vector3, outAngularVelocity: Vector3): void {
    const invContacts = 1 / (this.leftTrack.numContacts + this.rightTrack.numContacts);
    let midX = 0;
    let midY = 0;
    let midZ = 0;
    for (let i = 0; i < TankConst.NUM_RAYS_PER_TRACK; i++) {
      let ray = this.leftTrack.rays[i];
      if (ray.hasCollision) {
        const p = ray.rayHit.position;
        midX += p.x;
        midY += p.y;
        midZ += p.z;
      }
      ray = this.rightTrack.rays[i];
      if (ray.hasCollision) {
        const p = ray.rayHit.position;
        midX += p.x;
        midY += p.y;
        midZ += p.z;
      }
    }
    midX *= invContacts;
    midY *= invContacts;
    midZ *= invContacts;
    _midPoint.x = midX;
    _midPoint.y = midY;
    _midPoint.z = midZ;
    outVelocity.x = 0;
    outVelocity.y = 0;
    outVelocity.z = 0;
    outAngularVelocity.x = 0;
    outAngularVelocity.y = 0;
    outAngularVelocity.z = 0;
    for (let i = 0; i < TankConst.NUM_RAYS_PER_TRACK; i++) {
      this.addVelocitiesFromRay(this.leftTrack.rays[i], _midPoint, outVelocity, outAngularVelocity);
      this.addVelocitiesFromRay(this.rightTrack.rays[i], _midPoint, outVelocity, outAngularVelocity);
    }
    outVelocity.x *= invContacts;
    outVelocity.y *= invContacts;
    outVelocity.z *= invContacts;
    outAngularVelocity.x *= invContacts;
    outAngularVelocity.y *= invContacts;
    outAngularVelocity.z *= invContacts;
  }

  private addVelocitiesFromRay(ray: SuspensionRay, midPoint: Vector3, outVelocity: Vector3, outAngularVelocity: Vector3): void {
    if (ray.hasCollision) {
      outVelocity.x += ray.contactVelocity.x;
      outVelocity.y += ray.contactVelocity.y;
      outVelocity.z += ray.contactVelocity.z;
      const p = ray.rayHit.position;
      const rx = p.x - midPoint.x;
      const ry = p.y - midPoint.y;
      const rz = p.z - midPoint.z;
      const rSqr = rx * rx + ry * ry + rz * rz;
      if (rSqr > 1) {
        const invRSqr = 1 / rSqr;
        const v = ray.contactVelocity;
        outAngularVelocity.x += (ry * v.z - rz * v.y) * invRSqr;
        outAngularVelocity.y += (rz * v.x - rx * v.z) * invRSqr;
        outAngularVelocity.z += (rx * v.y - ry * v.x) * invRSqr;
      }
    }
  }

  private applyForceFromRay(ray: SuspensionRay, direction: Vector3, force: number, maxAngle: number, fadeStartAngle: number): void {
    if (ray.hasCollision) {
      const dx = direction.x;
      const dy = direction.y;
      const dz = direction.z;
      const lengthSqr = dx * dx + dy * dy + dz * dz;
      if (lengthSqr > 0.00001) {
        let slopeAngle = Math.acos(ray.rayHit.normal.z);
        if (slopeAngle < 0) {
          slopeAngle = -slopeAngle;
        }
        if (slopeAngle < maxAngle) {
          let scale = force / Math.sqrt(lengthSqr);
          if (slopeAngle > fadeStartAngle) {
            scale *= (maxAngle - slopeAngle) / (maxAngle - fadeStartAngle);
          }
          _forceVector.x = dx * scale;
          _forceVector.y = dy * scale;
          _forceVector.z = dz * scale;
          this.body.addWorldForceAtLocalPoint(ray.getOrigin(), _forceVector);
        }
      }
    }
  }

  // Cancels the lateral component of gravity on slopes below 45° so the
  // tank does not slide off; above 45° gravity applies in full.
  private applySlopeHack(): void {
    if (this.rightTrack.numContacts >= this.rightTrack.numRays >> 1 || this.leftTrack.numContacts >= this.leftTrack.numRays >> 1) {
      const m = this.body.baseMatrix;
      const gravity = this.body.scene!.gravity;
      const gravityAlongUp = gravity.x * m.m02 + gravity.y * m.m12 + gravity.z * m.m22;
      const gravityLength = gravity.length();
      const threshold = Math.SQRT1_2 * gravityLength;
      if (gravityAlongUp < -threshold || gravityAlongUp > threshold) {
        const fx = (m.m02 * gravityAlongUp - gravity.x) * this.body.mass;
        const fy = (m.m12 * gravityAlongUp - gravity.y) * this.body.mass;
        const fz = (m.m22 * gravityAlongUp - gravity.z) * this.body.mass;
        this.body.addForceXYZ(fx, fy, fz);
      }
    }
  }

  reset(): void {
    this.movementLocked = false;
  }
}
