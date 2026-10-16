// Port of the original ShapeContact
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import type { Body } from './Body';
import type { CollisionShape } from './collision/CollisionShape';

export class ShapeContact {
  private static pool: ShapeContact[] = [];
  private static poolSize = 0;

  position = new Vector3();
  penetration = 0;
  normal = new Vector3();
  tangent1 = new Vector3();
  tangent2 = new Vector3();
  collisionSpeed = 0;
  contactSeparationSpeed = 0;
  normalSpeedDelta = 0;
  tangentSpeedDelta1 = 0;
  tangentSpeedDelta2 = 0;
  normalAngularInertiaTerm1 = 0;
  normalAngularInertiaTerm2 = 0;
  tangentAngularInertiaTerm11 = 0;
  tangentAngularInertiaTerm12 = 0;
  tangentAngularInertiaTerm21 = 0;
  tangentAngularInertiaTerm22 = 0;
  r1 = new Vector3();
  r2 = new Vector3();
  normalImpulse = 0;
  tangentImpulse1 = 0;
  tangentImpulse2 = 0;
  satisfied = false;
  restitution = 0;
  friction = 0;
  shape1!: CollisionShape;
  shape2!: CollisionShape;

  static create(): ShapeContact {
    if (ShapeContact.poolSize === 0) {
      return new ShapeContact();
    }
    ShapeContact.poolSize--;
    const contact = ShapeContact.pool[ShapeContact.poolSize];
    ShapeContact.pool[ShapeContact.poolSize] = null!;
    return contact;
  }

  dispose(): void {
    this.shape1 = null!;
    this.shape2 = null!;
    ShapeContact.pool[ShapeContact.poolSize] = this;
    ShapeContact.poolSize++;
  }

  calculatePersistentFrameData(): void {
    const body1 = this.shape1.body!;
    const body2 = this.shape2.body!;
    this.restitution = this.shape1.material.restitution;
    const restitution2 = this.shape2.material.restitution;
    if (restitution2 < this.restitution) {
      this.restitution = restitution2;
    }
    this.friction = this.shape1.material.friction;
    const friction2 = this.shape2.material.friction;
    if (friction2 < this.friction) {
      this.friction = friction2;
    }
    if ((body1.slipperyMode && !body2.movable) || (body2.slipperyMode && !body1.movable)) {
      this.friction = 0;
    }
    let pos = body1.state.position;
    this.r1.x = this.position.x - pos.x;
    this.r1.y = this.position.y - pos.y;
    this.r1.z = this.position.z - pos.z;
    pos = body2.state.position;
    this.r2.x = this.position.x - pos.x;
    this.r2.y = this.position.y - pos.y;
    this.r2.z = this.position.z - pos.z;
    if (Math.abs(this.normal.x) < Math.abs(this.normal.y)) {
      this.tangent1.cross2(this.normal, Vector3.X_AXIS).normalize();
    } else {
      this.tangent1.cross2(this.normal, Vector3.Y_AXIS).normalize();
    }
    this.tangent2.cross2(this.normal, this.tangent1);
    this.normalImpulse = 0;
    this.tangentImpulse1 = 0;
    this.tangentImpulse2 = 0;
    this.normalSpeedDelta = 0;
    this.tangentSpeedDelta1 = 0;
    this.tangentSpeedDelta2 = 0;
    if (body1.movable) {
      this.normalAngularInertiaTerm1 = this.calculateAngularInertiaTerm(this.normal, this.r1, body1.invInertiaWorld);
      this.tangentAngularInertiaTerm11 = this.calculateAngularInertiaTerm(this.tangent1, this.r1, body1.invInertiaWorld);
      this.tangentAngularInertiaTerm12 = this.calculateAngularInertiaTerm(this.tangent2, this.r1, body1.invInertiaWorld);
      this.normalSpeedDelta += body1.invMass + this.normalAngularInertiaTerm1;
      this.tangentSpeedDelta1 += body1.invMass + this.tangentAngularInertiaTerm11;
      this.tangentSpeedDelta2 += body1.invMass + this.tangentAngularInertiaTerm12;
    }
    if (body2.movable) {
      this.normalAngularInertiaTerm2 = this.calculateAngularInertiaTerm(this.normal, this.r2, body2.invInertiaWorld);
      this.tangentAngularInertiaTerm21 = this.calculateAngularInertiaTerm(this.tangent1, this.r2, body2.invInertiaWorld);
      this.tangentAngularInertiaTerm22 = this.calculateAngularInertiaTerm(this.tangent2, this.r2, body2.invInertiaWorld);
      this.normalSpeedDelta += body2.invMass + this.normalAngularInertiaTerm2;
      this.tangentSpeedDelta1 += body2.invMass + this.tangentAngularInertiaTerm21;
      this.tangentSpeedDelta2 += body2.invMass + this.tangentAngularInertiaTerm22;
    }
    this.collisionSpeed = this.getSeparationVelocity();
    if (this.collisionSpeed < 0) {
      this.collisionSpeed = -this.restitution * this.collisionSpeed;
    } else {
      this.collisionSpeed = 0;
    }
  }

  private calculateAngularInertiaTerm(direction: Vector3, r: Vector3, invInertiaWorld: Matrix3): number {
    let cx = r.y * direction.z - r.z * direction.y;
    let cy = r.z * direction.x - r.x * direction.z;
    let cz = r.x * direction.y - r.y * direction.x;
    const ix = invInertiaWorld.m00 * cx + invInertiaWorld.m01 * cy + invInertiaWorld.m02 * cz;
    const iy = invInertiaWorld.m10 * cx + invInertiaWorld.m11 * cy + invInertiaWorld.m12 * cz;
    const iz = invInertiaWorld.m20 * cx + invInertiaWorld.m21 * cy + invInertiaWorld.m22 * cz;
    cx = iy * r.z - iz * r.y;
    cy = iz * r.x - ix * r.z;
    cz = ix * r.y - iy * r.x;
    return cx * direction.x + cy * direction.y + cz * direction.z;
  }

  getSeparationVelocity(): number {
    let angular = this.shape1.body!.state.angularVelocity;
    let cx = angular.y * this.r1.z - angular.z * this.r1.y;
    let cy = angular.z * this.r1.x - angular.x * this.r1.z;
    let cz = angular.x * this.r1.y - angular.y * this.r1.x;
    let velocity = this.shape1.body!.state.velocity;
    let vx = velocity.x + cx;
    let vy = velocity.y + cy;
    let vz = velocity.z + cz;
    angular = this.shape2.body!.state.angularVelocity;
    cx = angular.y * this.r2.z - angular.z * this.r2.y;
    cy = angular.z * this.r2.x - angular.x * this.r2.z;
    cz = angular.x * this.r2.y - angular.y * this.r2.x;
    velocity = this.shape2.body!.state.velocity;
    vx -= velocity.x + cx;
    vy -= velocity.y + cy;
    vz -= velocity.z + cz;
    return vx * this.normal.x + vy * this.normal.y + vz * this.normal.z;
  }

  calcualteDynamicFrameData(
    allowedPenetration: number,
    penetrationErrorCorrection: number,
    maxCorrectablePenetration: number,
    dt: number,
  ): void {
    const body1 = this.shape1.body!;
    const body2 = this.shape2.body!;
    this.normalSpeedDelta = 0;
    this.tangentSpeedDelta1 = 0;
    this.tangentSpeedDelta2 = 0;
    if (body1.movable) {
      this.normalSpeedDelta += body1.invMass + this.normalAngularInertiaTerm1;
      this.tangentSpeedDelta1 += body1.invMass + this.tangentAngularInertiaTerm11;
      this.tangentSpeedDelta2 += body1.invMass + this.tangentAngularInertiaTerm12;
    }
    if (body2.movable) {
      this.normalSpeedDelta += body2.invMass + this.normalAngularInertiaTerm2;
      this.tangentSpeedDelta1 += body2.invMass + this.tangentAngularInertiaTerm21;
      this.tangentSpeedDelta2 += body2.invMass + this.tangentAngularInertiaTerm22;
    }
    if (this.penetration > allowedPenetration) {
      let error = this.penetration - allowedPenetration;
      if (error > maxCorrectablePenetration) {
        error = maxCorrectablePenetration;
      }
      this.contactSeparationSpeed = (penetrationErrorCorrection * error) / dt;
    } else {
      this.contactSeparationSpeed = 0;
    }
  }
}
