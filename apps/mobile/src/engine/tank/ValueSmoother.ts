// Ports of ValueSmoother (interface) and SimpleValueSmoother
// (EncryptedValueSmoother differs only in anti-cheat value storage)
export interface ValueSmoother {
  reset(value: number): void;
  update(dt: number): number;
  setTargetValue(value: number): void;
  getTargetValue(): number;
}

export class SimpleValueSmoother implements ValueSmoother {
  private currentValue: number;
  private targetValue: number;
  private smoothingSpeedUp: number;
  private smoothingSpeedDown: number;

  constructor(smoothingSpeedUp: number, smoothingSpeedDown: number, targetValue: number, currentValue: number) {
    this.smoothingSpeedUp = smoothingSpeedUp;
    this.smoothingSpeedDown = smoothingSpeedDown;
    this.targetValue = targetValue;
    this.currentValue = currentValue;
  }

  reset(value: number): void {
    this.currentValue = value;
    this.targetValue = value;
  }

  update(dt: number): number {
    if (this.currentValue < this.targetValue) {
      this.currentValue += this.smoothingSpeedUp * dt;
      if (this.currentValue > this.targetValue) {
        this.currentValue = this.targetValue;
      }
    } else if (this.currentValue > this.targetValue) {
      this.currentValue -= this.smoothingSpeedDown * dt;
      if (this.currentValue < this.targetValue) {
        this.currentValue = this.targetValue;
      }
    }
    return this.currentValue;
  }

  setTargetValue(value: number): void {
    this.targetValue = value;
  }

  getTargetValue(): number {
    return this.targetValue;
  }
}
