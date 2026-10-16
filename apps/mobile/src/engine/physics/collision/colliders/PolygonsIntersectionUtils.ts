// Port of the original PolygonsIntersectionUtils
// (the original's Point replaced by a tiny local Point class)
import { Matrix4 } from '../../../math/Matrix4';
import { Vector3 } from '../../../math/Vector3';
import { ShapeContact } from '../../ShapeContact';
import type { CollisionShape } from '../CollisionShape';
import type { Vertex } from './Vertex';

class Point {
  x = 0;
  y = 0;
}

function makePoints(): Point[] {
  return Array.from({ length: 8 }, () => new Point());
}

export class PolygonsIntersectionUtils {
  private static readonly projectedPoints1 = makePoints();
  private static readonly projectedPoints2 = makePoints();
  private static readonly intersection = makePoints();
  private static points1 = makePoints();
  private static points2 = makePoints();
  private static readonly point = new Point();
  private static readonly normal1 = new Vector3();
  private static readonly normal2 = new Vector3();

  static findContacts(
    shape1: CollisionShape, face1: Vertex[], count1: number,
    shape2: CollisionShape, face2: Vertex[], count2: number,
    basis: Matrix4, contacts: ShapeContact[],
  ): void {
    const { projectedPoints1, projectedPoints2, intersection, normal1, normal2 } = PolygonsIntersectionUtils;
    PolygonsIntersectionUtils.calculateFaceNormal(face1, normal1);
    PolygonsIntersectionUtils.calculateFaceNormal(face2, normal2);
    PolygonsIntersectionUtils.fillProjectedPoints(face1, count1, projectedPoints1);
    PolygonsIntersectionUtils.fillProjectedPoints(face2, count2, projectedPoints2);
    const numPoints = PolygonsIntersectionUtils.findPolygonsIntersection(projectedPoints1, count1, projectedPoints2, count2, intersection);
    for (let i = 0; i < numPoints; i++) {
      const p = intersection[i];
      const z1 = PolygonsIntersectionUtils.getFaceZ(p, face1[0].transformed, normal1);
      const z2 = PolygonsIntersectionUtils.getFaceZ(p, face2[0].transformed, normal2);
      if (z2 > z1) {
        const contact = ShapeContact.create();
        contact.shape1 = shape1;
        contact.shape2 = shape2;
        const pos = contact.position;
        pos.x = p.x;
        pos.y = p.y;
        pos.z = 0.5 * (z1 + z2);
        pos.transform4(basis);
        contact.penetration = z2 - z1;
        contact.normal.x = basis.m02;
        contact.normal.y = basis.m12;
        contact.normal.z = basis.m22;
        contacts.push(contact);
      }
    }
  }

  private static calculateFaceNormal(face: Vertex[], out: Vector3): void {
    const a = face[0].transformed;
    const b = face[1].transformed;
    const c = face[2].transformed;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    out.x = aby * acz - abz * acy;
    out.y = abz * acx - abx * acz;
    out.z = abx * acy - aby * acx;
    out.normalize();
  }

  private static fillProjectedPoints(face: Vertex[], count: number, out: Point[]): void {
    for (let i = 0; i < count; i++) {
      const v = face[i];
      const p = out[i];
      p.x = v.transformed.x;
      p.y = v.transformed.y;
    }
  }

  private static findPolygonsIntersection(poly1: Point[], count1: number, poly2: Point[], count2: number, out: Point[]): number {
    PolygonsIntersectionUtils.copyPoints(poly2, PolygonsIntersectionUtils.points1, count2);
    let numPoints = count2;
    let prev = poly1[count1 - 1];
    for (let i = 0; i < count1; i++) {
      const current = poly1[i];
      numPoints = PolygonsIntersectionUtils.clip(prev, current, PolygonsIntersectionUtils.points1, PolygonsIntersectionUtils.points2, numPoints);
      if (numPoints === 0) {
        break;
      }
      prev = current;
      const t = PolygonsIntersectionUtils.points1;
      PolygonsIntersectionUtils.points1 = PolygonsIntersectionUtils.points2;
      PolygonsIntersectionUtils.points2 = t;
    }
    PolygonsIntersectionUtils.copyPoints(PolygonsIntersectionUtils.points1, out, numPoints);
    return numPoints;
  }

  private static copyPoints(src: Point[], dst: Point[], count: number): void {
    for (let i = 0; i < count; i++) {
      const a = src[i];
      const b = dst[i];
      b.x = a.x;
      b.y = a.y;
    }
  }

  private static clip(edgeA: Point, edgeB: Point, src: Point[], dst: Point[], count: number): number {
    let prev = src[count - 1];
    let prevInside = PolygonsIntersectionUtils.arePointsCCW(edgeA, edgeB, prev);
    let numOut = 0;
    for (let i = 0; i < count; i++) {
      const current = src[i];
      const inside = PolygonsIntersectionUtils.arePointsCCW(edgeA, edgeB, current);
      if (inside) {
        if (!prevInside) {
          PolygonsIntersectionUtils.calculateIntersection(edgeA, edgeB, prev, current, PolygonsIntersectionUtils.point);
          PolygonsIntersectionUtils.setPoint(PolygonsIntersectionUtils.point, dst, numOut++);
        }
        PolygonsIntersectionUtils.setPoint(current, dst, numOut++);
      } else if (prevInside) {
        PolygonsIntersectionUtils.calculateIntersection(edgeA, edgeB, prev, current, PolygonsIntersectionUtils.point);
        PolygonsIntersectionUtils.setPoint(PolygonsIntersectionUtils.point, dst, numOut++);
      }
      prevInside = inside;
      prev = current;
    }
    return numOut;
  }

  private static setPoint(p: Point, points: Point[], index: number): void {
    const target = points[index];
    target.x = p.x;
    target.y = p.y;
  }

  private static arePointsCCW(a: Point, b: Point, c: Point): boolean {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    return abx * acy - aby * acx > 0;
  }

  private static calculateIntersection(a: Point, b: Point, c: Point, d: Point, out: Point): void {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const cdx = d.x - c.x;
    const cdy = d.y - c.y;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const t = (abx * acy - aby * acx) / (aby * cdx - abx * cdy);
    out.x = c.x + t * cdx;
    out.y = c.y + t * cdy;
  }

  private static getFaceZ(p: Point, vertex: Vector3, normal: Vector3): number {
    const d = vertex.dot(normal);
    return (d - p.x * normal.x - p.y * normal.y) / normal.z;
  }
}
