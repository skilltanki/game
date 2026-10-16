// Port of the original CollisionDetector (interface).
// The original returns Vector.<TankBody> from getTankBodies; the tank layer's
// TankBody type is referenced here type-only to keep the dependency one-way.
import type { Vector3 } from '../../math/Vector3';
import type { BodyContact } from '../BodyContact';
import type { ShapeContact } from '../ShapeContact';
import type { CollisionShape } from './CollisionShape';
import type { IRayCollisionFilter } from './filters';
import type { RayHit } from './types/RayHit';
import type { TankBody } from '../../tank/TankBody';

export interface CollisionDetector {
  getBodyContacts(contacts: BodyContact[]): void;
  raycast(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null, hit: RayHit): boolean;
  raycastStatic(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null, hit: RayHit): boolean;
  hasStaticHit(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter?: IRayCollisionFilter | null): boolean;
  getContacts(shape1: CollisionShape, shape2: CollisionShape, contacts: ShapeContact[]): void;
  testCollision(shape1: CollisionShape, shape2: CollisionShape): boolean;
  getTankBodies(): TankBody[];
}
