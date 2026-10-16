// Port of the original TanksCollisionDetector.
// Differences vs original: the kd-tree's plane-coincident primitives live in
// node.splitIndices instead of a secondary 2D kd-tree — queries scan that list
// directly (same contacts/hits, minus one micro-optimization).
import { Matrix3 } from '../math/Matrix3';
import { Vector3 } from '../math/Vector3';
import { Body } from '../physics/Body';
import { BodyContact } from '../physics/BodyContact';
import { ShapeContact } from '../physics/ShapeContact';
import { CollisionKdNode } from '../physics/collision/CollisionKdNode';
import { CollisionKdTree } from '../physics/collision/CollisionKdTree';
import { CollisionShape } from '../physics/collision/CollisionShape';
import { BoxBoxCollider } from '../physics/collision/colliders/BoxBoxCollider';
import { BoxRectCollider } from '../physics/collision/colliders/BoxRectCollider';
import { BoxTriangleCollider } from '../physics/collision/colliders/BoxTriangleCollider';
import { AABB } from '../physics/collision/types/AABB';
import { RayHit } from '../physics/collision/types/RayHit';
import type { Collider, IRayCollisionFilter } from '../physics/collision/filters';
import type { CollisionDetector } from '../physics/collision/CollisionDetector';
import type { TankBody } from './TankBody';

class MinMax {
  min = 0;
  max = 0;
}

const AABB_INTERSECTION_EPSILON = 0.01;

export class TanksCollisionDetector implements CollisionDetector {
  private readonly colliders: { [key: number]: Collider } = {};
  private readonly _rayHit = new RayHit();
  private readonly _time = new MinMax();
  private readonly _normal = new Vector3();
  private readonly _o = new Vector3();
  private readonly _dynamicRayHit = new RayHit();
  private readonly _rayAABB = new AABB();
  private readonly shapeContacts: ShapeContact[] = [];
  private tree = new CollisionKdTree();
  private threshold = 0.0001;
  private tankBodies: TankBody[] = [];
  private staticBody!: Body;

  constructor() {
    const epsilon = 0.000001;
    this.setCollider(CollisionShape.BOX, CollisionShape.BOX, new BoxBoxCollider(epsilon));
    this.setCollider(CollisionShape.BOX, CollisionShape.RECT, new BoxRectCollider(epsilon));
    this.setCollider(CollisionShape.BOX, CollisionShape.TRIANGLE, new BoxTriangleCollider(epsilon));
    this.createStaticBody();
  }

  private setCollider(type1: number, type2: number, collider: Collider): void {
    this.colliders[type1 | type2] = collider;
  }

  private createStaticBody(): void {
    this.staticBody = new Body(1, new Matrix3(), 10000000000);
    this.staticBody.movable = false;
  }

  buildKdTree(shapes: CollisionShape[], boundBox: AABB | null = null): void {
    for (const shape of shapes) {
      shape.body = this.staticBody;
    }
    this.tree.createTree(shapes, boundBox);
  }

  addTankBody(tankBody: TankBody): void {
    tankBody.hasContactsWithStatic = false;
    this.tankBodies.push(tankBody);
  }

  removeTankBody(tankBody: TankBody): void {
    const index = this.tankBodies.indexOf(tankBody);
    if (index > -1) {
      const last = this.tankBodies.length - 1;
      this.tankBodies[index] = this.tankBodies[last];
      this.tankBodies.length = last;
    }
  }

  getTankBodies(): TankBody[] {
    return this.tankBodies;
  }

  getBodyContacts(bodyContacts: BodyContact[]): void {
    const numTanks = this.tankBodies.length;
    for (let i = 0; i < numTanks; i++) {
      const tankBody = this.tankBodies[i];
      tankBody.wasContactWithStatic = tankBody.hasContactsWithStatic;
      tankBody.hasContactsWithStatic = tankBody.hasTracksContactsWithStatic();
      tankBody.penetratedBodies.length = 0;
    }
    for (let i = 0; i < numTanks; i++) {
      const tankBody = this.tankBodies[i];
      let countBefore = bodyContacts.length;
      this.getContactsWithStatic(tankBody, bodyContacts);
      if (countBefore !== bodyContacts.length) {
        tankBody.hasContactsWithStatic = true;
      }
      this.getContactsWithOtherBodies(tankBody, i + 1, bodyContacts);
    }
  }

  getShapeContactsWithStatic(shape: CollisionShape, contacts: ShapeContact[]): void {
    this.getShapeNodeCollisions(this.tree.rootNode, shape, contacts);
  }

  private getContactsWithStatic(tankBody: TankBody, bodyContacts: BodyContact[]): void {
    if (!tankBody.body.frozen) {
      for (const shape of tankBody.staticShapes) {
        this.getShapeNodeCollisions(this.tree.rootNode, shape, this.shapeContacts);
      }
      if (this.shapeContacts.length > 0) {
        const bodyContact = BodyContact.create();
        bodyContact.body1 = tankBody.body;
        bodyContact.body2 = this.staticBody;
        bodyContact.setShapeContacts(this.shapeContacts);
        this.shapeContacts.length = 0;
        bodyContacts.push(bodyContact);
      }
    }
  }

  private getContactsWithOtherBodies(tankBody: TankBody, startIndex: number, bodyContacts: BodyContact[]): void {
    const numTanks = this.tankBodies.length;
    for (let i = startIndex; i < numTanks; i++) {
      const otherTankBody = this.tankBodies[i];
      const body1 = tankBody.body;
      const body2 = otherTankBody.body;
      if (!(body1.frozen && body2.frozen) && body1.aabb.intersects(body2.aabb, AABB_INTERSECTION_EPSILON)) {
        this.getContacts(tankBody.tankCollisionBox, otherTankBody.tankCollisionBox, this.shapeContacts);
        const numContacts = this.shapeContacts.length;
        if (numContacts > 0) {
          const consider1 = body1.postCollisionFilter == null || body1.postCollisionFilter.considerBodies(body1, body2);
          const consider2 = body2.postCollisionFilter == null || body2.postCollisionFilter.considerBodies(body2, body1);
          if (consider1 && consider2) {
            const bodyContact = BodyContact.create();
            bodyContact.body1 = body1;
            bodyContact.body2 = body2;
            bodyContact.setShapeContacts(this.shapeContacts);
            bodyContacts.push(bodyContact);
            tankBody.penetratedBodies.push(body2);
            otherTankBody.penetratedBodies.push(body1);
          } else {
            for (let j = 0; j < numContacts; j++) {
              this.shapeContacts[j].dispose();
            }
          }
          this.shapeContacts.length = 0;
        }
      }
    }
  }

  getContacts(shape1: CollisionShape, shape2: CollisionShape, contacts: ShapeContact[]): void {
    if ((shape1.collisionGroup & shape2.collisionGroup) === 0) {
      return;
    }
    if (shape1.body === shape2.body) {
      return;
    }
    if (!shape1.aabb.intersects(shape2.aabb, AABB_INTERSECTION_EPSILON)) {
      return;
    }
    const collider = this.colliders[shape1.type | shape2.type];
    collider.getContacts(shape1, shape2, contacts);
  }

  testCollision(shape1: CollisionShape, shape2: CollisionShape): boolean {
    if ((shape1.collisionGroup & shape2.collisionGroup) === 0) {
      return false;
    }
    if (shape1.body === shape2.body) {
      return false;
    }
    if (!shape1.aabb.intersects(shape2.aabb, AABB_INTERSECTION_EPSILON)) {
      return false;
    }
    const collider = this.colliders[shape1.type | shape2.type];
    return collider.haveCollision(shape1, shape2);
  }

  raycast(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null, hit: RayHit): boolean {
    const staticHit = this.raycastStatic(origin, dir, collisionGroup, maxLength, filter, hit);
    const dynamicHit = this.raycastDynamic(origin, dir, collisionGroup, maxLength, filter, this._dynamicRayHit);
    if (!(dynamicHit || staticHit)) {
      return false;
    }
    if (dynamicHit && staticHit) {
      if (hit.t > this._dynamicRayHit.t) {
        hit.copy(this._dynamicRayHit);
      }
      this._dynamicRayHit.clear();
      return true;
    }
    if (staticHit) {
      this._dynamicRayHit.clear();
      return true;
    }
    hit.copy(this._dynamicRayHit);
    this._dynamicRayHit.clear();
    return true;
  }

  raycastStatic(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null, hit: RayHit): boolean {
    if (!this.getRayBoundBoxIntersection(origin, dir, this.tree.rootNode.boundBox!, this._time)) {
      return false;
    }
    if (this._time.max < 0 || this._time.min > maxLength) {
      return false;
    }
    if (this._time.min <= 0) {
      this._time.min = 0;
      this._o.x = origin.x;
      this._o.y = origin.y;
      this._o.z = origin.z;
    } else {
      this._o.x = origin.x + this._time.min * dir.x;
      this._o.y = origin.y + this._time.min * dir.y;
      this._o.z = origin.z + this._time.min * dir.z;
    }
    if (this._time.max > maxLength) {
      this._time.max = maxLength;
    }
    const found = this.testRayAgainstNode(this.tree.rootNode, origin, this._o, dir, collisionGroup, this._time.min, this._time.max, filter, hit);
    return found ? hit.t <= maxLength : false;
  }

  hasStaticHit(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null = null): boolean {
    const result = this.raycastStatic(origin, dir, collisionGroup, maxLength, filter, this._rayHit);
    this._rayHit.clear();
    return result;
  }

  private getShapeNodeCollisions(node: CollisionKdNode, shape: CollisionShape, contacts: ShapeContact[]): void {
    if (node.indices != null) {
      const shapes = this.tree.staticChildren;
      const indices = node.indices;
      for (let i = 0; i < indices.length; i++) {
        this.getContacts(shape, shapes[indices[i]], contacts);
      }
    }
    if (node.axis === -1) {
      return;
    }
    let min = 0;
    let max = 0;
    switch (node.axis) {
      case 0:
        min = shape.aabb.minX;
        max = shape.aabb.maxX;
        break;
      case 1:
        min = shape.aabb.minY;
        max = shape.aabb.maxY;
        break;
      case 2:
        min = shape.aabb.minZ;
        max = shape.aabb.maxZ;
    }
    if (min < node.coord) {
      this.getShapeNodeCollisions(node.negativeNode!, shape, contacts);
    }
    if (max > node.coord) {
      this.getShapeNodeCollisions(node.positiveNode!, shape, contacts);
    }
    if (node.splitIndices != null && min < node.coord && max > node.coord) {
      const shapes = this.tree.staticChildren;
      for (let i = 0; i < node.splitIndices.length; i++) {
        this.getContacts(shape, shapes[node.splitIndices[i]], contacts);
      }
    }
  }

  private testShapeNodeCollision(shape: CollisionShape, node: CollisionKdNode): boolean {
    if (node.indices != null) {
      const shapes = this.tree.staticChildren;
      const indices = node.indices;
      for (let i = 0; i < indices.length; i++) {
        if (this.testCollision(shape, shapes[indices[i]])) {
          return true;
        }
      }
    }
    if (node.axis === -1) {
      return false;
    }
    let min = 0;
    let max = 0;
    switch (node.axis) {
      case 0:
        min = shape.aabb.minX;
        max = shape.aabb.maxX;
        break;
      case 1:
        min = shape.aabb.minY;
        max = shape.aabb.maxY;
        break;
      case 2:
        min = shape.aabb.minZ;
        max = shape.aabb.maxZ;
    }
    if (node.splitIndices != null && min < node.coord && max > node.coord) {
      const shapes = this.tree.staticChildren;
      for (let i = 0; i < node.splitIndices.length; i++) {
        if (this.testCollision(shape, shapes[node.splitIndices[i]])) {
          return true;
        }
      }
    }
    if (min < node.coord) {
      if (this.testShapeNodeCollision(shape, node.negativeNode!)) {
        return true;
      }
    }
    if (max > node.coord) {
      if (this.testShapeNodeCollision(shape, node.positiveNode!)) {
        return true;
      }
    }
    return false;
  }

  private raycastDynamic(origin: Vector3, dir: Vector3, collisionGroup: number, maxLength: number, filter: IRayCollisionFilter | null, hit: RayHit): boolean {
    const endX = origin.x + dir.x * maxLength;
    const endY = origin.y + dir.y * maxLength;
    const endZ = origin.z + dir.z * maxLength;
    const rayAABB = this._rayAABB;
    if (endX < origin.x) {
      rayAABB.minX = endX;
      rayAABB.maxX = origin.x;
    } else {
      rayAABB.minX = origin.x;
      rayAABB.maxX = endX;
    }
    if (endY < origin.y) {
      rayAABB.minY = endY;
      rayAABB.maxY = origin.y;
    } else {
      rayAABB.minY = origin.y;
      rayAABB.maxY = endY;
    }
    if (endZ < origin.z) {
      rayAABB.minZ = endZ;
      rayAABB.maxZ = origin.z;
    } else {
      rayAABB.minZ = origin.z;
      rayAABB.maxZ = endZ;
    }
    let bestT = maxLength + 1;
    for (const tankBody of this.tankBodies) {
      const body = tankBody.body;
      let aabb = body.aabb;
      if (
        rayAABB.maxX < aabb.minX || rayAABB.minX > aabb.maxX ||
        rayAABB.maxY < aabb.minY || rayAABB.minY > aabb.maxY ||
        rayAABB.maxZ < aabb.minZ || rayAABB.minZ > aabb.maxZ
      ) {
        continue;
      }
      for (let i = 0; i < body.numCollisionShapes; i++) {
        const shape = body.collisionShapes![i];
        if ((shape.collisionGroup & collisionGroup) === 0) {
          continue;
        }
        aabb = shape.aabb;
        if (
          rayAABB.maxX < aabb.minX || rayAABB.minX > aabb.maxX ||
          rayAABB.maxY < aabb.minY || rayAABB.minY > aabb.maxY ||
          rayAABB.maxZ < aabb.minZ || rayAABB.minZ > aabb.maxZ
        ) {
          continue;
        }
        if (filter != null && !filter.considerBody(body)) {
          continue;
        }
        const t = shape.raycast(origin, dir, this.threshold, this._normal);
        if (t >= 0 && t < bestT) {
          bestT = t;
          hit.shape = shape;
          hit.normal.x = this._normal.x;
          hit.normal.y = this._normal.y;
          hit.normal.z = this._normal.z;
        }
      }
    }
    if (bestT > maxLength) {
      return false;
    }
    hit.position.x = origin.x + dir.x * bestT;
    hit.position.y = origin.y + dir.y * bestT;
    hit.position.z = origin.z + dir.z * bestT;
    hit.t = bestT;
    return true;
  }

  private getRayBoundBoxIntersection(origin: Vector3, dir: Vector3, box: AABB, time: MinMax): boolean {
    time.min = -1;
    time.max = 1e308;
    for (let axis = 0; axis < 3; axis++) {
      let t1: number;
      let t2: number;
      switch (axis) {
        case 0:
          if (dir.x < this.threshold && dir.x > -this.threshold) {
            if (origin.x < box.minX || origin.x > box.maxX) {
              return false;
            }
            continue;
          }
          t1 = (box.minX - origin.x) / dir.x;
          t2 = (box.maxX - origin.x) / dir.x;
          break;
        case 1:
          if (dir.y < this.threshold && dir.y > -this.threshold) {
            if (origin.y < box.minY || origin.y > box.maxY) {
              return false;
            }
            continue;
          }
          t1 = (box.minY - origin.y) / dir.y;
          t2 = (box.maxY - origin.y) / dir.y;
          break;
        default:
          if (dir.z < this.threshold && dir.z > -this.threshold) {
            if (origin.z < box.minZ || origin.z > box.maxZ) {
              return false;
            }
            continue;
          }
          t1 = (box.minZ - origin.z) / dir.z;
          t2 = (box.maxZ - origin.z) / dir.z;
          break;
      }
      if (t1 < t2) {
        if (t1 > time.min) {
          time.min = t1;
        }
        if (t2 < time.max) {
          time.max = t2;
        }
      } else {
        if (t2 > time.min) {
          time.min = t2;
        }
        if (t1 < time.max) {
          time.max = t1;
        }
      }
      if (time.max < time.min) {
        return false;
      }
    }
    return true;
  }

  private testRayAgainstNode(
    node: CollisionKdNode, origin: Vector3, entryPoint: Vector3, dir: Vector3,
    collisionGroup: number, tMin: number, tMax: number,
    filter: IRayCollisionFilter | null, hit: RayHit,
  ): boolean {
    if (node.indices != null && this.getRayNodeIntersection(origin, dir, collisionGroup, this.tree.staticChildren, node.indices, filter, hit)) {
      return true;
    }
    if (node.axis === -1) {
      return false;
    }
    let tSplit: number;
    let nearNode: CollisionKdNode;
    switch (node.axis) {
      case 0:
        tSplit = dir.x > -this.threshold && dir.x < this.threshold ? tMax + 1 : (node.coord - origin.x) / dir.x;
        nearNode = entryPoint.x < node.coord ? node.negativeNode! : node.positiveNode!;
        break;
      case 1:
        tSplit = dir.y > -this.threshold && dir.y < this.threshold ? tMax + 1 : (node.coord - origin.y) / dir.y;
        nearNode = entryPoint.y < node.coord ? node.negativeNode! : node.positiveNode!;
        break;
      default:
        tSplit = dir.z > -this.threshold && dir.z < this.threshold ? tMax + 1 : (node.coord - origin.z) / dir.z;
        nearNode = entryPoint.z < node.coord ? node.negativeNode! : node.positiveNode!;
        break;
    }
    if (tSplit < tMin || tSplit > tMax) {
      return this.testRayAgainstNode(nearNode, origin, entryPoint, dir, collisionGroup, tMin, tMax, filter, hit);
    }
    if (this.testRayAgainstNode(nearNode, origin, entryPoint, dir, collisionGroup, tMin, tSplit, filter, hit)) {
      return true;
    }
    this._o.x = origin.x + tSplit * dir.x;
    this._o.y = origin.y + tSplit * dir.y;
    this._o.z = origin.z + tSplit * dir.z;
    // Plane-coincident primitives at this node (original: lookup in the 2D split tree)
    if (node.splitIndices != null) {
      for (let i = 0; i < node.splitIndices.length; i++) {
        const shape = this.tree.staticChildren[node.splitIndices[i]];
        if ((shape.collisionGroup & collisionGroup) !== 0) {
          if (!(filter != null && !filter.considerBody(shape.body!))) {
            hit.t = shape.raycast(origin, dir, this.threshold, hit.normal);
            if (hit.t >= 0) {
              hit.position.copy(this._o);
              hit.shape = shape;
              return true;
            }
          }
        }
      }
    }
    return this.testRayAgainstNode(
      nearNode === node.negativeNode ? node.positiveNode! : node.negativeNode!,
      origin, this._o, dir, collisionGroup, tSplit, tMax, filter, hit,
    );
  }

  private getRayNodeIntersection(
    origin: Vector3, dir: Vector3, collisionGroup: number,
    shapes: CollisionShape[], indices: number[],
    filter: IRayCollisionFilter | null, hit: RayHit,
  ): boolean {
    let bestT = 1e308;
    for (let i = 0; i < indices.length; i++) {
      const shape = shapes[indices[i]];
      if ((shape.collisionGroup & collisionGroup) !== 0) {
        if (!(filter != null && !filter.considerBody(shape.body!))) {
          const t = shape.raycast(origin, dir, this.threshold, this._normal);
          if (t > 0 && t < bestT) {
            bestT = t;
            hit.shape = shape;
            hit.normal.x = this._normal.x;
            hit.normal.y = this._normal.y;
            hit.normal.z = this._normal.z;
          }
        }
      }
    }
    if (bestT === 1e308) {
      return false;
    }
    hit.position.x = origin.x + dir.x * bestT;
    hit.position.y = origin.y + dir.y * bestT;
    hit.position.z = origin.z + dir.z * bestT;
    hit.t = bestT;
    return true;
  }

  testStaticCollision(shape: CollisionShape): boolean {
    return this.testShapeNodeCollision(shape, this.tree.rootNode);
  }

  destroy(): void {
    this.tree.destroyTree();
    this.tree = null!;
    for (const tankBody of this.tankBodies) {
      tankBody.destroy();
    }
    this.tankBodies.length = 0;
    this.staticBody = null!;
  }
}
