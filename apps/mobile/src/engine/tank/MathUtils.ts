// Port of the original MathUtils
export class MathUtils {
  static readonly PI2 = 2 * Math.PI;

  static clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  static clampAngle(angle: number): number {
    angle %= MathUtils.PI2;
    if (angle < -Math.PI) return MathUtils.PI2 + angle;
    if (angle > Math.PI) return angle - MathUtils.PI2;
    return angle;
  }

  static clampAngleFast(angle: number): number {
    if (angle < -Math.PI) return MathUtils.PI2 + angle;
    if (angle > Math.PI) return angle - MathUtils.PI2;
    return angle;
  }

  static toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }

  static toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  static getBitValue(value: number, bit: number): number {
    return (value >> bit) & 1;
  }

  static changeBitValue(value: number, bit: number, set: boolean): number {
    if (set) return value | (1 << bit);
    return value & ~(1 << bit);
  }

  static moveValueTowards(value: number, target: number, delta: number): number {
    if (value < target) {
      value += delta;
      return value > target ? target : value;
    }
    if (value > target) {
      value -= delta;
      return value < target ? target : value;
    }
    return value;
  }

  static snap(value: number, target: number, epsilon: number): number {
    if (value > target - epsilon && value < target + epsilon) return target;
    return value;
  }

  static sign(value: number): number {
    if (value < 0) return -1;
    if (value > 0) return 1;
    return 0;
  }

  static numberSign(value: number, epsilon: number): number {
    if (value < 0) return value < -epsilon ? -1 : 0;
    if (value > 0) return value > epsilon ? 1 : 0;
    return 0;
  }

  static numbersEqual(a: number, b: number, epsilon: number): boolean {
    const d = a - b;
    if (d < 0) return d > -epsilon;
    return d < epsilon;
  }
}
