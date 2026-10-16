// Port of the original TankPhysicsScene
// (anti-cheat validators and event dispatcher dropped; PHYSICS_STEP_IN_MS inlined)
import { Vector3 } from '../math/Vector3';
import { PhysicsScene } from '../physics/PhysicsScene';
import { TanksCollisionDetector } from './TanksCollisionDetector';
import type { CollisionShape } from '../physics/collision/CollisionShape';
import type { TankBody } from './TankBody';

export const PHYSICS_STEP_IN_MS = 33;

const MAX_UP_VELOCITY = 200;
const tmpVector = new Vector3();

export class TankPhysicsScene {
  private physicsScene: PhysicsScene;
  private collisionDetector: TanksCollisionDetector;

  constructor(time: number, gravity: number) {
    this.physicsScene = new PhysicsScene();
    this.physicsScene.gravity.reset(0, 0, -gravity);
    this.physicsScene.collisionIterations = 4;
    this.physicsScene.contactIterations = 4;
    this.physicsScene.allowedPenetration = 5;
    this.collisionDetector = new TanksCollisionDetector();
    this.physicsScene.collisionDetector = this.collisionDetector;
    this.physicsScene.time = time;
  }

  getPhysicsTime(): number {
    return this.physicsScene.time;
  }

  initStaticGeometry(shapes: CollisionShape[]): void {
    this.collisionDetector.buildKdTree(shapes);
  }

  getCollisionDetector(): TanksCollisionDetector {
    return this.collisionDetector;
  }

  getScene(): PhysicsScene {
    return this.physicsScene;
  }

  addBody(tankBody: TankBody): void {
    this.physicsScene.addBody(tankBody.body);
    this.collisionDetector.addTankBody(tankBody);
  }

  removeBody(tankBody: TankBody): void {
    this.physicsScene.removeBody(tankBody.body);
    this.collisionDetector.removeTankBody(tankBody);
  }

  destroy(): void {
    this.collisionDetector.destroy();
  }

  update(timeDeltaMs: number): void {
    this.physicsScene.update(timeDeltaMs);
    this.postPhysicsTankProcessor();
  }

  // Caps the velocity component along the tank's up axis — prevents physics
  // glitches from launching tanks into the sky.
  private postPhysicsTankProcessor(): void {
    for (const tankBody of this.collisionDetector.getTankBodies()) {
      const body = tankBody.body;
      const velocity = body.state.velocity;
      const upAxis = tmpVector;
      body.state.orientation.getZAxis(upAxis);
      let upVelocity = velocity.x * upAxis.x + velocity.y * upAxis.y + velocity.z * upAxis.z;
      if (upAxis.z < -0.1 || (upAxis.z < 0.1 && upVelocity < 0)) {
        upVelocity = -upVelocity;
        upAxis.reverse();
      }
      tankBody.updateSoaring();
      if (tankBody.hasContactsWithStatic || tankBody.wasContactWithStatic || tankBody.hasContactsWithOtherBodies() || !tankBody.isSoaring()) {
        let maxUpVelocity = MAX_UP_VELOCITY;
        if (!tankBody.hasContactsWithStatic && tankBody.isSoaring() && tankBody.previousUpVelocity > maxUpVelocity) {
          maxUpVelocity = tankBody.previousUpVelocity;
        }
        const additionForce = tankBody.additionForcesSum.dot(upAxis);
        let forceUpVelocity = (additionForce * body.invMass * PHYSICS_STEP_IN_MS) / 1000;
        if (forceUpVelocity < MAX_UP_VELOCITY) {
          forceUpVelocity = 0;
        }
        maxUpVelocity = Math.max(forceUpVelocity, maxUpVelocity);
        if (upVelocity > maxUpVelocity) {
          const excess = upVelocity - maxUpVelocity;
          velocity.x -= excess * upAxis.x;
          velocity.y -= excess * upAxis.y;
          velocity.z -= excess * upAxis.z;
          upVelocity = maxUpVelocity;
        }
      }
      tankBody.previousUpVelocity = upVelocity;
      tankBody.additionForcesSum.reset();
    }
  }

  getGravity(): number {
    return this.physicsScene.gravity.z;
  }
}
