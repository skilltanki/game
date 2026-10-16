// Port of the original Vertex
import { Vector3 } from '../../../math/Vector3';

export class Vertex {
  readonly local = new Vector3();
  readonly global = new Vector3();
  readonly transformed = new Vector3();
}
