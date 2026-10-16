// Port of the original CollisionGeometryParser
// (E4X replaced by DOMParser helpers; same primitives, group 255, material (0,1))
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import { PhysicsMaterial } from '../physics/PhysicsMaterial';
import { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import { CollisionRect } from '../physics/collision/primitives/CollisionRect';
import { CollisionTriangle } from '../physics/collision/primitives/CollisionTriangle';
import type { CollisionShape } from '../physics/collision/CollisionShape';
import { childElements, childNumber, firstChild, readVector3 } from './xmlUtils';

const MATERIAL = new PhysicsMaterial(0, 1);
const STATIC_COLLISION_GROUP = 255;

const halfSize = new Vector3();
const position = new Vector3();
const rotation = new Vector3();
const rotationMatrix = new Matrix3();

export class CollisionGeometryParser {
  static parse(mapXml: Document): CollisionShape[] {
    const result: CollisionShape[] = [];
    const geometry = firstChild(mapXml.documentElement, 'collision-geometry');
    if (geometry == null) {
      return result;
    }
    CollisionGeometryParser.parseCollisionPlanes(geometry, result);
    CollisionGeometryParser.parseCollisionBoxes(geometry, result);
    CollisionGeometryParser.parseCollisionTriangles(geometry, result);
    return result;
  }

  private static parseCollisionPlanes(geometry: Element, result: CollisionShape[]): void {
    for (const node of childElements(geometry, 'collision-plane')) {
      halfSize.x = 0.5 * childNumber(node, 'width');
      halfSize.y = 0.5 * childNumber(node, 'length');
      halfSize.z = 0;
      const shape = new CollisionRect(halfSize, STATIC_COLLISION_GROUP, MATERIAL);
      CollisionGeometryParser.setCollisionPrimitiveOrientation(shape, node);
      result.push(shape);
    }
  }

  private static parseCollisionBoxes(geometry: Element, result: CollisionShape[]): void {
    for (const node of childElements(geometry, 'collision-box')) {
      readVector3(node, 'size', halfSize);
      halfSize.scale(0.5);
      const shape = new CollisionBox(halfSize, STATIC_COLLISION_GROUP, MATERIAL);
      CollisionGeometryParser.setCollisionPrimitiveOrientation(shape, node);
      result.push(shape);
    }
  }

  private static parseCollisionTriangles(geometry: Element, result: CollisionShape[]): void {
    const v0 = new Vector3();
    const v1 = new Vector3();
    const v2 = new Vector3();
    for (const node of childElements(geometry, 'collision-triangle')) {
      readVector3(node, 'v0', v0);
      readVector3(node, 'v1', v1);
      readVector3(node, 'v2', v2);
      const shape = new CollisionTriangle(v0, v1, v2, STATIC_COLLISION_GROUP, MATERIAL);
      CollisionGeometryParser.setCollisionPrimitiveOrientation(shape, node);
      result.push(shape);
    }
  }

  private static setCollisionPrimitiveOrientation(shape: CollisionShape, node: Element): void {
    readVector3(node, 'position', position);
    readVector3(node, 'rotation', rotation);
    rotationMatrix.setRotationMatrix(rotation.x, rotation.y, rotation.z);
    shape.transform.setFromMatrix3(rotationMatrix, position);
  }
}
