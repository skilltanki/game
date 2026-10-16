// Port of the original PhysicsUtils
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';

export class PhysicsUtils {
  static setBoxInvInertia(mass: number, halfSize: Vector3, out: Matrix3): void {
    if (mass <= 0) {
      throw new Error('mass must be positive');
    }
    out.copy(Matrix3.ZERO);
    if (mass === Infinity) {
      return;
    }
    const xx = halfSize.x * halfSize.x;
    const yy = halfSize.y * halfSize.y;
    const zz = halfSize.z * halfSize.z;
    out.m00 = 3 / (mass * (yy + zz));
    out.m11 = 3 / (mass * (zz + xx));
    out.m22 = 3 / (mass * (xx + yy));
  }

  static getCylinderInvInertia(mass: number, radius: number, height: number, out: Matrix3): void {
    if (mass <= 0) {
      throw new Error('mass must be positive');
    }
    out.copy(Matrix3.ZERO);
    if (mass === Infinity) {
      return;
    }
    out.m00 = out.m11 = 1 / (mass * ((height * height) / 12 + (radius * radius) / 4));
    out.m22 = 2 / (mass * radius * radius);
  }
}
