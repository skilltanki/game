// Port of the original CollisionRect
import { Vector3 } from '../../../math/Vector3';
import { CollisionShape } from '../CollisionShape';
import { AABB } from '../types/AABB';
import type { PhysicsMaterial } from '../../PhysicsMaterial';

export class CollisionRect extends CollisionShape {
  private static readonly EPSILON = 0.005;

  hs = new Vector3();

  constructor(halfSize: Vector3, collisionGroup: number, material: PhysicsMaterial) {
    super(CollisionShape.RECT, collisionGroup, material);
    this.hs.copy(halfSize);
  }

  override calculateAABB(): AABB {
    const m = this.transform;
    const box = this.aabb;
    let ax = m.m00 < 0 ? -m.m00 : m.m00;
    let ay = m.m01 < 0 ? -m.m01 : m.m01;
    let az = m.m02 < 0 ? -m.m02 : m.m02;
    box.maxX = this.hs.x * ax + this.hs.y * ay + CollisionRect.EPSILON * az;
    box.minX = -box.maxX;
    ax = m.m10 < 0 ? -m.m10 : m.m10;
    ay = m.m11 < 0 ? -m.m11 : m.m11;
    az = m.m12 < 0 ? -m.m12 : m.m12;
    box.maxY = this.hs.x * ax + this.hs.y * ay + CollisionRect.EPSILON * az;
    box.minY = -box.maxY;
    ax = m.m20 < 0 ? -m.m20 : m.m20;
    ay = m.m21 < 0 ? -m.m21 : m.m21;
    az = m.m22 < 0 ? -m.m22 : m.m22;
    box.maxZ = this.hs.x * ax + this.hs.y * ay + CollisionRect.EPSILON * az;
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
    if (!(source instanceof CollisionRect)) {
      return this;
    }
    super.copyFrom(source);
    this.hs.copy(source.hs);
    return this;
  }

  protected override createPrimitive(): CollisionShape {
    return new CollisionRect(this.hs, this.collisionGroup, this.material);
  }

  override raycast(origin: Vector3, dir: Vector3, eps: number, outNormal: Vector3): number {
    const m = this.transform;
    let dx = origin.x - m.m03;
    let dy = origin.y - m.m13;
    let dz = origin.z - m.m23;
    let ox = m.m00 * dx + m.m10 * dy + m.m20 * dz;
    let oy = m.m01 * dx + m.m11 * dy + m.m21 * dz;
    let oz = m.m02 * dx + m.m12 * dy + m.m22 * dz;
    dx = m.m00 * dir.x + m.m10 * dir.y + m.m20 * dir.z;
    dy = m.m01 * dir.x + m.m11 * dir.y + m.m21 * dir.z;
    dz = m.m02 * dir.x + m.m12 * dir.y + m.m22 * dir.z;
    if (dz > -eps && dz < eps) {
      return -1;
    }
    const t = -oz / dz;
    if (t < 0) {
      return -1;
    }
    ox += dx * t;
    oy += dy * t;
    if (ox < -this.hs.x - eps || ox > this.hs.x + eps || oy < -this.hs.y - eps || oy > this.hs.y + eps) {
      return -1;
    }
    if (dir.x * m.m02 + dir.y * m.m12 + dir.z * m.m22 > 0) {
      outNormal.x = -m.m02;
      outNormal.y = -m.m12;
      outNormal.z = -m.m22;
    } else {
      outNormal.x = m.m02;
      outNormal.y = m.m12;
      outNormal.z = m.m22;
    }
    return t;
  }
}
