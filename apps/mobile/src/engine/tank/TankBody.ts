// Port of the original TankBody.
// The original reached its SoaringChecker through the Tank class and a service
// locator; here the checker is attached explicitly via initSoaring(), and the
// tracks-contact query is a callback set by the tank assembly.
import { Vector3 } from '../math/Vector3';
import { SoaringChecker } from './SoaringChecker';
import type { Body } from '../physics/Body';
import type { CollisionBox } from '../physics/collision/primitives/CollisionBox';
import type { CollisionShape } from '../physics/collision/CollisionShape';
import type { TanksCollisionDetector } from './TanksCollisionDetector';

export class TankBody {
  id = 0;
  body: Body;
  tankCollisionBox!: CollisionBox;
  staticShapes: CollisionShape[] = [];
  hasContactsWithStatic = false;
  penetratedBodies: Body[] = [];
  wasContactWithStatic = false;
  additionForcesSum = new Vector3();
  previousUpVelocity = 0;

  /** Set by the tank assembly: whether any suspension ray touches static geometry. */
  hasTracksContactsWithStatic: () => boolean = () => false;

  private soaringChecker: SoaringChecker | null = null;

  constructor(body: Body) {
    this.body = body;
  }

  initSoaring(detector: TanksCollisionDetector): void {
    this.soaringChecker = new SoaringChecker(this, detector);
  }

  hasContactsWithOtherBodies(): boolean {
    return this.penetratedBodies.length > 0;
  }

  destroy(): void {
    this.soaringChecker = null;
    this.body = null!;
    this.staticShapes = null!;
    this.penetratedBodies = null!;
  }

  updateSoaring(): void {
    this.soaringChecker?.updateSoaring();
  }

  isSoaring(): boolean {
    return this.soaringChecker != null ? this.soaringChecker.isSoaring() : false;
  }

  isJumpBegin(): boolean {
    return this.soaringChecker != null ? this.soaringChecker.isJumpBegin() : false;
  }

  isJumpEnd(): boolean {
    return this.soaringChecker != null ? this.soaringChecker.isJumpEnd() : false;
  }

  isElasticStaticCollisionWhenSoaring(): boolean {
    return this.soaringChecker != null ? this.soaringChecker.isElasticStaticCollisionWhenSoaring() : false;
  }
}
