// Port of the original SoaringChecker
// (BattleService locator replaced by a detector passed to the constructor)
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { PhysicsMaterial } from '../physics/PhysicsMaterial';
import { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import { TankConst } from './TankConst';
import type { ShapeContact } from '../physics/ShapeContact';
import type { TankBody } from './TankBody';
import type { TanksCollisionDetector } from './TanksCollisionDetector';

const HALF_WHEEL_SIZE = 12.5;
const contacts: ShapeContact[] = [];

export class SoaringChecker {
  private tankBody: TankBody;
  private detector: TanksCollisionDetector;
  private testSoaringCollisionBox: CollisionBox;
  private wasSoaring = false;
  private soaring = false;
  private staticIsNear = false;

  constructor(tankBody: TankBody, detector: TanksCollisionDetector) {
    this.tankBody = tankBody;
    this.detector = detector;
    const halfSize = tankBody.tankCollisionBox.hs.clone();
    halfSize.z += HALF_WHEEL_SIZE;
    this.testSoaringCollisionBox = new CollisionBox(halfSize, -1, PhysicsMaterial.DEFAULT_MATERIAL);
    this.testSoaringCollisionBox.body = tankBody.body;
  }

  updateSoaring(): void {
    this.wasSoaring = this.soaring;
    this.updateSoaringCollisionBox();
    this.detector.getShapeContactsWithStatic(this.testSoaringCollisionBox, contacts);
    let maxUpDot = 0;
    for (const contact of contacts) {
      const dot = contact.shape1 === this.testSoaringCollisionBox
        ? contact.normal.dot(Vector3.Z_AXIS)
        : contact.normal.dot(Vector3.DOWN);
      maxUpDot = Math.max(maxUpDot, dot);
    }
    this.staticIsNear = contacts.length > 0;
    for (const contact of contacts) {
      contact.dispose();
    }
    contacts.length = 0;
    this.soaring = maxUpDot < TankConst.MAX_SLOPE_ANGLE_COS;
  }

  private updateSoaringCollisionBox(): void {
    const mainBox = this.tankBody.tankCollisionBox;
    const m: Matrix4 = this.testSoaringCollisionBox.transform;
    m.copy(mainBox.transform);
    m.m03 -= m.m02 * HALF_WHEEL_SIZE;
    m.m13 -= m.m12 * HALF_WHEEL_SIZE;
    m.m23 -= m.m22 * HALF_WHEEL_SIZE;
    this.testSoaringCollisionBox.calculateAABB();
  }

  isSoaring(): boolean {
    return this.soaring;
  }

  isJumpBegin(): boolean {
    return this.soaring && !this.wasSoaring;
  }

  isJumpEnd(): boolean {
    return this.wasSoaring && !this.soaring;
  }

  isElasticStaticCollisionWhenSoaring(): boolean {
    return this.soaring && this.staticIsNear;
  }
}
