// Port of the original BoxTriangleCollider
import { Matrix4 } from '../../../math/Matrix4';
import { Vector3 } from '../../../math/Vector3';
import { ShapeContact } from '../../ShapeContact';
import { CollisionBox } from '../primitives/CollisionBox';
import { CollisionTriangle } from '../primitives/CollisionTriangle';
import { ColliderUtils } from './ColliderUtils';
import { FaceSide } from './FaceSide';
import { PolygonsIntersectionUtils } from './PolygonsIntersectionUtils';
import { Vertex } from './Vertex';
import type { Collider } from '../filters';
import type { CollisionShape } from '../CollisionShape';

export class BoxTriangleCollider implements Collider {
  epsilon: number;

  private minOverlap = 0;
  private readonly toBox = new Vector3();
  private readonly axis = new Vector3();
  private readonly axis10 = new Vector3();
  private readonly axis11 = new Vector3();
  private readonly axis12 = new Vector3();
  private readonly axis20 = new Vector3();
  private readonly axis21 = new Vector3();
  private readonly axis22 = new Vector3();
  private readonly minOverlapAxis = new Vector3();
  private readonly _basisMatrix = new Matrix4();
  private readonly boxFaceVertices = [new Vertex(), new Vertex(), new Vertex(), new Vertex()];
  private readonly triFaceVertices = [new Vertex(), new Vertex(), new Vertex()];

  constructor(epsilon: number) {
    this.epsilon = epsilon;
  }

  getContacts(shape1: CollisionShape, shape2: CollisionShape, contacts: ShapeContact[]): void {
    if (!this.haveCollision(shape1, shape2)) {
      return;
    }
    let box: CollisionBox;
    let triangle: CollisionTriangle;
    if (shape1 instanceof CollisionBox) {
      box = shape1;
      triangle = shape2 as CollisionTriangle;
    } else {
      box = shape2 as CollisionBox;
      triangle = shape1 as CollisionTriangle;
    }
    this.findContacts(box, triangle, this.minOverlapAxis, contacts);
  }

  haveCollision(shape1: CollisionShape, shape2: CollisionShape): boolean {
    let box: CollisionBox;
    let triangle: CollisionTriangle;
    if (shape1 instanceof CollisionBox) {
      box = shape1;
      triangle = shape2 as CollisionTriangle;
    } else {
      box = shape2 as CollisionBox;
      triangle = shape1 as CollisionTriangle;
    }
    const mBox = box.transform;
    const mTri = triangle.transform;
    this.toBox.x = mBox.m03 - mTri.m03;
    this.toBox.y = mBox.m13 - mTri.m13;
    this.toBox.z = mBox.m23 - mTri.m23;
    this.minOverlap = 10000000000;
    this.axis.x = mTri.m02;
    this.axis.y = mTri.m12;
    this.axis.z = mTri.m22;
    if (!this.testOverlapOnMainAxis(box, triangle, this.axis, this.toBox)) return false;
    this.axis10.x = mBox.m00;
    this.axis10.y = mBox.m10;
    this.axis10.z = mBox.m20;
    if (!this.testOverlapOnMainAxis(box, triangle, this.axis10, this.toBox)) return false;
    this.axis11.x = mBox.m01;
    this.axis11.y = mBox.m11;
    this.axis11.z = mBox.m21;
    if (!this.testOverlapOnMainAxis(box, triangle, this.axis11, this.toBox)) return false;
    this.axis12.x = mBox.m02;
    this.axis12.y = mBox.m12;
    this.axis12.z = mBox.m22;
    if (!this.testOverlapOnMainAxis(box, triangle, this.axis12, this.toBox)) return false;
    let edge = triangle.e0;
    this.axis20.x = mTri.m00 * edge.x + mTri.m01 * edge.y + mTri.m02 * edge.z;
    this.axis20.y = mTri.m10 * edge.x + mTri.m11 * edge.y + mTri.m12 * edge.z;
    this.axis20.z = mTri.m20 * edge.x + mTri.m21 * edge.y + mTri.m22 * edge.z;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis10, this.axis20, this.toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis11, this.axis20, this.toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis12, this.axis20, this.toBox)) return false;
    edge = triangle.e1;
    this.axis21.x = mTri.m00 * edge.x + mTri.m01 * edge.y + mTri.m02 * edge.z;
    this.axis21.y = mTri.m10 * edge.x + mTri.m11 * edge.y + mTri.m12 * edge.z;
    this.axis21.z = mTri.m20 * edge.x + mTri.m21 * edge.y + mTri.m22 * edge.z;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis10, this.axis21, this.toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis11, this.axis21, this.toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis12, this.axis21, this.toBox)) return false;
    edge = triangle.e2;
    this.axis22.x = mTri.m00 * edge.x + mTri.m01 * edge.y + mTri.m02 * edge.z;
    this.axis22.y = mTri.m10 * edge.x + mTri.m11 * edge.y + mTri.m12 * edge.z;
    this.axis22.z = mTri.m20 * edge.x + mTri.m21 * edge.y + mTri.m22 * edge.z;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis10, this.axis22, this.toBox)) return false;
    if (!this.testOverlapOnDerivedAxis(box, triangle, this.axis11, this.axis22, this.toBox)) return false;
    return this.testOverlapOnDerivedAxis(box, triangle, this.axis12, this.axis22, this.toBox);
  }

  private testOverlapOnMainAxis(box: CollisionBox, triangle: CollisionTriangle, axis: Vector3, toBox: Vector3): boolean {
    return this.registerOverlap(this.getOverlapOnAxis(box, triangle, axis, toBox), axis);
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

  private testOverlapOnDerivedAxis(box: CollisionBox, triangle: CollisionTriangle, axis1: Vector3, axis2: Vector3, toBox: Vector3): boolean {
    this.axis.x = axis1.y * axis2.z - axis1.z * axis2.y;
    this.axis.y = axis1.z * axis2.x - axis1.x * axis2.z;
    this.axis.z = axis1.x * axis2.y - axis1.y * axis2.x;
    const lengthSqr = this.axis.x * this.axis.x + this.axis.y * this.axis.y + this.axis.z * this.axis.z;
    if (lengthSqr < 1e-10) {
      return true;
    }
    const k = 1 / Math.sqrt(lengthSqr);
    this.axis.x *= k;
    this.axis.y *= k;
    this.axis.z *= k;
    return this.registerOverlap(this.getOverlapOnAxis(box, triangle, this.axis, toBox), this.axis);
  }

  private getOverlapOnAxis(box: CollisionBox, triangle: CollisionTriangle, axis: Vector3, toBox: Vector3): number {
    const mBox = box.transform;
    const hs = box.hs;
    let boxProjection = 0;
    let proj = (mBox.m00 * axis.x + mBox.m10 * axis.y + mBox.m20 * axis.z) * hs.x;
    boxProjection += proj < 0 ? -proj : proj;
    proj = (mBox.m01 * axis.x + mBox.m11 * axis.y + mBox.m21 * axis.z) * hs.y;
    boxProjection += proj < 0 ? -proj : proj;
    proj = (mBox.m02 * axis.x + mBox.m12 * axis.y + mBox.m22 * axis.z) * hs.z;
    boxProjection += proj < 0 ? -proj : proj;
    let distance = toBox.x * axis.x + toBox.y * axis.y + toBox.z * axis.z;
    const mTri = triangle.transform;
    const localAxisX = mTri.m00 * axis.x + mTri.m10 * axis.y + mTri.m20 * axis.z;
    const localAxisY = mTri.m01 * axis.x + mTri.m11 * axis.y + mTri.m21 * axis.z;
    const localAxisZ = mTri.m02 * axis.x + mTri.m12 * axis.y + mTri.m22 * axis.z;
    let triProjection = 0;
    const v0 = triangle.v0;
    const v1 = triangle.v1;
    const v2 = triangle.v2;
    if (distance < 0) {
      distance = -distance;
      proj = v0.x * localAxisX + v0.y * localAxisY + v0.z * localAxisZ;
      if (proj < triProjection) triProjection = proj;
      proj = v1.x * localAxisX + v1.y * localAxisY + v1.z * localAxisZ;
      if (proj < triProjection) triProjection = proj;
      proj = v2.x * localAxisX + v2.y * localAxisY + v2.z * localAxisZ;
      if (proj < triProjection) triProjection = proj;
      triProjection = -triProjection;
    } else {
      proj = v0.x * localAxisX + v0.y * localAxisY + v0.z * localAxisZ;
      if (proj > triProjection) triProjection = proj;
      proj = v1.x * localAxisX + v1.y * localAxisY + v1.z * localAxisZ;
      if (proj > triProjection) triProjection = proj;
      proj = v2.x * localAxisX + v2.y * localAxisY + v2.z * localAxisZ;
      if (proj > triProjection) triProjection = proj;
    }
    return boxProjection + triProjection - distance;
  }

  private findContacts(box: CollisionBox, triangle: CollisionTriangle, axis: Vector3, contacts: ShapeContact[]): void {
    const mBox = box.transform;
    const mTri = triangle.transform;
    const toBox = this.toBox;
    toBox.x = mBox.m03 - mTri.m03;
    toBox.y = mBox.m13 - mTri.m13;
    toBox.z = mBox.m23 - mTri.m23;
    if (axis.x * toBox.x + axis.y * toBox.y + axis.z * toBox.z < 0) {
      axis.x = -axis.x;
      axis.y = -axis.y;
      axis.z = -axis.z;
    }
    const basis = this._basisMatrix;
    ColliderUtils.buildContactBasis(axis, mBox, mTri, basis);
    ColliderUtils.getBoxFaceVerticesInCCWOrder(box, axis, FaceSide.BACK, this.boxFaceVertices);
    ColliderUtils.getTriangleFaceInCCWOrder(triangle, axis, this.triFaceVertices);
    ColliderUtils.transformFaceToReferenceSpace(basis, mBox, this.boxFaceVertices, 4);
    ColliderUtils.transformFaceToReferenceSpace(basis, mTri, this.triFaceVertices, 3);
    const firstIndex = contacts.length;
    PolygonsIntersectionUtils.findContacts(box, this.boxFaceVertices, 4, triangle, this.triFaceVertices, 3, basis, contacts);
    let lastIndex = contacts.length;
    for (let i = firstIndex; i < lastIndex; i++) {
      const contact = contacts[i];
      const normal = contact.normal;
      if (normal.x * mTri.m02 + normal.y * mTri.m12 + normal.z * mTri.m22 < 0) {
        contact.dispose();
        lastIndex--;
        contacts[i] = contacts[lastIndex];
        contacts[lastIndex] = null!;
        i--;
      }
    }
    if (lastIndex < contacts.length) {
      contacts.length = lastIndex;
    }
  }
}
