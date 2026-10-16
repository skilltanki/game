// Port of the original CollisionShape
import { Matrix4 } from '../../math/Matrix4';
import { Vector3 } from '../../math/Vector3';
import { AABB } from './types/AABB';
import type { Body } from '../Body';
import type { PhysicsMaterial } from '../PhysicsMaterial';

export class CollisionShape {
  static readonly BOX = 1;
  static readonly SPHERE = 2;
  static readonly RECT = 4;
  static readonly TRIANGLE = 8;

  type: number;
  collisionGroup: number;
  body: Body | null = null;
  localTransform: Matrix4 | null = null;
  transform = new Matrix4();
  aabb = new AABB();
  material: PhysicsMaterial;

  constructor(type: number, collisionGroup: number, material: PhysicsMaterial) {
    this.type = type;
    this.collisionGroup = collisionGroup;
    this.material = material;
  }

  setBody(body: Body | null, localTransform: Matrix4 | null = null): void {
    if (this.body === body) {
      return;
    }
    this.body = body;
    if (body != null) {
      if (localTransform != null) {
        if (this.localTransform == null) {
          this.localTransform = new Matrix4();
        }
        this.localTransform.copy(localTransform);
      } else {
        this.localTransform = null;
      }
    }
  }

  calculateAABB(): AABB {
    return this.aabb;
  }

  raycast(_origin: Vector3, _dir: Vector3, _maxLength: number, _outNormal: Vector3): number {
    return -1;
  }

  clone(): CollisionShape {
    return this.createPrimitive().copyFrom(this);
  }

  copyFrom(source: CollisionShape): CollisionShape {
    if (source == null) {
      throw new Error('Parameter source cannot be null');
    }
    this.type = source.type;
    this.transform.copy(source.transform);
    this.collisionGroup = source.collisionGroup;
    this.setBody(source.body, source.localTransform);
    this.aabb.copyFrom(source.aabb);
    return this;
  }

  protected createPrimitive(): CollisionShape {
    return new CollisionShape(this.type, this.collisionGroup, this.material);
  }
}
