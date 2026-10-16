// Port of the original CollisionBoxesBuilder
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { PhysicsMaterial } from '../physics/PhysicsMaterial';
import { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import { CollisionGroup } from './CollisionGroup';
import { MathUtils } from './MathUtils';
import type { TankBody } from './TankBody';

const NORMAL_FRICTION_MATERIAL = new PhysicsMaterial(0, 1);
const LOW_FRICTION_MATERIAL = new PhysicsMaterial(0, 0.2);

export class CollisionBoxesBuilder {
  // Builds the sloped "fender" boxes + mid/top boxes that collide with static geometry.
  static createStaticCollisionBoxes(hullHalfSize: Vector3, fullHeight: number, tankBody: TankBody): void {
    const height = fullHeight - 10;
    const halfLength = hullHalfSize.y;
    const halfHeight = height / 2;
    const slopeFactor = 0.82;
    let k = 1 - ((1 - slopeFactor) * (1 - slopeFactor) * halfLength * halfLength) / (halfHeight * halfHeight);
    if (k > 0) {
      k = Math.sqrt(k);
    } else {
      k = 1 - ((1 - slopeFactor) * halfLength) / halfHeight;
    }
    const slope1 = ((slopeFactor - 1) * halfLength) / ((1 + k) * halfHeight);
    const intercept = k * halfHeight - slope1 * halfLength;
    const slope2 = ((1 - slopeFactor) * halfLength) / ((1 + k) * halfHeight);
    const slope3 = ((1 - k) * halfHeight) / ((1 - slopeFactor) * halfLength);
    let cornerY: number;
    let cornerZ: number;
    if (MathUtils.numbersEqual(slope2, slope3, 0.00001) || slope2 < slope3) {
      cornerY = slopeFactor * halfLength;
      cornerZ = slope1 * cornerY + intercept;
    } else {
      cornerY = ((1 - k) * halfHeight) / slope1 + halfLength;
      cornerZ = halfHeight;
    }
    let dy = cornerZ - k * halfHeight;
    let dz = halfLength - cornerY;
    const fenderHalfHeight = Math.sqrt(dy * dy + dz * dz) / 2;
    dy = (1 + k) * halfHeight;
    dz = (1 - slopeFactor) * halfLength;
    const fenderHalfLength = Math.sqrt(dy * dy + dz * dz) / 2;
    let box = new CollisionBox(new Vector3(hullHalfSize.x, fenderHalfHeight, fenderHalfLength), CollisionGroup.STATIC, LOW_FRICTION_MATERIAL);
    const transform = new Matrix4();
    const angle = Math.atan(slope2);
    transform.setRotationMatrix(-angle, 0, 0);
    const offsetY = slopeFactor * halfLength + fenderHalfLength * Math.sin(angle) - fenderHalfHeight * Math.cos(angle);
    const offsetZ = -halfHeight + fenderHalfLength * Math.cos(angle) + fenderHalfHeight * Math.sin(angle) - (hullHalfSize.z - height / 2);
    transform.setPosition(new Vector3(0, offsetY, offsetZ));
    tankBody.body.addCollisionShape(box, transform);
    tankBody.staticShapes.push(box);
    box = new CollisionBox(new Vector3(hullHalfSize.x, fenderHalfHeight, fenderHalfLength), CollisionGroup.STATIC, LOW_FRICTION_MATERIAL);
    transform.setRotationMatrix(angle, 0, 0);
    transform.setPosition(new Vector3(0, -offsetY, offsetZ));
    tankBody.body.addCollisionShape(box, transform);
    tankBody.staticShapes.push(box);
    const bottomBoxHeight = (fullHeight * 3) / 4;
    const bottomHalfSize = new Vector3(hullHalfSize.x, hullHalfSize.y * slopeFactor, bottomBoxHeight / 2);
    const bottomTransform = new Matrix4();
    bottomTransform.m23 = bottomHalfSize.z - hullHalfSize.z;
    const bottomBox = new CollisionBox(bottomHalfSize, CollisionGroup.STATIC, LOW_FRICTION_MATERIAL);
    tankBody.body.addCollisionShape(bottomBox, bottomTransform);
    tankBody.staticShapes.push(bottomBox);
    const topBoxHeight = (fullHeight * 3) / 4;
    const topHalfSize = new Vector3(hullHalfSize.x, hullHalfSize.y * slopeFactor, topBoxHeight / 2);
    const topTransform = new Matrix4();
    topTransform.m23 = fullHeight - topHalfSize.z - hullHalfSize.z;
    const topBox = new CollisionBox(topHalfSize, CollisionGroup.STATIC, NORMAL_FRICTION_MATERIAL);
    tankBody.body.addCollisionShape(topBox, topTransform);
    tankBody.staticShapes.push(topBox);
  }

  // The single box used for tank-vs-tank collisions (and raycasts against the tank).
  static createTankCollisionBox(hullHalfSize: Vector3, fullHeight: number, tankBody: TankBody): void {
    const halfSize = new Vector3(hullHalfSize.x, hullHalfSize.y, fullHeight / 2);
    const box = new CollisionBox(halfSize, 0, LOW_FRICTION_MATERIAL);
    const transform = new Matrix4();
    transform.m23 = fullHeight / 2 - hullHalfSize.z;
    tankBody.body.addCollisionShape(box, transform);
    tankBody.tankCollisionBox = box;
  }
}
