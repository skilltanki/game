// Port of the original BoxBoxCollider (SAT + face clipping)
import { Matrix4 } from '../../../math/Matrix4';
import { Vector3 } from '../../../math/Vector3';
import { ShapeContact } from '../../ShapeContact';
import { CollisionBox } from '../primitives/CollisionBox';
import { ColliderUtils } from './ColliderUtils';
import { FaceSide } from './FaceSide';
import { PolygonsIntersectionUtils } from './PolygonsIntersectionUtils';
import { Vertex } from './Vertex';
import type { Collider } from '../filters';
import type { CollisionShape } from '../CollisionShape';

export class BoxBoxCollider implements Collider {
  private static readonly _axis = new Vector3();
  private static readonly _axis10 = new Vector3();
  private static readonly _axis11 = new Vector3();
  private static readonly _axis12 = new Vector3();
  private static readonly _axis20 = new Vector3();
  private static readonly _axis21 = new Vector3();
  private static readonly _axis22 = new Vector3();
  private static readonly _vectorToBox = new Vector3();
  private static readonly faceVertices1 = [new Vertex(), new Vertex(), new Vertex(), new Vertex()];
  private static readonly faceVertices2 = [new Vertex(), new Vertex(), new Vertex(), new Vertex()];
  private static readonly _basisMatrix = new Matrix4();

  private epsilon: number;
  private readonly minOverlapAxis = new Vector3();
  private minOverlap = 0;

  constructor(epsilon: number) {
    this.epsilon = epsilon;
  }

  getContacts(shape1: CollisionShape, shape2: CollisionShape, contacts: ShapeContact[]): void {
    if (this.haveCollision(shape1, shape2)) {
      this.findContacts(shape1 as CollisionBox, shape2 as CollisionBox, this.minOverlapAxis, contacts);
    }
  }

  haveCollision(shape1: CollisionShape, shape2: CollisionShape): boolean {
    this.minOverlap = 10000000000;
    const box1 = shape1 as CollisionBox;
    const box2 = shape2 as CollisionBox;
    const m1 = box1.transform;
    const m2 = box2.transform;
    const toBox = BoxBoxCollider._vectorToBox;
    toBox.x = m1.m03 - m2.m03;
    toBox.y = m1.m13 - m2.m13;
    toBox.z = m1.m23 - m2.m23;
    const { _axis10, _axis11, _axis12, _axis20, _axis21, _axis22 } = BoxBoxCollider;
    _axis10.x = m1.m00;
    _axis10.y = m1.m10;
    _axis10.z = m1.m20;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis10, toBox)) return false;
    _axis11.x = m1.m01;
    _axis11.y = m1.m11;
    _axis11.z = m1.m21;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis11, toBox)) return false;
    _axis12.x = m1.m02;
    _axis12.y = m1.m12;
    _axis12.z = m1.m22;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis12, toBox)) return false;
    _axis20.x = m2.m00;
    _axis20.y = m2.m10;
    _axis20.z = m2.m20;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis20, toBox)) return false;
    _axis21.x = m2.m01;
    _axis21.y = m2.m11;
    _axis21.z = m2.m21;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis21, toBox)) return false;
    _axis22.x = m2.m02;
    _axis22.y = m2.m12;
    _axis22.z = m2.m22;
    if (!this.testOverlapOnMainAxis(box1, box2, _axis22, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis10, _axis20, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis10, _axis21, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis10, _axis22, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis11, _axis20, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis11, _axis21, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis11, _axis22, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis12, _axis20, toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box1, box2, _axis12, _axis21, toBox)) return false;
    return this.testOverlapOnDerivedAxis(box1, box2, _axis12, _axis22, toBox);
  }

  private testOverlapOnMainAxis(box1: CollisionBox, box2: CollisionBox, axis: Vector3, toBox: Vector3): boolean {
    const overlap = this.getOverlapOnAxis(box1, box2, axis, toBox);
    return this.registerOverlap(overlap, axis);
  }

  private testOverlapOnDerivedAxis(box1: CollisionBox, box2: CollisionBox, axis1: Vector3, axis2: Vector3, toBox: Vector3): boolean {
    const axis = BoxBoxCollider._axis;
    axis.x = axis1.y * axis2.z - axis1.z * axis2.y;
    axis.y = axis1.z * axis2.x - axis1.x * axis2.z;
    axis.z = axis1.x * axis2.y - axis1.y * axis2.x;
    const lengthSqr = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
    if (lengthSqr < 1e-10) {
      return true;
    }
    const k = 1 / Math.sqrt(lengthSqr);
    axis.x *= k;
    axis.y *= k;
    axis.z *= k;
    const overlap = this.getOverlapOnAxis(box1, box2, axis, toBox);
    return this.registerOverlap(overlap, axis);
  }

  private registerOverlap(overlap: number, axis: Vector3): boolean {
    if (overlap < this.epsilon) {
      return false;
    }
    if (overlap + this.epsilon < this.minOverlap) {
      this.minOverlap = overlap;
      this.minOverlapAxis.x = axis.x;
      this.minOverlapAxis.y = axis.y;
      this.minOverlapAxis.z = axis.z;
    }
    return true;
  }

  getOverlapOnAxis(box1: CollisionBox, box2: CollisionBox, axis: Vector3, toBox: Vector3): number {
    let m = box1.transform;
    let proj = (m.m00 * axis.x + m.m10 * axis.y + m.m20 * axis.z) * box1.hs.x;
    if (proj < 0) proj = -proj;
    let sum = proj;
    proj = (m.m01 * axis.x + m.m11 * axis.y + m.m21 * axis.z) * box1.hs.y;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = (m.m02 * axis.x + m.m12 * axis.y + m.m22 * axis.z) * box1.hs.z;
    if (proj < 0) proj = -proj;
    sum += proj;
    m = box2.transform;
    proj = (m.m00 * axis.x + m.m10 * axis.y + m.m20 * axis.z) * box2.hs.x;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = (m.m01 * axis.x + m.m11 * axis.y + m.m21 * axis.z) * box2.hs.y;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = (m.m02 * axis.x + m.m12 * axis.y + m.m22 * axis.z) * box2.hs.z;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = toBox.x * axis.x + toBox.y * axis.y + toBox.z * axis.z;
    if (proj < 0) proj = -proj;
    return sum - proj;
  }

  private findContacts(box1: CollisionBox, box2: CollisionBox, axis: Vector3, contacts: ShapeContact[]): void {
    const m1 = box1.transform;
    const m2 = box2.transform;
    const toBox = BoxBoxCollider._vectorToBox;
    toBox.x = m1.m03 - m2.m03;
    toBox.y = m1.m13 - m2.m13;
    toBox.z = m1.m23 - m2.m23;
    if (axis.x * toBox.x + axis.y * toBox.y + axis.z * toBox.z < 0) {
      axis.x = -axis.x;
      axis.y = -axis.y;
      axis.z = -axis.z;
    }
    const basis = BoxBoxCollider._basisMatrix;
    ColliderUtils.buildContactBasis(axis, m1, m2, basis);
    ColliderUtils.getBoxFaceVerticesInCCWOrder(box1, axis, FaceSide.BACK, BoxBoxCollider.faceVertices1);
    ColliderUtils.getBoxFaceVerticesInCCWOrder(box2, axis, FaceSide.FRONT, BoxBoxCollider.faceVertices2);
    ColliderUtils.transformFaceToReferenceSpace(basis, box1.transform, BoxBoxCollider.faceVertices1, 4);
    ColliderUtils.transformFaceToReferenceSpace(basis, box2.transform, BoxBoxCollider.faceVertices2, 4);
    PolygonsIntersectionUtils.findContacts(box1, BoxBoxCollider.faceVertices1, 4, box2, BoxBoxCollider.faceVertices2, 4, basis, contacts);
  }
}
