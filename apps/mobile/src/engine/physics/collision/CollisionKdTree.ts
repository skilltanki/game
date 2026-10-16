// Port of the original CollisionKdTree (static world geometry index).
// Built once from the full static shape list; never rebuilt.
import { AABB } from './types/AABB';
import { CollisionKdNode } from './CollisionKdNode';
import type { CollisionShape } from './CollisionShape';

export class CollisionKdTree {
  private static readonly nodeBoundBoxThreshold = new AABB();
  private static readonly splitCoordsX: number[] = [];
  private static readonly splitCoordsY: number[] = [];
  private static readonly splitCoordsZ: number[] = [];
  private static readonly _nodeBB: number[] = new Array(6).fill(0);
  private static readonly _bb: number[] = new Array(6).fill(0);

  threshold = 0.1;
  minPrimitivesPerNode = 1;
  rootNode!: CollisionKdNode;
  staticChildren: CollisionShape[] = [];
  numStaticChildren = 0;
  staticBoundBoxes: AABB[] = [];

  private splitAxis = -1;
  private splitCoord = 0;
  private splitCost = 0;

  createTree(shapes: CollisionShape[], boundBox: AABB | null = null): void {
    this.staticChildren = shapes.slice();
    this.numStaticChildren = this.staticChildren.length;
    this.rootNode = new CollisionKdNode();
    this.rootNode.indices = [];
    const rootBox = (this.rootNode.boundBox = boundBox != null ? boundBox : new AABB());
    for (let i = 0; i < this.numStaticChildren; i++) {
      const shape = this.staticChildren[i];
      const shapeBox = (this.staticBoundBoxes[i] = shape.calculateAABB());
      rootBox.addBoundBox(shapeBox);
      this.rootNode.indices[i] = i;
    }
    this.staticBoundBoxes.length = this.numStaticChildren;
    this.splitNode(this.rootNode);
    CollisionKdTree.splitCoordsX.length = 0;
    CollisionKdTree.splitCoordsY.length = 0;
    CollisionKdTree.splitCoordsZ.length = 0;
  }

  private splitNode(node: CollisionKdNode): void {
    const indices = node.indices!;
    const numIndices = indices.length;
    if (numIndices <= this.minPrimitivesPerNode) {
      return;
    }
    const nodeBox = node.boundBox!;
    const boxThreshold = CollisionKdTree.nodeBoundBoxThreshold;
    boxThreshold.minX = nodeBox.minX + this.threshold;
    boxThreshold.minY = nodeBox.minY + this.threshold;
    boxThreshold.minZ = nodeBox.minZ + this.threshold;
    boxThreshold.maxX = nodeBox.maxX - this.threshold;
    boxThreshold.maxY = nodeBox.maxY - this.threshold;
    boxThreshold.maxZ = nodeBox.maxZ - this.threshold;
    const doubleThreshold = this.threshold * 2;
    const { splitCoordsX, splitCoordsY, splitCoordsZ, _nodeBB } = CollisionKdTree;
    let numX = 0;
    let numY = 0;
    let numZ = 0;
    for (let i = 0; i < numIndices; i++) {
      const box = this.staticBoundBoxes[indices[i]];
      if (box.maxX - box.minX <= doubleThreshold) {
        if (box.minX <= boxThreshold.minX) {
          splitCoordsX[numX++] = nodeBox.minX;
        } else if (box.maxX >= boxThreshold.maxX) {
          splitCoordsX[numX++] = nodeBox.maxX;
        } else {
          splitCoordsX[numX++] = (box.minX + box.maxX) * 0.5;
        }
      } else {
        if (box.minX > boxThreshold.minX) {
          splitCoordsX[numX++] = box.minX;
        }
        if (box.maxX < boxThreshold.maxX) {
          splitCoordsX[numX++] = box.maxX;
        }
      }
      if (box.maxY - box.minY <= doubleThreshold) {
        if (box.minY <= boxThreshold.minY) {
          splitCoordsY[numY++] = nodeBox.minY;
        } else if (box.maxY >= boxThreshold.maxY) {
          splitCoordsY[numY++] = nodeBox.maxY;
        } else {
          splitCoordsY[numY++] = (box.minY + box.maxY) * 0.5;
        }
      } else {
        if (box.minY > boxThreshold.minY) {
          splitCoordsY[numY++] = box.minY;
        }
        if (box.maxY < boxThreshold.maxY) {
          splitCoordsY[numY++] = box.maxY;
        }
      }
      if (box.maxZ - box.minZ <= doubleThreshold) {
        if (box.minZ <= boxThreshold.minZ) {
          splitCoordsZ[numZ++] = nodeBox.minZ;
        } else if (box.maxZ >= boxThreshold.maxZ) {
          splitCoordsZ[numZ++] = nodeBox.maxZ;
        } else {
          splitCoordsZ[numZ++] = (box.minZ + box.maxZ) * 0.5;
        }
      } else {
        if (box.minZ > boxThreshold.minZ) {
          splitCoordsZ[numZ++] = box.minZ;
        }
        if (box.maxZ < boxThreshold.maxZ) {
          splitCoordsZ[numZ++] = box.maxZ;
        }
      }
    }
    this.splitAxis = -1;
    this.splitCost = 1e308;
    _nodeBB[0] = nodeBox.minX;
    _nodeBB[1] = nodeBox.minY;
    _nodeBB[2] = nodeBox.minZ;
    _nodeBB[3] = nodeBox.maxX;
    _nodeBB[4] = nodeBox.maxY;
    _nodeBB[5] = nodeBox.maxZ;
    this.checkNodeAxis(node, 0, numX, splitCoordsX, _nodeBB);
    this.checkNodeAxis(node, 1, numY, splitCoordsY, _nodeBB);
    this.checkNodeAxis(node, 2, numZ, splitCoordsZ, _nodeBB);
    if (this.splitAxis < 0) {
      return;
    }
    const isX = this.splitAxis === 0;
    const isY = this.splitAxis === 1;
    node.axis = this.splitAxis;
    node.coord = this.splitCoord;
    node.negativeNode = new CollisionKdNode();
    node.negativeNode.parent = node;
    node.negativeNode.boundBox = nodeBox.clone();
    node.positiveNode = new CollisionKdNode();
    node.positiveNode.parent = node;
    node.positiveNode.boundBox = nodeBox.clone();
    if (isX) {
      node.negativeNode.boundBox.maxX = node.positiveNode.boundBox.minX = this.splitCoord;
    } else if (isY) {
      node.negativeNode.boundBox.maxY = node.positiveNode.boundBox.minY = this.splitCoord;
    } else {
      node.negativeNode.boundBox.maxZ = node.positiveNode.boundBox.minZ = this.splitCoord;
    }
    const minCoord = this.splitCoord - this.threshold;
    const maxCoord = this.splitCoord + this.threshold;
    for (let i = 0; i < numIndices; i++) {
      const box = this.staticBoundBoxes[indices[i]];
      const boxMin = isX ? box.minX : isY ? box.minY : box.minZ;
      const boxMax = isX ? box.maxX : isY ? box.maxY : box.maxZ;
      if (boxMax <= maxCoord) {
        if (boxMin < minCoord) {
          if (node.negativeNode.indices == null) {
            node.negativeNode.indices = [];
          }
          node.negativeNode.indices.push(indices[i]);
          indices[i] = -1;
        } else {
          if (node.splitIndices == null) {
            node.splitIndices = [];
          }
          node.splitIndices.push(indices[i]);
          indices[i] = -1;
        }
      } else if (boxMin >= minCoord) {
        if (node.positiveNode.indices == null) {
          node.positiveNode.indices = [];
        }
        node.positiveNode.indices.push(indices[i]);
        indices[i] = -1;
      }
    }
    let kept = 0;
    for (let i = 0; i < numIndices; i++) {
      if (indices[i] >= 0) {
        indices[kept++] = indices[i];
      }
    }
    if (kept > 0) {
      indices.length = kept;
    } else {
      node.indices = null;
    }
    if (node.negativeNode.indices != null) {
      this.splitNode(node.negativeNode);
    }
    if (node.positiveNode.indices != null) {
      this.splitNode(node.positiveNode);
    }
  }

  private checkNodeAxis(node: CollisionKdNode, axis: number, numCoords: number, coords: number[], nodeBB: number[]): void {
    const { _bb } = CollisionKdTree;
    const axis1 = (axis + 1) % 3;
    const axis2 = (axis + 2) % 3;
    const crossSection = (nodeBB[axis1 + 3] - nodeBB[axis1]) * (nodeBB[axis2 + 3] - nodeBB[axis2]);
    for (let i = 0; i < numCoords; i++) {
      const coord = coords[i];
      if (!isNaN(coord)) {
        const minCoord = coord - this.threshold;
        const maxCoord = coord + this.threshold;
        const negativeVolume = crossSection * (coord - nodeBB[axis]);
        const positiveVolume = crossSection * (nodeBB[axis + 3] - coord);
        let numNegative = 0;
        let numPositive = 0;
        let straddles = false;
        const numIndices = node.indices!.length;
        for (let j = 0; j < numIndices; j++) {
          const box = this.staticBoundBoxes[node.indices![j]];
          _bb[0] = box.minX;
          _bb[1] = box.minY;
          _bb[2] = box.minZ;
          _bb[3] = box.maxX;
          _bb[4] = box.maxY;
          _bb[5] = box.maxZ;
          if (_bb[axis + 3] <= maxCoord) {
            if (_bb[axis] < minCoord) {
              numNegative++;
            }
          } else {
            if (_bb[axis] < minCoord) {
              straddles = true;
              break;
            }
            numPositive++;
          }
        }
        const cost = negativeVolume * numNegative + positiveVolume * numPositive;
        if (!straddles && cost < this.splitCost && numNegative > 0 && numPositive > 0) {
          this.splitAxis = axis;
          this.splitCost = cost;
          this.splitCoord = coord;
        }
        for (let j = i + 1; j < numCoords; j++) {
          if (coords[j] >= coord - this.threshold && coords[j] <= coord + this.threshold) {
            coords[j] = NaN;
          }
        }
      }
    }
  }

  destroyTree(): void {
    if (this.rootNode) {
      this.rootNode.destroy();
      this.rootNode = null!;
    }
    this.staticChildren.length = 0;
    this.staticBoundBoxes.length = 0;
  }
}
