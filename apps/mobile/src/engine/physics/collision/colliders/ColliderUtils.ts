// Port of the original ColliderUtils
import { Matrix4 } from '../../../math/Matrix4';
import { Vector3 } from '../../../math/Vector3';
import { FaceSide } from './FaceSide';
import { Vertex } from './Vertex';
import type { CollisionBox } from '../primitives/CollisionBox';
import type { CollisionRect } from '../primitives/CollisionRect';
import type { CollisionTriangle } from '../primitives/CollisionTriangle';

export class ColliderUtils {
  private static readonly _basisAxisX = new Vector3();
  private static readonly _basisAxisY = new Vector3();

  static buildContactBasis(normal: Vector3, _m1: Matrix4, _m2: Matrix4, outBasis: Matrix4): void {
    const axisX = ColliderUtils._basisAxisX;
    const axisY = ColliderUtils._basisAxisY;
    if (Math.abs(normal.x) < Math.abs(normal.y)) {
      axisX.x = 0;
      axisX.y = normal.z;
      axisX.z = -normal.y;
    } else {
      axisX.x = -normal.z;
      axisX.y = 0;
      axisX.z = normal.x;
    }
    axisX.normalize();
    axisY.x = normal.y * axisX.z - normal.z * axisX.y;
    axisY.y = normal.z * axisX.x - normal.x * axisX.z;
    axisY.z = normal.x * axisX.y - normal.y * axisX.x;
    outBasis.m00 = axisX.x;
    outBasis.m10 = axisX.y;
    outBasis.m20 = axisX.z;
    outBasis.m01 = axisY.x;
    outBasis.m11 = axisY.y;
    outBasis.m21 = axisY.z;
    outBasis.m02 = normal.x;
    outBasis.m12 = normal.y;
    outBasis.m22 = normal.z;
  }

  static transformFaceToReferenceSpace(referenceTransform: Matrix4, faceTransform: Matrix4, vertices: Vertex[], count: number): void {
    for (let i = 0; i < count; i++) {
      const v = vertices[i];
      faceTransform.transformVector(v.local, v.global);
      referenceTransform.transformVectorInverse(v.global, v.transformed);
    }
  }

  static getBoxFaceVerticesInCCWOrder(box: CollisionBox, direction: Vector3, side: FaceSide, out: Vertex[]): void {
    const m = box.transform;
    let axis = 0;
    let dot = m.m00 * direction.x + m.m10 * direction.y + m.m20 * direction.z;
    let maxAbs = Math.abs(dot);
    let d = m.m01 * direction.x + m.m11 * direction.y + m.m21 * direction.z;
    let abs = Math.abs(d);
    if (abs > maxAbs) {
      maxAbs = abs;
      dot = d;
      axis = 1;
    }
    d = m.m02 * direction.x + m.m12 * direction.y + m.m22 * direction.z;
    abs = Math.abs(d);
    if (abs > maxAbs) {
      dot = d;
      axis = 2;
    }
    let sign = dot > 0 ? 1 : -1;
    if (side === FaceSide.BACK) {
      sign = -sign;
    }
    const hs = box.hs;
    let v: Vector3;
    switch (axis) {
      case 0:
        v = out[0].local;
        v.x = sign * hs.x; v.y = hs.y; v.z = hs.z;
        v = out[1].local;
        v.x = sign * hs.x; v.y = -hs.y; v.z = hs.z;
        v = out[2].local;
        v.x = sign * hs.x; v.y = -hs.y; v.z = -hs.z;
        v = out[3].local;
        v.x = sign * hs.x; v.y = hs.y; v.z = -hs.z;
        break;
      case 1:
        v = out[0].local;
        v.x = hs.x; v.y = sign * hs.y; v.z = hs.z;
        v = out[1].local;
        v.x = hs.x; v.y = sign * hs.y; v.z = -hs.z;
        v = out[2].local;
        v.x = -hs.x; v.y = sign * hs.y; v.z = -hs.z;
        v = out[3].local;
        v.x = -hs.x; v.y = sign * hs.y; v.z = hs.z;
        break;
      case 2:
        v = out[0].local;
        v.x = hs.x; v.y = hs.y; v.z = sign * hs.z;
        v = out[1].local;
        v.x = -hs.x; v.y = hs.y; v.z = sign * hs.z;
        v = out[2].local;
        v.x = -hs.x; v.y = -hs.y; v.z = sign * hs.z;
        v = out[3].local;
        v.x = hs.x; v.y = -hs.y; v.z = sign * hs.z;
        break;
      default:
        throw new Error();
    }
    if (dot < 0) {
      let t = out[0];
      out[0] = out[3];
      out[3] = t;
      t = out[1];
      out[1] = out[2];
      out[2] = t;
    }
  }

  static getRectFaceInCCWOrder(rect: CollisionRect, direction: Vector3, out: Vertex[]): void {
    const hs = rect.hs;
    let v = out[0];
    v.local.x = hs.x;
    v.local.y = hs.y;
    v.local.z = 0;
    v = out[1];
    v.local.x = -hs.x;
    v.local.y = hs.y;
    v.local.z = 0;
    v = out[2];
    v.local.x = -hs.x;
    v.local.y = -hs.y;
    v.local.z = 0;
    v = out[3];
    v.local.x = hs.x;
    v.local.y = -hs.y;
    v.local.z = 0;
    const m = rect.transform;
    const dot = direction.x * m.m02 + direction.y * m.m12 + direction.z * m.m22;
    if (dot < 0) {
      v = out[0];
      out[0] = out[3];
      out[3] = v;
      v = out[1];
      out[1] = out[2];
      out[2] = v;
    }
  }

  static getTriangleFaceInCCWOrder(triangle: CollisionTriangle, direction: Vector3, out: Vertex[]): void {
    let v = out[0];
    v.local.x = triangle.v0.x;
    v.local.y = triangle.v0.y;
    v.local.z = 0;
    v = out[1];
    v.local.x = triangle.v1.x;
    v.local.y = triangle.v1.y;
    v.local.z = 0;
    v = out[2];
    v.local.x = triangle.v2.x;
    v.local.y = triangle.v2.y;
    v.local.z = 0;
    const m = triangle.transform;
    const dot = direction.x * m.m02 + direction.y * m.m12 + direction.z * m.m22;
    if (dot < 0) {
      v = out[0];
      out[0] = out[2];
      out[2] = v;
    }
  }
}
