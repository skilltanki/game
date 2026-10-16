// Port of the original CameraShaker
//
// A decaying random-walk offset applied to the camera position. start() picks
// a random unit direction and full radius; each update() tilts that direction
// by up to maxAngle into a random azimuth around it and shrinks the radius
// along a raised cosine, so the camera jitters hard at first and eases to zero.
//
// Differences from the original: none in the algorithm. The original client
// drove it from the (removed) network/battle layer, so the game layer here
// decides WHEN to shake — see the callers in main.ts.

import { Vector3 } from '../math/Vector3';

export class CameraShaker {
  /** Largest tilt applied to the direction per step (original: PI/2). */
  private maxAngle = Math.PI / 2;
  private direction = new Vector3();
  private maxTime = 500;
  private time = 0;
  private maxRadius = 50;
  private radius = 0;
  /** Orthonormal basis around `direction`, rebuilt whenever it changes. */
  private e1 = new Vector3();
  private e2 = new Vector3();

  setMaxTime(value: number): void {
    this.maxTime = value;
  }

  /** Shake strength in sim units (original maxRadius = 50). */
  setMaxRadius(value: number): void {
    this.maxRadius = value;
  }

  start(): void {
    this.time = this.maxTime;
    this.radius = this.maxRadius;
    this.direction.reset(1 - 2 * Math.random(), 1 - 2 * Math.random(), 1 - 2 * Math.random()).normalize();
    this.calculateBasisVectors();
  }

  isActive(): boolean {
    return this.time > 0;
  }

  /** out = base position displaced by the current shake offset. */
  getCameraPosition(base: Vector3, out: Vector3): void {
    out.copy(base);
    if (this.time > 0) {
      out.addScaled(this.radius, this.direction);
    }
  }

  update(dtMs: number): void {
    if (this.time > 0) {
      this.time -= dtMs;
      if (this.time > 0) {
        this.calculateNewDirection();
        this.calculateBasisVectors();
        this.calculateRadius(this.time);
      }
    }
  }

  /** Raised cosine: full radius at the start, 0 at the end. */
  private calculateRadius(time: number): void {
    const cos = Math.cos((Math.PI * (this.maxTime - time)) / this.maxTime);
    this.radius = this.maxRadius * 0.5 * (1 + cos);
  }

  /** Tilt `direction` by a random polar angle into a random azimuth. */
  private calculateNewDirection(): void {
    let angle = this.maxAngle * Math.random();
    const cosPolar = -Math.cos(angle);
    const sinPolar = Math.sin(angle);
    angle = 2 * Math.PI * Math.random();
    const a1 = sinPolar * Math.cos(angle);
    const a2 = sinPolar * Math.sin(angle);
    const x = cosPolar * this.direction.x + a1 * this.e1.x + a2 * this.e2.x;
    const y = cosPolar * this.direction.y + a1 * this.e1.y + a2 * this.e2.y;
    const z = cosPolar * this.direction.z + a1 * this.e1.z + a2 * this.e2.z;
    this.direction.reset(x, y, z).normalize();
  }

  /** Basis perpendicular to `direction`, built off its largest component. */
  private calculateBasisVectors(): void {
    let axis = 0;
    let max = this.direction.x < 0 ? -this.direction.x : this.direction.x;
    let value = this.direction.y < 0 ? -this.direction.y : this.direction.y;
    if (value > max) {
      max = value;
      axis = 1;
    }
    value = this.direction.z < 0 ? -this.direction.z : this.direction.z;
    if (value > max) {
      axis = 2;
    }
    switch (axis) {
      case 0:
        this.e1.x = 0;
        this.e1.y = this.direction.z;
        this.e1.z = -this.direction.y;
        break;
      case 1:
        this.e1.x = -this.direction.z;
        this.e1.y = 0;
        this.e1.z = this.direction.x;
        break;
      default:
        this.e1.x = this.direction.y;
        this.e1.y = -this.direction.x;
        this.e1.z = 0;
    }
    this.e1.normalize();
    this.e2.cross2(this.direction, this.e1);
  }
}
