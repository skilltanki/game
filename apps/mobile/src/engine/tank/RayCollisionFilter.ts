// Port of the original RayCollisionFilter
import type { Body } from '../physics/Body';
import type { IRayCollisionFilter } from '../physics/collision/filters';

export class RayCollisionFilter implements IRayCollisionFilter {
  private body: Body;

  constructor(body: Body) {
    this.body = body;
  }

  considerBody(body: Body): boolean {
    return this.body !== body;
  }
}
