// Ports of ICollisionFilter, IRayCollisionFilter, BodyCollisionFilter, Collider interfaces
import type { Body } from '../Body';
import type { CollisionShape } from './CollisionShape';
import type { ShapeContact } from '../ShapeContact';

export interface ICollisionFilter {
  considerCollision(shape: CollisionShape): boolean;
}

export interface IRayCollisionFilter {
  considerBody(body: Body): boolean;
}

export interface BodyCollisionFilter {
  considerBodies(a: Body, b: Body): boolean;
}

export interface Collider {
  getContacts(a: CollisionShape, b: CollisionShape, contacts: ShapeContact[]): void;
  haveCollision(a: CollisionShape, b: CollisionShape): boolean;
}
