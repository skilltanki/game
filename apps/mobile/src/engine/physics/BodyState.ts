// Port of the original BodyState
import { Vector3 } from '../math/Vector3';
import { Quaternion } from '../math/Quaternion';

export class BodyState {
  velocity = new Vector3();
  orientation = new Quaternion();
  angularVelocity = new Vector3();
  position = new Vector3();

  copy(other: BodyState): void {
    this.position.copy(other.position);
    this.orientation.copy(other.orientation);
    this.velocity.copy(other.velocity);
    this.angularVelocity.copy(other.angularVelocity);
  }

  isValid(): boolean {
    return (
      this.velocity.isFiniteVector() &&
      this.angularVelocity.isFiniteVector() &&
      this.position.isFiniteVector() &&
      this.orientation.isFiniteQuaternion()
    );
  }
}
