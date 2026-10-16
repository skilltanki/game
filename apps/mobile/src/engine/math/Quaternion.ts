// Port of the original Quaternion (the toVector3D bridge dropped)
import { Vector3 } from './Vector3';
import type { Matrix3 } from './Matrix3';
import type { Matrix4 } from './Matrix4';

export class Quaternion {
  private static readonly _q = new Quaternion();

  constructor(public w = 1, public x = 0, public y = 0, public z = 0) {}

  static multiply(a: Quaternion, b: Quaternion, out: Quaternion): void {
    out.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    out.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    out.y = a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z;
    out.z = a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x;
  }

  static createFromAxisAngle(axis: Vector3, angle: number): Quaternion {
    return new Quaternion().setFromAxisAngle(axis, angle);
  }

  static createFromAxisAngleComponents(x: number, y: number, z: number, angle: number): Quaternion {
    return new Quaternion().setFromAxisAngleComponents(x, y, z, angle);
  }

  reset(w = 1, x = 0, y = 0, z = 0): Quaternion {
    this.w = w; this.x = x; this.y = y; this.z = z;
    return this;
  }

  normalize(): Quaternion {
    let sqr = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
    if (sqr === 0) {
      this.w = 1;
    } else {
      sqr = 1 / Math.sqrt(sqr);
      this.w *= sqr; this.x *= sqr; this.y *= sqr; this.z *= sqr;
    }
    return this;
  }

  prepend(q: Quaternion): Quaternion {
    const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
    const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
    const y = this.w * q.y + this.y * q.w + this.z * q.x - this.x * q.z;
    const z = this.w * q.z + this.z * q.w + this.x * q.y - this.y * q.x;
    this.w = w; this.x = x; this.y = y; this.z = z;
    return this;
  }

  append(q: Quaternion): Quaternion {
    const w = q.w * this.w - q.x * this.x - q.y * this.y - q.z * this.z;
    const x = q.w * this.x + q.x * this.w + q.y * this.z - q.z * this.y;
    const y = q.w * this.y + q.y * this.w + q.z * this.x - q.x * this.z;
    const z = q.w * this.z + q.z * this.w + q.x * this.y - q.y * this.x;
    this.w = w; this.x = x; this.y = y; this.z = z;
    return this;
  }

  rotateByVector(v: Vector3): Quaternion {
    const w = -v.x * this.x - v.y * this.y - v.z * this.z;
    const x = v.x * this.w + v.y * this.z - v.z * this.y;
    const y = v.y * this.w + v.z * this.x - v.x * this.z;
    const z = v.z * this.w + v.x * this.y - v.y * this.x;
    this.w = w; this.x = x; this.y = y; this.z = z;
    return this;
  }

  addScaledVector(v: Vector3, scale: number): Quaternion {
    const vx = v.x * scale;
    const vy = v.y * scale;
    const vz = v.z * scale;
    const dw = -this.x * vx - this.y * vy - this.z * vz;
    const dx = vx * this.w + vy * this.z - vz * this.y;
    const dy = vy * this.w + vz * this.x - vx * this.z;
    const dz = vz * this.w + vx * this.y - vy * this.x;
    this.w += 0.5 * dw;
    this.x += 0.5 * dx;
    this.y += 0.5 * dy;
    this.z += 0.5 * dz;
    let sqr = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
    if (sqr === 0) {
      this.w = 1;
    } else {
      sqr = 1 / Math.sqrt(sqr);
      this.w *= sqr; this.x *= sqr; this.y *= sqr; this.z *= sqr;
    }
    return this;
  }

  toMatrix3(m: Matrix3): Quaternion {
    const xx = 2 * this.x * this.x;
    const yy = 2 * this.y * this.y;
    const zz = 2 * this.z * this.z;
    const xy = 2 * this.x * this.y;
    const yz = 2 * this.y * this.z;
    const zx = 2 * this.z * this.x;
    const wx = 2 * this.w * this.x;
    const wy = 2 * this.w * this.y;
    const wz = 2 * this.w * this.z;
    m.m00 = 1 - yy - zz;
    m.m01 = xy - wz;
    m.m02 = zx + wy;
    m.m10 = xy + wz;
    m.m11 = 1 - xx - zz;
    m.m12 = yz - wx;
    m.m20 = zx - wy;
    m.m21 = yz + wx;
    m.m22 = 1 - xx - yy;
    return this;
  }

  getYAxis(out: Vector3): Vector3 {
    const xx = 2 * this.x * this.x;
    const zz = 2 * this.z * this.z;
    const xy = 2 * this.x * this.y;
    const yz = 2 * this.y * this.z;
    const wx = 2 * this.w * this.x;
    const wz = 2 * this.w * this.z;
    out.x = xy - wz;
    out.y = 1 - xx - zz;
    out.z = yz + wx;
    return out;
  }

  getZAxis(out: Vector3): Vector3 {
    const xx = 2 * this.x * this.x;
    const yy = 2 * this.y * this.y;
    const yz = 2 * this.y * this.z;
    const zx = 2 * this.z * this.x;
    const wx = 2 * this.w * this.x;
    const wy = 2 * this.w * this.y;
    out.x = zx + wy;
    out.y = yz - wx;
    out.z = 1 - xx - yy;
    return out;
  }

  toMatrix4(m: Matrix4): Quaternion {
    const xx = 2 * this.x * this.x;
    const yy = 2 * this.y * this.y;
    const zz = 2 * this.z * this.z;
    const xy = 2 * this.x * this.y;
    const yz = 2 * this.y * this.z;
    const zx = 2 * this.z * this.x;
    const wx = 2 * this.w * this.x;
    const wy = 2 * this.w * this.y;
    const wz = 2 * this.w * this.z;
    m.m00 = 1 - yy - zz;
    m.m01 = xy - wz;
    m.m02 = zx + wy;
    m.m10 = xy + wz;
    m.m11 = 1 - xx - zz;
    m.m12 = yz - wx;
    m.m20 = zx - wy;
    m.m21 = yz + wx;
    m.m22 = 1 - xx - yy;
    return this;
  }

  length(): number {
    return Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSqr(): number {
    return this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
  }

  setFromAxisAngle(axis: Vector3, angle: number): Quaternion {
    this.w = Math.cos(0.5 * angle);
    const k = Math.sin(0.5 * angle) / Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
    this.x = axis.x * k;
    this.y = axis.y * k;
    this.z = axis.z * k;
    return this;
  }

  setFromAxisAngleComponents(x: number, y: number, z: number, angle: number): Quaternion {
    this.w = Math.cos(0.5 * angle);
    const k = Math.sin(0.5 * angle) / Math.sqrt(x * x + y * y + z * z);
    this.x = x * k;
    this.y = y * k;
    this.z = z * k;
    return this;
  }

  toAxisVector(out: Vector3 | null = null): Vector3 {
    if (this.w < -1 || this.w > 1) {
      this.normalize();
    }
    if (out == null) {
      out = new Vector3();
    }
    if (this.w > -1 && this.w < 1) {
      if (this.w === 0) {
        out.x = this.x;
        out.y = this.y;
        out.z = this.z;
      } else {
        const angle = 2 * Math.acos(this.w);
        const k = 1 / Math.sqrt(1 - this.w * this.w);
        out.x = this.x * k * angle;
        out.y = this.y * k * angle;
        out.z = this.z * k * angle;
      }
    } else {
      out.x = 0;
      out.y = 0;
      out.z = 0;
    }
    return out;
  }

  getEulerAngles(out: Vector3 | null): Vector3 {
    const xx = 2 * this.x * this.x;
    const yy = 2 * this.y * this.y;
    const zz = 2 * this.z * this.z;
    const xy = 2 * this.x * this.y;
    const yz = 2 * this.y * this.z;
    const zx = 2 * this.z * this.x;
    const wx = 2 * this.w * this.x;
    const wy = 2 * this.w * this.y;
    const wz = 2 * this.w * this.z;
    const m00 = 1 - yy - zz;
    const m01 = xy - wz;
    const m10 = xy + wz;
    const m11 = 1 - xx - zz;
    const m20 = zx - wy;
    const m21 = yz + wx;
    const m22 = 1 - xx - yy;
    if (-1 < m20 && m20 < 1) {
      if (out == null) {
        out = new Vector3(Math.atan2(m21, m22), -Math.asin(m20), Math.atan2(m10, m00));
      } else {
        out.x = Math.atan2(m21, m22);
        out.y = -Math.asin(m20);
        out.z = Math.atan2(m10, m00);
      }
    } else if (out == null) {
      out = new Vector3(0, 0.5 * (m20 <= -1 ? Math.PI : -Math.PI), Math.atan2(-m01, m11));
    } else {
      out.x = 0;
      out.y = m20 <= -1 ? Math.PI : -Math.PI;
      out.y *= 0.5;
      out.z = Math.atan2(-m01, m11);
    }
    return out;
  }

  setFromEulerAnglesXYZ(rx: number, ry: number, rz: number): void {
    const q = Quaternion._q;
    this.setFromAxisAngleComponents(1, 0, 0, rx);
    q.setFromAxisAngleComponents(0, 1, 0, ry);
    this.append(q);
    this.normalize();
    q.setFromAxisAngleComponents(0, 0, 1, rz);
    this.append(q);
    this.normalize();
  }

  setFromEulerAngles(angles: Vector3): void {
    this.setFromEulerAnglesXYZ(angles.x, angles.y, angles.z);
  }

  conjugate(): void {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
  }

  nlerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
    let k = 1 - t;
    this.w = a.w * k + b.w * t;
    this.x = a.x * k + b.x * t;
    this.y = a.y * k + b.y * t;
    this.z = a.z * k + b.z * t;
    k = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
    if (k === 0) {
      this.w = 1;
    } else {
      k = 1 / Math.sqrt(k);
      this.w *= k; this.x *= k; this.y *= k; this.z *= k;
    }
    return this;
  }

  subtract(q: Quaternion): Quaternion {
    this.w -= q.w; this.x -= q.x; this.y -= q.y; this.z -= q.z;
    return this;
  }

  diff(a: Quaternion, b: Quaternion): Quaternion {
    this.w = b.w - a.w;
    this.x = b.x - a.x;
    this.y = b.y - a.y;
    this.z = b.z - a.z;
    return this;
  }

  copy(q: Quaternion): Quaternion {
    this.w = q.w; this.x = q.x; this.y = q.y; this.z = q.z;
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this.w, this.x, this.y, this.z);
  }

  toString(): string {
    return `Quaternion(${this.w}, ${this.x}, ${this.y}, ${this.z})`;
  }

  slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
    let sign = 1;
    let cos = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    if (cos < 0) {
      cos = -cos;
      sign = -1;
    }
    if (1 - cos < 0.001) {
      const ka = 1 - t;
      const kb = t * sign;
      this.w = a.w * ka + b.w * kb;
      this.x = a.x * ka + b.x * kb;
      this.y = a.y * ka + b.y * kb;
      this.z = a.z * ka + b.z * kb;
      this.normalize();
    } else {
      const angle = Math.acos(cos);
      const sin = Math.sin(angle);
      const ka = Math.sin((1 - t) * angle) / sin;
      const kb = (Math.sin(t * angle) / sin) * sign;
      this.w = a.w * ka + b.w * kb;
      this.x = a.x * ka + b.x * kb;
      this.y = a.y * ka + b.y * kb;
      this.z = a.z * ka + b.z * kb;
    }
    return this;
  }

  isFiniteQuaternion(): boolean {
    return isFinite(this.w) && isFinite(this.x) && isFinite(this.y) && isFinite(this.z);
  }
}
