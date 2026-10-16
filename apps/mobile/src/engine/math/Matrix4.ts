// Port of the original Matrix4 (3x4 affine; setMatrixForObject3D/setFromMatrix3D bridges dropped)
import { Vector3 } from './Vector3';
import type { Matrix3 } from './Matrix3';

export class Matrix4 {
  static readonly IDENTITY = new Matrix4();

  m00!: number; m01!: number; m02!: number; m03!: number;
  m10!: number; m11!: number; m12!: number; m13!: number;
  m20!: number; m21!: number; m22!: number; m23!: number;

  constructor(
    m00 = 1, m01 = 0, m02 = 0, m03 = 0,
    m10 = 0, m11 = 1, m12 = 0, m13 = 0,
    m20 = 0, m21 = 0, m22 = 1, m23 = 0,
  ) {
    this.init(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23);
  }

  init(
    m00: number, m01: number, m02: number, m03: number,
    m10: number, m11: number, m12: number, m13: number,
    m20: number, m21: number, m22: number, m23: number,
  ): void {
    this.m00 = m00; this.m01 = m01; this.m02 = m02; this.m03 = m03;
    this.m10 = m10; this.m11 = m11; this.m12 = m12; this.m13 = m13;
    this.m20 = m20; this.m21 = m21; this.m22 = m22; this.m23 = m23;
  }

  toIdentity(): Matrix4 {
    this.m00 = this.m11 = this.m22 = 1;
    this.m01 = this.m02 = this.m10 = this.m12 = this.m20 = this.m21 = this.m03 = this.m13 = this.m23 = 0;
    return this;
  }

  invert(): Matrix4 {
    const a = this.m00, b = this.m01, c = this.m02, d = this.m03;
    const e = this.m10, f = this.m11, g = this.m12, h = this.m13;
    const i = this.m20, j = this.m21, k = this.m22, l = this.m23;
    const det = -c * f * i + b * g * i + c * e * j - a * g * j - b * e * k + a * f * k;
    this.m00 = (-g * j + f * k) / det;
    this.m01 = (c * j - b * k) / det;
    this.m02 = (-c * f + b * g) / det;
    this.m03 = (d * g * j - c * h * j - d * f * k + b * h * k + c * f * l - b * g * l) / det;
    this.m10 = (g * i - e * k) / det;
    this.m11 = (-c * i + a * k) / det;
    this.m12 = (c * e - a * g) / det;
    this.m13 = (c * h * i - d * g * i + d * e * k - a * h * k - c * e * l + a * g * l) / det;
    this.m20 = (-f * i + e * j) / det;
    this.m21 = (b * i - a * j) / det;
    this.m22 = (-b * e + a * f) / det;
    this.m23 = (d * f * i - b * h * i - d * e * j + a * h * j + b * e * l - a * f * l) / det;
    return this;
  }

  append(m: Matrix4): Matrix4 {
    const a = this.m00, b = this.m01, c = this.m02, d = this.m03;
    const e = this.m10, f = this.m11, g = this.m12, h = this.m13;
    const i = this.m20, j = this.m21, k = this.m22, l = this.m23;
    this.m00 = m.m00 * a + m.m01 * e + m.m02 * i;
    this.m01 = m.m00 * b + m.m01 * f + m.m02 * j;
    this.m02 = m.m00 * c + m.m01 * g + m.m02 * k;
    this.m03 = m.m00 * d + m.m01 * h + m.m02 * l + m.m03;
    this.m10 = m.m10 * a + m.m11 * e + m.m12 * i;
    this.m11 = m.m10 * b + m.m11 * f + m.m12 * j;
    this.m12 = m.m10 * c + m.m11 * g + m.m12 * k;
    this.m13 = m.m10 * d + m.m11 * h + m.m12 * l + m.m13;
    this.m20 = m.m20 * a + m.m21 * e + m.m22 * i;
    this.m21 = m.m20 * b + m.m21 * f + m.m22 * j;
    this.m22 = m.m20 * c + m.m21 * g + m.m22 * k;
    this.m23 = m.m20 * d + m.m21 * h + m.m22 * l + m.m23;
    return this;
  }

  prepend(m: Matrix4): Matrix4 {
    const a = this.m00, b = this.m01, c = this.m02, d = this.m03;
    const e = this.m10, f = this.m11, g = this.m12, h = this.m13;
    const i = this.m20, j = this.m21, k = this.m22, l = this.m23;
    this.m00 = a * m.m00 + b * m.m10 + c * m.m20;
    this.m01 = a * m.m01 + b * m.m11 + c * m.m21;
    this.m02 = a * m.m02 + b * m.m12 + c * m.m22;
    this.m03 = a * m.m03 + b * m.m13 + c * m.m23 + d;
    this.m10 = e * m.m00 + f * m.m10 + g * m.m20;
    this.m11 = e * m.m01 + f * m.m11 + g * m.m21;
    this.m12 = e * m.m02 + f * m.m12 + g * m.m22;
    this.m13 = e * m.m03 + f * m.m13 + g * m.m23 + h;
    this.m20 = i * m.m00 + j * m.m10 + k * m.m20;
    this.m21 = i * m.m01 + j * m.m11 + k * m.m21;
    this.m22 = i * m.m02 + j * m.m12 + k * m.m22;
    this.m23 = i * m.m03 + j * m.m13 + k * m.m23 + l;
    return this;
  }

  add(m: Matrix4): Matrix4 {
    this.m00 += m.m00; this.m01 += m.m01; this.m02 += m.m02; this.m03 += m.m03;
    this.m10 += m.m10; this.m11 += m.m11; this.m12 += m.m12; this.m13 += m.m13;
    this.m20 += m.m20; this.m21 += m.m21; this.m22 += m.m22; this.m23 += m.m23;
    return this;
  }

  subtract(m: Matrix4): Matrix4 {
    this.m00 -= m.m00; this.m01 -= m.m01; this.m02 -= m.m02; this.m03 -= m.m03;
    this.m10 -= m.m10; this.m11 -= m.m11; this.m12 -= m.m12; this.m13 -= m.m13;
    this.m20 -= m.m20; this.m21 -= m.m21; this.m22 -= m.m22; this.m23 -= m.m23;
    return this;
  }

  transformVector(v: Vector3, out: Vector3): void {
    out.x = this.m00 * v.x + this.m01 * v.y + this.m02 * v.z + this.m03;
    out.y = this.m10 * v.x + this.m11 * v.y + this.m12 * v.z + this.m13;
    out.z = this.m20 * v.x + this.m21 * v.y + this.m22 * v.z + this.m23;
  }

  transformVectorXYZ(x: number, y: number, z: number, out: Vector3): void {
    out.x = this.m00 * x + this.m01 * y + this.m02 * z + this.m03;
    out.y = this.m10 * x + this.m11 * y + this.m12 * z + this.m13;
    out.z = this.m20 * x + this.m21 * y + this.m22 * z + this.m23;
  }

  transformVectorInverse(v: Vector3, out: Vector3): void {
    const x = v.x - this.m03, y = v.y - this.m13, z = v.z - this.m23;
    out.x = this.m00 * x + this.m10 * y + this.m20 * z;
    out.y = this.m01 * x + this.m11 * y + this.m21 * z;
    out.z = this.m02 * x + this.m12 * y + this.m22 * z;
  }

  transformVectors(src: Vector3[], dst: Vector3[]): void {
    this.transformVectorsN(src, dst, src.length);
  }

  transformVectorsN(src: Vector3[], dst: Vector3[], n: number): void {
    for (let idx = 0; idx < n; idx++) {
      const v = src[idx];
      const out = dst[idx];
      out.x = this.m00 * v.x + this.m01 * v.y + this.m02 * v.z + this.m03;
      out.y = this.m10 * v.x + this.m11 * v.y + this.m12 * v.z + this.m13;
      out.z = this.m20 * v.x + this.m21 * v.y + this.m22 * v.z + this.m23;
    }
  }

  transformVectorsInverse(src: Vector3[], dst: Vector3[]): void {
    this.transformVectorsInverseN(src, dst, src.length);
  }

  transformVectorsInverseN(src: Vector3[], dst: Vector3[], n: number): void {
    for (let idx = 0; idx < n; idx++) {
      const v = src[idx];
      const out = dst[idx];
      const x = v.x - this.m03, y = v.y - this.m13, z = v.z - this.m23;
      out.x = this.m00 * x + this.m10 * y + this.m20 * z;
      out.y = this.m01 * x + this.m11 * y + this.m21 * z;
      out.z = this.m02 * x + this.m12 * y + this.m22 * z;
    }
  }

  getRight(out: Vector3): void {
    this.getAxis(0, out);
  }

  getForward(out: Vector3): void {
    this.getAxis(1, out);
  }

  getUp(out: Vector3): void {
    this.getAxis(2, out);
  }

  getAxis(index: number, out: Vector3): void {
    switch (index) {
      case 0:
        out.x = this.m00; out.y = this.m10; out.z = this.m20;
        return;
      case 1:
        out.x = this.m01; out.y = this.m11; out.z = this.m21;
        return;
      case 2:
        out.x = this.m02; out.y = this.m12; out.z = this.m22;
        return;
      case 3:
        out.x = this.m03; out.y = this.m13; out.z = this.m23;
        return;
    }
  }

  deltaTransformVector(v: Vector3, out: Vector3): void {
    out.x = this.m00 * v.x + this.m01 * v.y + this.m02 * v.z;
    out.y = this.m10 * v.x + this.m11 * v.y + this.m12 * v.z;
    out.z = this.m20 * v.x + this.m21 * v.y + this.m22 * v.z;
  }

  deltaTransformVectorInverse(v: Vector3, out: Vector3): void {
    out.x = this.m00 * v.x + this.m10 * v.y + this.m20 * v.z;
    out.y = this.m01 * v.x + this.m11 * v.y + this.m21 * v.z;
    out.z = this.m02 * v.x + this.m12 * v.y + this.m22 * v.z;
  }

  copy(m: Matrix4): Matrix4 {
    this.m00 = m.m00; this.m01 = m.m01; this.m02 = m.m02; this.m03 = m.m03;
    this.m10 = m.m10; this.m11 = m.m11; this.m12 = m.m12; this.m13 = m.m13;
    this.m20 = m.m20; this.m21 = m.m21; this.m22 = m.m22; this.m23 = m.m23;
    return this;
  }

  setFromMatrix3(m: Matrix3, pos: Vector3): Matrix4 {
    this.m00 = m.m00; this.m01 = m.m01; this.m02 = m.m02; this.m03 = pos.x;
    this.m10 = m.m10; this.m11 = m.m11; this.m12 = m.m12; this.m13 = pos.y;
    this.m20 = m.m20; this.m21 = m.m21; this.m22 = m.m22; this.m23 = pos.z;
    return this;
  }

  setOrientationFromMatrix3(m: Matrix3): Matrix4 {
    this.m00 = m.m00; this.m01 = m.m01; this.m02 = m.m02;
    this.m10 = m.m10; this.m11 = m.m11; this.m12 = m.m12;
    this.m20 = m.m20; this.m21 = m.m21; this.m22 = m.m22;
    return this;
  }

  setRotationMatrix(rx: number, ry: number, rz: number): Matrix4 {
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
    const cosZsinY = cosZ * sinY;
    const sinZsinY = sinZ * sinY;
    this.m00 = cosZ * cosY;
    this.m01 = cosZsinY * sinX - sinZ * cosX;
    this.m02 = cosZsinY * cosX + sinZ * sinX;
    this.m10 = sinZ * cosY;
    this.m11 = sinZsinY * sinX + cosZ * cosX;
    this.m12 = sinZsinY * cosX - cosZ * sinX;
    this.m20 = -sinY;
    this.m21 = cosY * sinX;
    this.m22 = cosY * cosX;
    return this;
  }

  setMatrix(x: number, y: number, z: number, rx: number, ry: number, rz: number): Matrix4 {
    this.setRotationMatrix(rx, ry, rz);
    this.m03 = x;
    this.m13 = y;
    this.m23 = z;
    return this;
  }

  getEulerAngles(out: Vector3): void {
    if (-1 < this.m20 && this.m20 < 1) {
      out.x = Math.atan2(this.m21, this.m22);
      out.y = -Math.asin(this.m20);
      out.z = Math.atan2(this.m10, this.m00);
    } else {
      out.x = 0;
      out.y = this.m20 <= -1 ? Math.PI : -Math.PI;
      out.y *= 0.5;
      out.z = Math.atan2(-this.m01, this.m11);
    }
  }

  setPosition(v: Vector3): void {
    this.m03 = v.x;
    this.m13 = v.y;
    this.m23 = v.z;
  }

  getPosition(out: Vector3): void {
    out.x = this.m03;
    out.y = this.m13;
    out.z = this.m23;
  }

  clone(): Matrix4 {
    return new Matrix4(
      this.m00, this.m01, this.m02, this.m03,
      this.m10, this.m11, this.m12, this.m13,
      this.m20, this.m21, this.m22, this.m23,
    );
  }

  fromAxisAngle(axis: Vector3, angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const x = axis.x, y = axis.y, z = axis.z;
    this.m00 = t * x * x + c;
    this.m01 = t * x * y - z * s;
    this.m02 = t * x * z + y * s;
    this.m10 = t * x * y + z * s;
    this.m11 = t * y * y + c;
    this.m12 = t * y * z - x * s;
    this.m20 = t * x * z - y * s;
    this.m21 = t * y * z + x * s;
    this.m22 = t * z * z + c;
  }
}
