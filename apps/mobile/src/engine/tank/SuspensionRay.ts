// Port of the original SuspensionRay
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import { RayHit } from '../physics/collision/types/RayHit';
import { RayCollisionFilter } from './RayCollisionFilter';
import { TankConst } from './TankConst';
import type { Body } from '../physics/Body';
import type { SuspensionParams } from './SuspensionParams';

export class SuspensionRay {
  collisionGroup = 0;
  hasCollision = false;
  rayHit = new RayHit();
  springForce = 0;
  readonly contactVelocity = new Vector3();
  speed = 0;

  private body: Body;
  private origin = new Vector3();
  private direction = new Vector3();
  private suspensionParams: SuspensionParams;
  private globalOrigin = new Vector3();
  private globalDirection = new Vector3();
  private prevCompression = 0;
  private collisionFilter: RayCollisionFilter;

  constructor(body: Body, origin: Vector3, direction: Vector3, suspensionParams: SuspensionParams) {
    this.body = body;
    this.origin.copy(origin);
    this.direction.copy(direction);
    this.suspensionParams = suspensionParams;
    this.collisionFilter = new RayCollisionFilter(body);
  }

  update(dt: number): void {
    this.raycast();
    if (this.hasCollision) {
      this.calculateSpringForce(dt);
      this.calculateContactVelocity();
    }
  }

  private raycast(): void {
    const m: Matrix3 = this.body.baseMatrix;
    this.globalDirection.x = m.m00 * this.direction.x + m.m01 * this.direction.y + m.m02 * this.direction.z;
    this.globalDirection.y = m.m10 * this.direction.x + m.m11 * this.direction.y + m.m12 * this.direction.z;
    this.globalDirection.z = m.m20 * this.direction.x + m.m21 * this.direction.y + m.m22 * this.direction.z;
    const position = this.body.state.position;
    this.globalOrigin.x = m.m00 * this.origin.x + m.m01 * this.origin.y + m.m02 * this.origin.z;
    this.globalOrigin.y = m.m10 * this.origin.x + m.m11 * this.origin.y + m.m12 * this.origin.z;
    this.globalOrigin.z = m.m20 * this.origin.x + m.m21 * this.origin.y + m.m22 * this.origin.z;
    this.globalOrigin.x += position.x;
    this.globalOrigin.y += position.y;
    this.globalOrigin.z += position.z;
    if (this.hasCollision) {
      this.prevCompression = this.suspensionParams.maxRayLength - this.rayHit.t;
    }
    this.hasCollision = this.body.scene!.collisionDetector.raycast(
      this.globalOrigin, this.globalDirection, this.collisionGroup,
      this.suspensionParams.maxRayLength, this.collisionFilter, this.rayHit,
    );
    if (this.hasCollision) {
      this.hasCollision = this.rayHit.normal.z > TankConst.MAX_SLOPE_ANGLE_COS;
    }
  }

  calculateSpringForce(dt: number): void {
    const compression = this.suspensionParams.maxRayLength - this.rayHit.t;
    this.springForce = this.suspensionParams.springCoeff * compression;
    const compressionSpeed = (compression - this.prevCompression) / dt;
    this.springForce += compressionSpeed * this.suspensionParams.dampingCoeff;
    if (this.springForce < 0) {
      this.springForce = 0;
    }
  }

  private calculateContactVelocity(): void {
    const hitBody = this.rayHit.shape!.body!;
    if (hitBody.tank != null) {
      const position = hitBody.state.position;
      const velocity = hitBody.state.velocity;
      const angular = hitBody.state.angularVelocity;
      const hitPosition = this.rayHit.position;
      const rx = hitPosition.x - position.x;
      const ry = hitPosition.y - position.y;
      const rz = hitPosition.z - position.z;
      this.contactVelocity.x = angular.y * rz - angular.z * ry;
      this.contactVelocity.y = angular.z * rx - angular.x * rz;
      this.contactVelocity.z = angular.x * ry - angular.y * rx;
      this.contactVelocity.x += velocity.x;
      this.contactVelocity.y += velocity.y;
      this.contactVelocity.z += velocity.z;
    } else {
      this.contactVelocity.x = 0;
      this.contactVelocity.y = 0;
      this.contactVelocity.z = 0;
    }
  }

  getGlobalOrigin(): Vector3 {
    return this.globalOrigin;
  }

  getGlobalDirection(): Vector3 {
    return this.globalDirection;
  }

  getOrigin(): Vector3 {
    return this.origin;
  }
}
