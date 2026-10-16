// Port of the original Track
// (BattleUtils.isTankBody inlined: a body is a tank body when body.tank != null)
import { Vector3 } from '../math/Vector3';
import { SuspensionRay } from './SuspensionRay';
import type { Body } from '../physics/Body';
import type { SuspensionParams } from './SuspensionParams';

export class Track {
  body: Body;
  rays: SuspensionRay[] = [];
  numRays = 0;
  numContacts = 0;
  suspensionParams!: SuspensionParams;
  animationSpeed = 0;
  side: number;
  readonly averageSurfaceVelocity = new Vector3();

  constructor(body: Body, numRays: number, firstRayPosition: Vector3, length: number, suspensionParams: SuspensionParams, side: number) {
    this.body = body;
    this.side = side;
    this.setTrackParams(numRays, firstRayPosition, length, suspensionParams);
  }

  private setTrackParams(numRays: number, firstRayPosition: Vector3, length: number, suspensionParams: SuspensionParams): void {
    this.numRays = numRays;
    this.suspensionParams = suspensionParams;
    this.rays = new Array(numRays);
    const step = length / (numRays - 1);
    for (let i = 0; i < numRays; i++) {
      const origin = new Vector3(firstRayPosition.x, firstRayPosition.y + 0.5 * length - i * step, firstRayPosition.z);
      this.rays[i] = new SuspensionRay(this.body, origin, Vector3.DOWN, suspensionParams);
    }
  }

  setCollisionGroup(group: number): void {
    for (let i = 0; i < this.numRays; i++) {
      this.rays[i].collisionGroup = group;
    }
  }

  hasContactsWithStatic(): boolean {
    for (const ray of this.rays) {
      if (ray.hasCollision && ray.rayHit.shape!.body!.tank == null) {
        return true;
      }
    }
    return false;
  }

  calculateSuspensionContacts(dt: number): void {
    this.numContacts = 0;
    this.averageSurfaceVelocity.x = 0;
    this.averageSurfaceVelocity.y = 0;
    this.averageSurfaceVelocity.z = 0;
    const velocity = this.body.state.velocity;
    for (let i = 0; i < this.numRays; i++) {
      const ray = this.rays[i];
      ray.update(dt);
      if (ray.hasCollision) {
        this.numContacts++;
        this.body.addWorldForceScaled(ray.getGlobalOrigin(), ray.getGlobalDirection(), -ray.springForce);
        this.averageSurfaceVelocity.x += ray.contactVelocity.x;
        this.averageSurfaceVelocity.y += ray.contactVelocity.y;
        this.averageSurfaceVelocity.z += ray.contactVelocity.z;
        const vx = velocity.x - ray.contactVelocity.x;
        const vy = velocity.y - ray.contactVelocity.y;
        const vz = velocity.z - ray.contactVelocity.z;
        ray.speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      } else {
        ray.speed = 0;
      }
    }
    if (this.numContacts > 1) {
      this.averageSurfaceVelocity.x /= this.numContacts;
      this.averageSurfaceVelocity.y /= this.numContacts;
      this.averageSurfaceVelocity.z /= this.numContacts;
    }
  }

  setAnimationSpeed(target: number, delta: number): void {
    if (this.animationSpeed < target) {
      const value = this.animationSpeed + delta;
      this.animationSpeed = value > target ? target : value;
    } else if (this.animationSpeed > target) {
      const value = this.animationSpeed - delta;
      this.animationSpeed = value < target ? target : value;
    }
  }
}
