// Port of the original RayHit
import { Vector3 } from '../../../math/Vector3';
import type { CollisionShape } from '../CollisionShape';

export class RayHit {
  shape: CollisionShape | null = null;
  position = new Vector3();
  normal = new Vector3();
  t = 0;
  staticHit = false;

  copy(other: RayHit): void {
    this.shape = other.shape;
    this.position.copy(other.position);
    this.normal.copy(other.normal);
    this.t = other.t;
    this.staticHit = other.staticHit;
  }

  clear(): void {
    this.shape = null;
  }

  clone(): RayHit {
    const result = new RayHit();
    result.copy(this);
    return result;
  }
}
