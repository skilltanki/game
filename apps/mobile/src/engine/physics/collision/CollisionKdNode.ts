// Port of the original CollisionKdNode.
// The original kept plane-coincident primitives in a secondary CollisionKdTree2D
// (`splitTree`); this port keeps them in `splitIndices` and queries scan that list
// directly — same results, one less tree.
import type { AABB } from './types/AABB';

export class CollisionKdNode {
  indices: number[] | null = null;
  splitIndices: number[] | null = null;
  boundBox: AABB | null = null;
  parent: CollisionKdNode | null = null;
  axis = -1;
  coord = 0;
  positiveNode: CollisionKdNode | null = null;
  negativeNode: CollisionKdNode | null = null;

  destroy(): void {
    if (this.positiveNode) {
      this.positiveNode.destroy();
      this.positiveNode = null;
    }
    if (this.negativeNode) {
      this.negativeNode.destroy();
      this.negativeNode = null;
    }
    this.parent = null;
    this.boundBox = null;
    this.indices = null;
    this.splitIndices = null;
  }
}
