// Port of the original BoxRectCollider
import { Matrix4 } from '../../../math/Matrix4';
import { Vector3 } from '../../../math/Vector3';
import { ShapeContact } from '../../ShapeContact';
import { CollisionBox } from '../primitives/CollisionBox';
import { CollisionRect } from '../primitives/CollisionRect';
import { ColliderUtils } from './ColliderUtils';
import { FaceSide } from './FaceSide';
import { PolygonsIntersectionUtils } from './PolygonsIntersectionUtils';
import { Vertex } from './Vertex';
import type { Collider } from '../filters';
import type { CollisionShape } from '../CollisionShape';

export class BoxRectCollider implements Collider {
  private static readonly boxFaceVertices = [new Vertex(), new Vertex(), new Vertex(), new Vertex()];
  private static readonly rectFaceVertices = [new Vertex(), new Vertex(), new Vertex(), new Vertex()];
  private static readonly _basisMatrix = new Matrix4();

  private readonly _vectorToBox = new Vector3();
  private readonly _axis = new Vector3();
  private readonly axis10 = new Vector3();
  private readonly axis11 = new Vector3();
  private readonly axis12 = new Vector3();
  private readonly axis20 = new Vector3();
  private readonly axis21 = new Vector3();
  private readonly axis22 = new Vector3();
  private readonly minOverlapAxis = new Vector3();
  private minOverlap = 0;
  private epsilon: number;

  constructor(epsilon: number) {
    this.epsilon = epsilon;
  }

  getContacts(shape1: CollisionShape, shape2: CollisionShape, contacts: ShapeContact[]): void {
    if (this.haveCollision(shape1, shape2)) {
      let rect: CollisionRect;
      let box: CollisionBox;
      if (shape1 instanceof CollisionRect) {
        rect = shape1;
        box = shape2 as CollisionBox;
      } else {
        rect = shape2 as CollisionRect;
        box = shape1 as CollisionBox;
      }
      this.findContacts(box, rect, this.minOverlapAxis, contacts);
    }
  }

  haveCollision(shape1: CollisionShape, shape2: CollisionShape): boolean {
    this.minOverlap = 10000000000;
    let box: CollisionBox;
    let rect: CollisionRect;
    if (shape1 instanceof CollisionBox) {
      box = shape1;
      rect = shape2 as CollisionRect;
    } else {
      box = shape2 as CollisionBox;
      rect = shape1 as CollisionRect;
    }
    const mBox = box.transform;
    const mRect = rect.transform;
    this._vectorToBox.x = mBox.m03 - mRect.m03;
    this._vectorToBox.y = mBox.m13 - mRect.m13;
    this._vectorToBox.z = mBox.m23 - mRect.m23;
    this.axis22.x = mRect.m02;
    this.axis22.y = mRect.m12;
    this.axis22.z = mRect.m22;
    if (!this.testMainAxis(box, rect, this.axis22, this._vectorToBox)) return false;
    this.axis10.x = mBox.m00;
    this.axis10.y = mBox.m10;
    this.axis10.z = mBox.m20;
    if (!this.testMainAxis(box, rect, this.axis10, this._vectorToBox)) return false;
    this.axis11.x = mBox.m01;
    this.axis11.y = mBox.m11;
    this.axis11.z = mBox.m21;
    if (!this.testMainAxis(box, rect, this.axis11, this._vectorToBox)) return false;
    this.axis12.x = mBox.m02;
    this.axis12.y = mBox.m12;
    this.axis12.z = mBox.m22;
    if (!this.testMainAxis(box, rect, this.axis12, this._vectorToBox)) return false;
    this.axis20.x = mRect.m00;
    this.axis20.y = mRect.m10;
    this.axis20.z = mRect.m20;
    this.axis21.x = mRect.m01;
    this.axis21.y = mRect.m11;
    this.axis21.z = mRect.m21;
    if (!this.testDerivedAxis(box, rect, this.axis10, this.axis20, this._vectorToBox)) return false;
    if (!this.testDerivedAxis(box, rect, this.axis10, this.axis21, this._vectorToBox)) return false;
    if (!this.testDerivedAxis(box, rect, this.axis11, this.axis20, this._vectorToBox)) return false;
    if (!this.testDerivedAxis(box, rect, this.axis11, this.axis21, this._vectorToBox)) return false;
    if (!this.testDerivedAxis(box, rect, this.axis12, this.axis20, this._vectorToBox)) return false;
    if (!this.testDerivedAxis(box, rect, this.axis12, this.axis21, this._vectorToBox)) return false;
    return true;
  }

  private testMainAxis(box: CollisionBox, rect: CollisionRect, axis: Vector3, toBox: Vector3): boolean {
    return this.registerOverlap(this.getOverlapOnAxis(box, rect, axis, toBox), axis);
  }

  private testDerivedAxis(box: CollisionBox, rect: CollisionRect, axis1: Vector3, axis2: Vector3, toBox: Vector3): boolean {
    this._axis.x = axis1.y * axis2.z - axis1.z * axis2.y;
    this._axis.y = axis1.z * axis2.x - axis1.x * axis2.z;
    this._axis.z = axis1.x * axis2.y - axis1.y * axis2.x;
    const lengthSqr = this._axis.x * this._axis.x + this._axis.y * this._axis.y + this._axis.z * this._axis.z;
    if (lengthSqr < 1e-10) {
      return true;
    }
    const k = 1 / Math.sqrt(lengthSqr);
    this._axis.x *= k;
    this._axis.y *= k;
    this._axis.z *= k;
    return this.registerOverlap(this.getOverlapOnAxis(box, rect, this._axis, toBox), this._axis);
  }

  private getOverlapOnAxis(box: CollisionBox, rect: CollisionRect, axis: Vector3, toBox: Vector3): number {
    let m = box.transform;
    let proj = (m.m00 * axis.x + m.m10 * axis.y + m.m20 * axis.z) * box.hs.x;
    if (proj < 0) proj = -proj;
    let sum = proj;
    proj = (m.m01 * axis.x + m.m11 * axis.y + m.m21 * axis.z) * box.hs.y;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = (m.m02 * axis.x + m.m12 * axis.y + m.m22 * axis.z) * box.hs.z;
    if (proj < 0) proj = -proj;
    sum += proj;
    m = rect.transform;
    proj = (m.m00 * axis.x + m.m10 * axis.y + m.m20 * axis.z) * rect.hs.x;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = (m.m01 * axis.x + m.m11 * axis.y + m.m21 * axis.z) * rect.hs.y;
    if (proj < 0) proj = -proj;
    sum += proj;
    proj = toBox.x * axis.x + toBox.y * axis.y + toBox.z * axis.z;
    if (proj < 0) proj = -proj;
    return sum - proj;
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

  private findContacts(box: CollisionBox, rect: CollisionRect, axis: Vector3, contacts: ShapeContact[]): void {
    const mBox = box.transform;
    const mRect = rect.transform;
    const toBox = this._vectorToBox;
    toBox.x = mBox.m03 - mRect.m03;
    toBox.y = mBox.m13 - mRect.m13;
    toBox.z = mBox.m23 - mRect.m23;
    if (axis.x * toBox.x + axis.y * toBox.y + axis.z * toBox.z < 0) {
      axis.x = -axis.x;
      axis.y = -axis.y;
      axis.z = -axis.z;
    }
    const basis = BoxRectCollider._basisMatrix;
    ColliderUtils.buildContactBasis(axis, mBox, mRect, basis);
    ColliderUtils.getBoxFaceVerticesInCCWOrder(box, axis, FaceSide.BACK, BoxRectCollider.boxFaceVertices);
    ColliderUtils.getRectFaceInCCWOrder(rect, axis, BoxRectCollider.rectFaceVertices);
    ColliderUtils.transformFaceToReferenceSpace(basis, mBox, BoxRectCollider.boxFaceVertices, 4);
    ColliderUtils.transformFaceToReferenceSpace(basis, mRect, BoxRectCollider.rectFaceVertices, 4);
    const firstIndex = contacts.length;
    PolygonsIntersectionUtils.findContacts(box, BoxRectCollider.boxFaceVertices, 4, rect, BoxRectCollider.rectFaceVertices, 4, basis, contacts);
    let lastIndex = contacts.length;
    for (let i = firstIndex; i < lastIndex; i++) {
      const contact = contacts[i];
      const normal = contact.normal;
      const nx = mRect.m02;
      const ny = mRect.m12;
      const nz = mRect.m22;
      if (normal.x * nx + normal.y * ny + normal.z * nz < 0) {
        contact.dispose();
        lastIndex--;
        contacts[i] = contacts[lastIndex];
        contacts[lastIndex] = null!;
        i--;
      } else if (Math.abs(mRect.m22) > 0.999) {
        normal.x = nx;
        normal.y = ny;
        normal.z = nz;
      }
    }
    if (lastIndex < contacts.length) {
      contacts.length = lastIndex;
    }
  }
}
