// Port of the original Vector3 (the toVector3D network bridges dropped)
import type { Matrix3 } from './Matrix3';
import type { Matrix4 } from './Matrix4';

export class Vector3 {
  static readonly ZERO = new Vector3(0, 0, 0);
  static readonly X_AXIS = new Vector3(1, 0, 0);
  static readonly Y_AXIS = new Vector3(0, 1, 0);
  static readonly Z_AXIS = new Vector3(0, 0, 1);
  static readonly DOWN = new Vector3(0, 0, -1);

  constructor(public x = 0, public y = 0, public z = 0) {}

  static isFiniteVector(v: Vector3 | null): boolean {
    return v != null && isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  static interpolate(t: number, a: Vector3, b: Vector3, out: Vector3): void {
    out.x = a.x + t * (b.x - a.x);
    out.y = a.y + t * (b.y - a.y);
    out.z = a.z + t * (b.z - a.z);
  }

  static distanceBetween(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  interpolate(t: number, a: Vector3, b: Vector3): void {
    this.x = a.x + t * (b.x - a.x);
    this.y = a.y + t * (b.y - a.y);
    this.z = a.z + t * (b.z - a.z);
  }

  isFiniteVector(): boolean {
    return isFinite(this.x) && isFinite(this.y) && isFinite(this.z);
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSqr(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  setLength(len: number): Vector3 {
    const sqr = this.x * this.x + this.y * this.y + this.z * this.z;
    if (sqr === 0) {
      this.x = len;
    } else {
      const k = len / Math.sqrt(sqr);
      this.x *= k;
      this.y *= k;
      this.z *= k;
    }
    return this;
  }

  normalize(): Vector3 {
    let sqr = this.x * this.x + this.y * this.y + this.z * this.z;
    if (sqr === 0) {
      this.x = 1;
    } else {
      sqr = Math.sqrt(sqr);
      this.x /= sqr;
      this.y /= sqr;
      this.z /= sqr;
    }
    return this;
  }

  add(v: Vector3): Vector3 {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }

  addScaled(k: number, v: Vector3): Vector3 {
    this.x += k * v.x; this.y += k * v.y; this.z += k * v.z;
    return this;
  }

  subtract(v: Vector3): Vector3 {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }

  sum(a: Vector3, b: Vector3): Vector3 {
    this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z;
    return this;
  }

  diff(a: Vector3, b: Vector3): Vector3 {
    this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z;
    return this;
  }

  diff2d(a: Vector3, b: Vector3): Vector3 {
    this.x = a.x - b.x; this.y = a.y - b.y; this.z = 0;
    return this;
  }

  scale(k: number): Vector3 {
    this.x *= k; this.y *= k; this.z *= k;
    return this;
  }

  reverse(): Vector3 {
    this.x = -this.x; this.y = -this.y; this.z = -this.z;
    return this;
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): Vector3 {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  cross2(a: Vector3, b: Vector3): Vector3 {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }

  transform3(m: Matrix3): Vector3 {
    const x = this.x, y = this.y, z = this.z;
    this.x = m.m00 * x + m.m01 * y + m.m02 * z;
    this.y = m.m10 * x + m.m11 * y + m.m12 * z;
    this.z = m.m20 * x + m.m21 * y + m.m22 * z;
    return this;
  }

  transformTransposed3(m: Matrix3): Vector3 {
    const x = this.x, y = this.y, z = this.z;
    this.x = m.m00 * x + m.m10 * y + m.m20 * z;
    this.y = m.m01 * x + m.m11 * y + m.m21 * z;
    this.z = m.m02 * x + m.m12 * y + m.m22 * z;
    return this;
  }

  transform4(m: Matrix4): Vector3 {
    const x = this.x, y = this.y, z = this.z;
    this.x = m.m00 * x + m.m01 * y + m.m02 * z + m.m03;
    this.y = m.m10 * x + m.m11 * y + m.m12 * z + m.m13;
    this.z = m.m20 * x + m.m21 * y + m.m22 * z + m.m23;
    return this;
  }

  transformInverse4(m: Matrix4): Vector3 {
    const x = this.x - m.m03, y = this.y - m.m13, z = this.z - m.m23;
    this.x = m.m00 * x + m.m10 * y + m.m20 * z;
    this.y = m.m01 * x + m.m11 * y + m.m21 * z;
    this.z = m.m02 * x + m.m12 * y + m.m22 * z;
    return this;
  }

  transformVector4(m: Matrix4): Vector3 {
    const x = this.x, y = this.y, z = this.z;
    this.x = m.m00 * x + m.m01 * y + m.m02 * z;
    this.y = m.m10 * x + m.m11 * y + m.m12 * z;
    this.z = m.m20 * x + m.m21 * y + m.m22 * z;
    return this;
  }

  reset(x = 0, y = 0, z = 0): Vector3 {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(v: Vector3): Vector3 {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  toString(): string {
    return `Vector3 (${this.x.toFixed(5)}, ${this.y.toFixed(5)}, ${this.z.toFixed(5)})`;
  }

  distanceToXYSquared(v: Vector3): number {
    const dx = this.x - v.x, dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  distanceToXY(v: Vector3): number {
    const dx = this.x - v.x, dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceTo(v: Vector3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSquared(v: Vector3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  setLengthAlongDirection(dir: Vector3, len: number): void {
    const current = this.x * dir.x + this.y * dir.y + this.z * dir.z;
    const d = len - current;
    this.x += d * dir.x;
    this.y += d * dir.y;
    this.z += d * dir.z;
  }

  projectOnPlane(normal: Vector3): void {
    const d = this.x * normal.x + this.y * normal.y + this.z * normal.z;
    this.x -= d * normal.x;
    this.y -= d * normal.y;
    this.z -= d * normal.z;
  }
}
