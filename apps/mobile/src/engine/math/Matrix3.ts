// Port of the original Matrix3 (setRotationMatrixForObject3D render bridge dropped)
import { Vector3 } from './Vector3';

export class Matrix3 {
  static readonly ZERO = new Matrix3(0, 0, 0, 0, 0, 0, 0, 0, 0);
  static readonly IDENTITY = new Matrix3();

  private static readonly xAxis = new Vector3();
  private static readonly yAxis = new Vector3();
  private static readonly zAxis = new Vector3();

  constructor(
    public m00 = 1, public m01 = 0, public m02 = 0,
    public m10 = 0, public m11 = 1, public m12 = 0,
    public m20 = 0, public m21 = 0, public m22 = 1,
  ) {}

  toIdentity(): Matrix3 {
    this.m00 = this.m11 = this.m22 = 1;
    this.m01 = this.m02 = this.m10 = this.m12 = this.m20 = this.m21 = 0;
    return this;
  }

  invert(): Matrix3 {
    const a = this.m00, b = this.m01, c = this.m02;
    const d = this.m10, e = this.m11, f = this.m12;
    const g = this.m20, h = this.m21, i = this.m22;
    const det = 1 / (-c * e * g + b * f * g + c * d * h - a * f * h - b * d * i + a * e * i);
    this.m00 = (e * i - f * h) * det;
    this.m01 = (c * h - b * i) * det;
    this.m02 = (b * f - c * e) * det;
    this.m10 = (f * g - d * i) * det;
    this.m11 = (a * i - c * g) * det;
    this.m12 = (c * d - a * f) * det;
    this.m20 = (d * h - e * g) * det;
    this.m21 = (b * g - a * h) * det;
    this.m22 = (a * e - b * d) * det;
    return this;
  }

  append(m: Matrix3): Matrix3 {
    const a = this.m00, b = this.m01, c = this.m02;
    const d = this.m10, e = this.m11, f = this.m12;
    const g = this.m20, h = this.m21, i = this.m22;
    this.m00 = m.m00 * a + m.m01 * d + m.m02 * g;
    this.m01 = m.m00 * b + m.m01 * e + m.m02 * h;
    this.m02 = m.m00 * c + m.m01 * f + m.m02 * i;
    this.m10 = m.m10 * a + m.m11 * d + m.m12 * g;
    this.m11 = m.m10 * b + m.m11 * e + m.m12 * h;
    this.m12 = m.m10 * c + m.m11 * f + m.m12 * i;
    this.m20 = m.m20 * a + m.m21 * d + m.m22 * g;
    this.m21 = m.m20 * b + m.m21 * e + m.m22 * h;
    this.m22 = m.m20 * c + m.m21 * f + m.m22 * i;
    return this;
  }

  prepend(m: Matrix3): Matrix3 {
    const a = this.m00, b = this.m01, c = this.m02;
    const d = this.m10, e = this.m11, f = this.m12;
    const g = this.m20, h = this.m21, i = this.m22;
    this.m00 = a * m.m00 + b * m.m10 + c * m.m20;
    this.m01 = a * m.m01 + b * m.m11 + c * m.m21;
    this.m02 = a * m.m02 + b * m.m12 + c * m.m22;
    this.m10 = d * m.m00 + e * m.m10 + f * m.m20;
    this.m11 = d * m.m01 + e * m.m11 + f * m.m21;
    this.m12 = d * m.m02 + e * m.m12 + f * m.m22;
    this.m20 = g * m.m00 + h * m.m10 + i * m.m20;
    this.m21 = g * m.m01 + h * m.m11 + i * m.m21;
    this.m22 = g * m.m02 + h * m.m12 + i * m.m22;
    return this;
  }

  prependTransposed(m: Matrix3): Matrix3 {
    const a = this.m00, b = this.m01, c = this.m02;
    const d = this.m10, e = this.m11, f = this.m12;
    const g = this.m20, h = this.m21, i = this.m22;
    this.m00 = a * m.m00 + b * m.m01 + c * m.m02;
    this.m01 = a * m.m10 + b * m.m11 + c * m.m12;
    this.m02 = a * m.m20 + b * m.m21 + c * m.m22;
    this.m10 = d * m.m00 + e * m.m01 + f * m.m02;
    this.m11 = d * m.m10 + e * m.m11 + f * m.m12;
    this.m12 = d * m.m20 + e * m.m21 + f * m.m22;
    this.m20 = g * m.m00 + h * m.m01 + i * m.m02;
    this.m21 = g * m.m10 + h * m.m11 + i * m.m12;
    this.m22 = g * m.m20 + h * m.m21 + i * m.m22;
    return this;
  }

  add(m: Matrix3): Matrix3 {
    this.m00 += m.m00; this.m01 += m.m01; this.m02 += m.m02;
    this.m10 += m.m10; this.m11 += m.m11; this.m12 += m.m12;
    this.m20 += m.m20; this.m21 += m.m21; this.m22 += m.m22;
    return this;
  }

  subtract(m: Matrix3): Matrix3 {
    this.m00 -= m.m00; this.m01 -= m.m01; this.m02 -= m.m02;
    this.m10 -= m.m10; this.m11 -= m.m11; this.m12 -= m.m12;
    this.m20 -= m.m20; this.m21 -= m.m21; this.m22 -= m.m22;
    return this;
  }

  transpose(): Matrix3 {
    let t = this.m01; this.m01 = this.m10; this.m10 = t;
    t = this.m02; this.m02 = this.m20; this.m20 = t;
    t = this.m12; this.m12 = this.m21; this.m21 = t;
    return this;
  }

  transformVector(v: Vector3, out: Vector3): void {
    out.x = this.m00 * v.x + this.m01 * v.y + this.m02 * v.z;
    out.y = this.m10 * v.x + this.m11 * v.y + this.m12 * v.z;
    out.z = this.m20 * v.x + this.m21 * v.y + this.m22 * v.z;
  }

  transformVectorInverse(v: Vector3, out: Vector3): void {
    out.x = this.m00 * v.x + this.m10 * v.y + this.m20 * v.z;
    out.y = this.m01 * v.x + this.m11 * v.y + this.m21 * v.z;
    out.z = this.m02 * v.x + this.m12 * v.y + this.m22 * v.z;
  }

  createSkewSymmetric(v: Vector3): Matrix3 {
    this.m00 = this.m11 = this.m22 = 0;
    this.m01 = -v.z;
    this.m02 = v.y;
    this.m10 = v.z;
    this.m12 = -v.x;
    this.m20 = -v.y;
    this.m21 = v.x;
    return this;
  }

  copy(m: Matrix3): Matrix3 {
    this.m00 = m.m00; this.m01 = m.m01; this.m02 = m.m02;
    this.m10 = m.m10; this.m11 = m.m11; this.m12 = m.m12;
    this.m20 = m.m20; this.m21 = m.m21; this.m22 = m.m22;
    return this;
  }

  setRotationMatrix(rx: number, ry: number, rz: number): Matrix3 {
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

  clone(): Matrix3 {
    return new Matrix3(this.m00, this.m01, this.m02, this.m10, this.m11, this.m12, this.m20, this.m21, this.m22);
  }

  toString(): string {
    return `Matrix3 (${this.m00}, ${this.m01}, ${this.m02}), (${this.m10}, ${this.m11}, ${this.m12}), (${this.m20}, ${this.m21}, ${this.m22})`;
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
        out.reset(this.m00, this.m10, this.m20);
        break;
      case 1:
        out.reset(this.m01, this.m11, this.m21);
        break;
      case 2:
        out.reset(this.m02, this.m12, this.m22);
    }
  }

  setDirectionVector(dir: Vector3): void {
    const { xAxis, yAxis, zAxis } = Matrix3;
    yAxis.copy(dir).normalize();
    if (yAxis.dot(Vector3.X_AXIS) < 0.9) {
      zAxis.cross2(Vector3.X_AXIS, yAxis);
    } else {
      zAxis.cross2(yAxis, Vector3.Y_AXIS);
    }
    zAxis.normalize();
    xAxis.cross2(yAxis, zAxis).normalize();
    this.setAxis(xAxis, yAxis, zAxis);
  }

  setAxis(x: Vector3, y: Vector3, z: Vector3): void {
    this.m00 = x.x; this.m01 = y.x; this.m02 = z.x;
    this.m10 = x.y; this.m11 = y.y; this.m12 = z.y;
    this.m20 = x.z; this.m21 = y.z; this.m22 = z.z;
  }
}
