// Port of the original Body.
// Changes vs original: EncryptedNumber -> plain number; `tank:Tank` back-reference
// retyped as the narrow TankHost marker so physics does not depend on the Tank class.
import { Matrix3 } from '../math/Matrix3';
import { Matrix4 } from '../math/Matrix4';
import { Quaternion } from '../math/Quaternion';
import { Vector3 } from '../math/Vector3';
import { BodyState } from './BodyState';
import { AABB } from './collision/types/AABB';
import type { CollisionShape } from './collision/CollisionShape';
import type { BodyCollisionFilter } from './collision/filters';
import type { PhysicsScene } from './PhysicsScene';

/** Marker for the game object owning a body (original: the Tank class). */
export interface TankHost {}

export class Body {
  static linearDamping = 0.997;
  static rotationalDamping = 0.997;

  private static readonly MAX_SPEED_Z = 1500;
  private static readonly _r = new Vector3();
  private static readonly _f = new Vector3();

  id = 0;
  tank: TankHost | null = null;
  scene: PhysicsScene | null = null;
  movable = true;
  canFreeze = false;
  freezeCounter = 0;
  frozen = false;
  slipperyMode = false;
  aabb = new AABB();
  postCollisionFilter: BodyCollisionFilter | null = null;
  acceleration = new Vector3();
  angularAcceleration = new Vector3();
  prevState = new BodyState();
  mass = 1;
  invMass = 1;
  invInertia = new Matrix3();
  invInertiaWorld = new Matrix3();
  baseMatrix = new Matrix3();
  previousVelocity = new Vector3();
  state = new BodyState();

  private maxSpeedXY: number;
  private maxZSpeedDelta = 600;
  private minZAcceleration = -1100;

  collisionShapes: CollisionShape[] | null = null;
  numCollisionShapes = 0;
  forceAccum = new Vector3();
  torqueAccum = new Vector3();
  pseudoVelocity = new Vector3();
  pseudoAngularVelocity = new Vector3();

  constructor(mass: number, invInertia: Matrix3, maxSpeedXY: number) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.invInertia.copy(invInertia);
    this.maxSpeedXY = maxSpeedXY;
  }

  addCollisionShape(shape: CollisionShape, localTransform: Matrix4 | null = null): void {
    if (shape == null) {
      throw new Error('Parameter is null');
    }
    if (this.collisionShapes == null) {
      this.collisionShapes = [];
      this.numCollisionShapes = 0;
    }
    this.collisionShapes.push(shape);
    this.numCollisionShapes = this.collisionShapes.length;
    shape.setBody(this, localTransform);
  }

  removeCollisionShape(shape: CollisionShape): void {
    if (this.collisionShapes != null && this.numCollisionShapes > 0) {
      const index = this.collisionShapes.indexOf(shape);
      if (index >= 0) {
        shape.setBody(null);
        this.collisionShapes[index] = this.collisionShapes[--this.numCollisionShapes];
        if (this.numCollisionShapes === 0) {
          this.collisionShapes = null;
        } else {
          this.collisionShapes.length = this.numCollisionShapes;
        }
      }
    }
  }

  interpolate(t: number, outPosition: Vector3, outOrientation: Quaternion): void {
    const k = 1 - t;
    outPosition.x = this.prevState.position.x * k + this.state.position.x * t;
    outPosition.y = this.prevState.position.y * k + this.state.position.y * t;
    outPosition.z = this.prevState.position.z * k + this.state.position.z * t;
    outOrientation.w = this.prevState.orientation.w * k + this.state.orientation.w * t;
    outOrientation.x = this.prevState.orientation.x * k + this.state.orientation.x * t;
    outOrientation.y = this.prevState.orientation.y * k + this.state.orientation.y * t;
    outOrientation.z = this.prevState.orientation.z * k + this.state.orientation.z * t;
  }

  setPosition(p: Vector3): void {
    this.state.position.copy(p);
  }

  setPositionXYZ(x: number, y: number, z: number): void {
    this.state.position.reset(x, y, z);
  }

  setVelocity(v: Vector3): void {
    this.state.velocity.copy(v);
  }

  setVelocityXYZ(x: number, y: number, z: number): void {
    this.state.velocity.reset(x, y, z);
  }

  setRotation(v: Vector3): void {
    this.state.angularVelocity.copy(v);
  }

  setRotationXYZ(x: number, y: number, z: number): void {
    this.state.angularVelocity.reset(x, y, z);
  }

  setOrientation(q: Quaternion): void {
    this.state.orientation.copy(q);
  }

  setMaxSpeedXY(value: number): void {
    this.maxSpeedXY = value;
  }

  applyWorldImpulseAtLocalPoint(r: Vector3, direction: Vector3, impulse: number): void {
    const dv = impulse * this.invMass;
    this.state.velocity.x += dv * direction.x;
    this.state.velocity.y += dv * direction.y;
    this.state.velocity.z += dv * direction.z;
    const tx = (r.y * direction.z - r.z * direction.y) * impulse;
    const ty = (r.z * direction.x - r.x * direction.z) * impulse;
    const tz = (r.x * direction.y - r.y * direction.x) * impulse;
    const m = this.invInertiaWorld;
    this.state.angularVelocity.x += m.m00 * tx + m.m01 * ty + m.m02 * tz;
    this.state.angularVelocity.y += m.m10 * tx + m.m11 * ty + m.m12 * tz;
    this.state.angularVelocity.z += m.m20 * tx + m.m21 * ty + m.m22 * tz;
  }

  applyWorldPseudoImpulseAtLocalPoint(r: Vector3, direction: Vector3, impulse: number): void {
    const dv = impulse * this.invMass;
    this.pseudoVelocity.x += dv * direction.x;
    this.pseudoVelocity.y += dv * direction.y;
    this.pseudoVelocity.z += dv * direction.z;
    const tx = (r.y * direction.z - r.z * direction.y) * impulse;
    const ty = (r.z * direction.x - r.x * direction.z) * impulse;
    const tz = (r.x * direction.y - r.y * direction.x) * impulse;
    const m = this.invInertiaWorld;
    this.pseudoAngularVelocity.x += m.m00 * tx + m.m01 * ty + m.m02 * tz;
    this.pseudoAngularVelocity.y += m.m10 * tx + m.m11 * ty + m.m12 * tz;
    this.pseudoAngularVelocity.z += m.m20 * tx + m.m21 * ty + m.m22 * tz;
  }

  applyImpulse(direction: Vector3, impulse: number): void {
    const dv = impulse * this.invMass;
    this.state.velocity.x += dv * direction.x;
    this.state.velocity.y += dv * direction.y;
    this.state.velocity.z += dv * direction.z;
  }

  addForce(force: Vector3): void {
    this.forceAccum.add(force);
  }

  addScaledForce(force: Vector3, scale: number): void {
    this.forceAccum.addScaled(scale, force);
  }

  addForceXYZ(x: number, y: number, z: number): void {
    this.forceAccum.x += x;
    this.forceAccum.y += y;
    this.forceAccum.z += z;
  }

  addWorldForceXYZ(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    this.forceAccum.x += fx;
    this.forceAccum.y += fy;
    this.forceAccum.z += fz;
    const pos = this.state.position;
    const rx = px - pos.x;
    const ry = py - pos.y;
    const rz = pz - pos.z;
    this.torqueAccum.x += ry * fz - rz * fy;
    this.torqueAccum.y += rz * fx - rx * fz;
    this.torqueAccum.z += rx * fy - ry * fx;
  }

  addWorldForce(point: Vector3, force: Vector3): void {
    this.forceAccum.add(force);
    this.torqueAccum.add(Body._r.diff(point, this.state.position).cross(force));
  }

  addWorldForceScaled(point: Vector3, force: Vector3, scale: number): void {
    const fx = scale * force.x;
    const fy = scale * force.y;
    const fz = scale * force.z;
    this.forceAccum.x += fx;
    this.forceAccum.y += fy;
    this.forceAccum.z += fz;
    const pos = this.state.position;
    const rx = point.x - pos.x;
    const ry = point.y - pos.y;
    const rz = point.z - pos.z;
    this.torqueAccum.x += ry * fz - rz * fy;
    this.torqueAccum.y += rz * fx - rx * fz;
    this.torqueAccum.z += rx * fy - ry * fx;
  }

  addLocalForce(localPoint: Vector3, localForce: Vector3): void {
    this.baseMatrix.transformVector(localPoint, Body._r);
    this.baseMatrix.transformVector(localForce, Body._f);
    this.forceAccum.add(Body._f);
    this.torqueAccum.add(Body._r.cross(Body._f));
  }

  addWorldForceAtLocalPoint(localPoint: Vector3, worldForce: Vector3): void {
    this.baseMatrix.transformVector(localPoint, Body._r);
    this.forceAccum.add(worldForce);
    this.torqueAccum.add(Body._r.cross(worldForce));
  }

  addScaledWorldForceAtLocalPoint(localPoint: Vector3, worldForce: Vector3, scale: number): void {
    this.baseMatrix.transformVector(localPoint, Body._r);
    this.forceAccum.addScaled(scale, worldForce);
    this.torqueAccum.addScaled(scale, Body._r.cross(worldForce));
  }

  addTorque(torque: Vector3): void {
    this.torqueAccum.add(torque);
  }

  clearAccumulators(): void {
    this.forceAccum.x = this.forceAccum.y = this.forceAccum.z = 0;
    this.torqueAccum.x = this.torqueAccum.y = this.torqueAccum.z = 0;
  }

  calcAccelerations(): void {
    this.acceleration.x = this.forceAccum.x * this.invMass;
    this.acceleration.y = this.forceAccum.y * this.invMass;
    this.acceleration.z = this.forceAccum.z * this.invMass;
    const m = this.invInertiaWorld;
    const t = this.torqueAccum;
    this.angularAcceleration.x = m.m00 * t.x + m.m01 * t.y + m.m02 * t.z;
    this.angularAcceleration.y = m.m10 * t.x + m.m11 * t.y + m.m12 * t.z;
    this.angularAcceleration.z = m.m20 * t.x + m.m21 * t.y + m.m22 * t.z;
  }

  calcDerivedData(): void {
    this.state.orientation.toMatrix3(this.baseMatrix);
    this.invInertiaWorld.copy(this.invInertia).append(this.baseMatrix).prependTransposed(this.baseMatrix);
    if (this.collisionShapes != null) {
      this.aabb.infinity();
      for (let i = 0; i < this.numCollisionShapes; i++) {
        const shape = this.collisionShapes[i];
        shape.transform.setFromMatrix3(this.baseMatrix, this.state.position);
        if (shape.localTransform != null) {
          shape.transform.prepend(shape.localTransform);
        }
        shape.calculateAABB();
        this.aabb.addBoundBox(shape.aabb);
      }
    }
  }

  saveState(): void {
    this.prevState.copy(this.state);
  }

  restoreState(): void {
    this.state.copy(this.prevState);
  }

  integrateVelocity(dt: number): void {
    this.integrateLinearVelocity(dt);
    this.integrateAngularVelocity(dt);
  }

  private integrateLinearVelocity(dt: number): void {
    this.previousVelocity.copy(this.state.velocity);
    if (this.acceleration.z < this.minZAcceleration) {
      this.acceleration.z = this.minZAcceleration;
    }
    this.state.velocity = this.state.velocity.clone();
    this.state.velocity.x += this.acceleration.x * dt;
    this.state.velocity.y += this.acceleration.y * dt;
    this.state.velocity.z += this.acceleration.z * dt;
    this.state.velocity.x *= Body.linearDamping;
    this.state.velocity.y *= Body.linearDamping;
    this.state.velocity.z *= Body.linearDamping;
    const absZ = Math.abs(this.state.velocity.z);
    if (absZ > Body.MAX_SPEED_Z) {
      this.state.velocity.z *= Body.MAX_SPEED_Z / absZ;
    }
    if (this.state.velocity.z - this.previousVelocity.z > this.maxZSpeedDelta) {
      this.state.velocity.z = this.previousVelocity.z + this.maxZSpeedDelta;
    }
    const vx = this.state.velocity.x;
    const vy = this.state.velocity.y;
    const speedXY = Math.sqrt(vx * vx + vy * vy);
    const maxXY = this.maxSpeedXY;
    if (speedXY > maxXY) {
      const k = maxXY / speedXY;
      this.state.velocity.x *= k;
      this.state.velocity.y *= k;
    }
  }

  private integrateAngularVelocity(dt: number): void {
    this.state.angularVelocity.x += this.angularAcceleration.x * dt;
    this.state.angularVelocity.y += this.angularAcceleration.y * dt;
    this.state.angularVelocity.z += this.angularAcceleration.z * dt;
    this.state.angularVelocity.x *= Body.rotationalDamping;
    this.state.angularVelocity.y *= Body.rotationalDamping;
    this.state.angularVelocity.z *= Body.rotationalDamping;
    if (this.state.angularVelocity.length() > 10) {
      this.state.angularVelocity.setLength(10);
    }
  }

  integratePosition(dt: number): void {
    const newPosition = new Vector3();
    const pos = this.state.position;
    const vel = this.state.velocity;
    newPosition.x = pos.x + vel.x * dt;
    newPosition.y = pos.y + vel.y * dt;
    newPosition.z = pos.z + vel.z * dt;
    this.state.position = newPosition;
    this.state.orientation.addScaledVector(this.state.angularVelocity, dt);
  }

  integratePseudoVelocity(dt: number): void {
    this.state.position.x += this.pseudoVelocity.x * dt;
    this.state.position.y += this.pseudoVelocity.y * dt;
    this.state.position.z += this.pseudoVelocity.z * dt;
    this.state.orientation.addScaledVector(this.pseudoAngularVelocity, dt);
    this.pseudoVelocity.reset();
    this.pseudoAngularVelocity.reset();
  }
}
