// Port of the original CollisionTriangle.
// Vertices live in the shape's local XY plane; `transform` places that plane in the world.
import { Vector3 } from '../../../math/Vector3';
import { CollisionShape } from '../CollisionShape';
import { AABB } from '../types/AABB';
import type { PhysicsMaterial } from '../../PhysicsMaterial';

export class CollisionTriangle extends CollisionShape {
  v0 = new Vector3();
  v1 = new Vector3();
  v2 = new Vector3();
  e0 = new Vector3();
  e1 = new Vector3();
  e2 = new Vector3();

  constructor(v0: Vector3, v1: Vector3, v2: Vector3, collisionGroup: number, material: PhysicsMaterial) {
    super(CollisionShape.TRIANGLE, collisionGroup, material);
    this.initVertices(v0, v1, v2);
  }

  override calculateAABB(): AABB {
    const box = this.aabb;
    const m = this.transform;
    const eps = 0.005;
    const epsX = eps * m.m02;
    const epsY = eps * m.m12;
    const epsZ = eps * m.m22;

    const addAxis = (
      value: number, epsAxis: number,
      get: () => [number, number], set: (min: number, max: number) => void,
      first: boolean,
    ): void => {
      let a = value + epsAxis;
      let b = value - epsAxis;
      if (first) {
        set(Math.min(a, b), Math.max(a, b));
      } else {
        const [min, max] = get();
        set(Math.min(min, a, b), Math.max(max, a, b));
      }
    };

    let first = true;
    for (const v of [this.v0, this.v1, this.v2]) {
      addAxis(v.x * m.m00 + v.y * m.m01, epsX, () => [box.minX, box.maxX], (lo, hi) => { box.minX = lo; box.maxX = hi; }, first);
      addAxis(v.x * m.m10 + v.y * m.m11, epsY, () => [box.minY, box.maxY], (lo, hi) => { box.minY = lo; box.maxY = hi; }, first);
      addAxis(v.x * m.m20 + v.y * m.m21, epsZ, () => [box.minZ, box.maxZ], (lo, hi) => { box.minZ = lo; box.maxZ = hi; }, first);
      first = false;
    }
    box.minX += m.m03;
    box.maxX += m.m03;
    box.minY += m.m13;
    box.maxY += m.m13;
    box.minZ += m.m23;
    box.maxZ += m.m23;
    return box;
  }

  override raycast(origin: Vector3, dir: Vector3, eps: number, outNormal: Vector3): number {
    const m = this.transform;
    const dirDotNormal = dir.x * m.m02 + dir.y * m.m12 + dir.z * m.m22;
    if (dirDotNormal < eps && dirDotNormal > -eps) {
      return -1;
    }
    const rx = origin.x - m.m03;
    const ry = origin.y - m.m13;
    const rz = origin.z - m.m23;
    const originDotNormal = rx * m.m02 + ry * m.m12 + rz * m.m22;
    const t = -originDotNormal / dirDotNormal;
    if (t < 0) {
      return -1;
    }
    const localOx = rx * m.m00 + ry * m.m10 + rz * m.m20;
    const localOy = rx * m.m01 + ry * m.m11 + rz * m.m21;
    const px = localOx + t * (dir.x * m.m00 + dir.y * m.m10 + dir.z * m.m20);
    const py = localOy + t * (dir.x * m.m01 + dir.y * m.m11 + dir.z * m.m21);
    if (
      this.e0.x * (py - this.v0.y) - this.e0.y * (px - this.v0.x) < 0 ||
      this.e1.x * (py - this.v1.y) - this.e1.y * (px - this.v1.x) < 0 ||
      this.e2.x * (py - this.v2.y) - this.e2.y * (px - this.v2.x) < 0
    ) {
      return -1;
    }
    if (dirDotNormal > 0) {
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

  override copyFrom(source: CollisionShape): CollisionShape {
    super.copyFrom(source);
    if (source instanceof CollisionTriangle) {
      this.v0.copy(source.v0);
      this.v1.copy(source.v1);
      this.v2.copy(source.v2);
      this.e0.copy(source.e0);
      this.e1.copy(source.e1);
      this.e2.copy(source.e2);
    }
    return this;
  }

  protected override createPrimitive(): CollisionShape {
    return new CollisionTriangle(this.v0, this.v1, this.v2, this.collisionGroup, this.material);
  }

  private initVertices(v0: Vector3, v1: Vector3, v2: Vector3): void {
    this.v0.copy(v0);
    this.v1.copy(v1);
    this.v2.copy(v2);
    this.e0.diff(v1, v0);
    this.e0.normalize();
    this.e1.diff(v2, v1);
    this.e1.normalize();
    this.e2.diff(v0, v2);
    this.e2.normalize();
  }
}
