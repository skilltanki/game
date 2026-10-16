// Port of the original CollisionBox
import { Vector3 } from '../../../math/Vector3';
import { CollisionShape } from '../CollisionShape';
import { AABB } from '../types/AABB';
import type { PhysicsMaterial } from '../../PhysicsMaterial';

export class CollisionBox extends CollisionShape {
  hs = new Vector3();

  constructor(halfSize: Vector3, collisionGroup: number, material: PhysicsMaterial) {
    super(CollisionShape.BOX, collisionGroup, material);
    this.hs.copy(halfSize);
  }

  override calculateAABB(): AABB {
    const m = this.transform;
    const box = this.aabb;
    let ax = m.m00 < 0 ? -m.m00 : m.m00;
    let ay = m.m01 < 0 ? -m.m01 : m.m01;
    let az = m.m02 < 0 ? -m.m02 : m.m02;
    box.maxX = this.hs.x * ax + this.hs.y * ay + this.hs.z * az;
    box.minX = -box.maxX;
    ax = m.m10 < 0 ? -m.m10 : m.m10;
    ay = m.m11 < 0 ? -m.m11 : m.m11;
    az = m.m12 < 0 ? -m.m12 : m.m12;
    box.maxY = this.hs.x * ax + this.hs.y * ay + this.hs.z * az;
    box.minY = -box.maxY;
    ax = m.m20 < 0 ? -m.m20 : m.m20;
    ay = m.m21 < 0 ? -m.m21 : m.m21;
    az = m.m22 < 0 ? -m.m22 : m.m22;
    box.maxZ = this.hs.x * ax + this.hs.y * ay + this.hs.z * az;
    box.minZ = -box.maxZ;
    box.minX += m.m03;
    box.maxX += m.m03;
    box.minY += m.m13;
    box.maxY += m.m13;
    box.minZ += m.m23;
    box.maxZ += m.m23;
    return box;
  }

  override copyFrom(source: CollisionShape): CollisionShape {
    if (!(source instanceof CollisionBox)) {
      return this;
    }
    super.copyFrom(source);
    this.hs.copy(source.hs);
    return this;
  }

  protected override createPrimitive(): CollisionShape {
    return new CollisionBox(this.hs, this.collisionGroup, this.material);
  }

  override raycast(origin: Vector3, dir: Vector3, eps: number, outNormal: Vector3): number {
    const m = this.transform;
    let tMin = -1;
    let tMax = 1e308;
    // Transform ray into box local space
    let dx = origin.x - m.m03;
    let dy = origin.y - m.m13;
    let dz = origin.z - m.m23;
    const ox = m.m00 * dx + m.m10 * dy + m.m20 * dz;
    const oy = m.m01 * dx + m.m11 * dy + m.m21 * dz;
    const oz = m.m02 * dx + m.m12 * dy + m.m22 * dz;
    dx = m.m00 * dir.x + m.m10 * dir.y + m.m20 * dir.z;
    dy = m.m01 * dir.x + m.m11 * dir.y + m.m21 * dir.z;
    dz = m.m02 * dir.x + m.m12 * dir.y + m.m22 * dir.z;
    let t1: number;
    let t2: number;
    if (dx < eps && dx > -eps) {
      if (ox < -this.hs.x || ox > this.hs.x) {
        return -1;
      }
    } else {
      t1 = (-this.hs.x - ox) / dx;
      t2 = (this.hs.x - ox) / dx;
      if (t1 < t2) {
        if (t1 > tMin) {
          tMin = t1;
          outNormal.x = -1;
          outNormal.y = outNormal.z = 0;
        }
        if (t2 < tMax) {
          tMax = t2;
        }
      } else {
        if (t2 > tMin) {
          tMin = t2;
          outNormal.x = 1;
          outNormal.y = outNormal.z = 0;
        }
        if (t1 < tMax) {
          tMax = t1;
        }
      }
      if (tMax < tMin) {
        return -1;
      }
    }
    if (dy < eps && dy > -eps) {
      if (oy < -this.hs.y || oy > this.hs.y) {
        return -1;
      }
    } else {
      t1 = (-this.hs.y - oy) / dy;
      t2 = (this.hs.y - oy) / dy;
      if (t1 < t2) {
        if (t1 > tMin) {
          tMin = t1;
          outNormal.y = -1;
          outNormal.x = outNormal.z = 0;
        }
        if (t2 < tMax) {
          tMax = t2;
        }
      } else {
        if (t2 > tMin) {
          tMin = t2;
          outNormal.y = 1;
          outNormal.x = outNormal.z = 0;
        }
        if (t1 < tMax) {
          tMax = t1;
        }
      }
      if (tMax < tMin) {
        return -1;
      }
    }
    if (dz < eps && dz > -eps) {
      if (oz < -this.hs.z || oz > this.hs.z) {
        return -1;
      }
    } else {
      t1 = (-this.hs.z - oz) / dz;
      t2 = (this.hs.z - oz) / dz;
      if (t1 < t2) {
        if (t1 > tMin) {
          tMin = t1;
          outNormal.z = -1;
          outNormal.x = outNormal.y = 0;
        }
        if (t2 < tMax) {
          tMax = t2;
        }
      } else {
        if (t2 > tMin) {
          tMin = t2;
          outNormal.z = 1;
          outNormal.x = outNormal.y = 0;
        }
        if (t1 < tMax) {
          tMax = t1;
        }
      }
      if (tMax < tMin) {
        return -1;
      }
    }
    // Normal back to world space
    const nx = outNormal.x;
    const ny = outNormal.y;
    const nz = outNormal.z;
    outNormal.x = m.m00 * nx + m.m01 * ny + m.m02 * nz;
    outNormal.y = m.m10 * nx + m.m11 * ny + m.m12 * nz;
    outNormal.z = m.m20 * nx + m.m21 * ny + m.m22 * nz;
    return tMin;
  }
}
