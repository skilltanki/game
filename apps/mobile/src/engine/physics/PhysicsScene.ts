// Port of the original PhysicsScene (EncryptedInt(1000) -> literal 1000)
import { Vector3 } from '../math/Vector3';
import { IslandsGenerator } from './contactislands/IslandsGenerator';
import type { Body } from './Body';
import type { BodyContact } from './BodyContact';
import type { CollisionDetector } from './collision/CollisionDetector';
import type { ContactIsland } from './contactislands/ContactIsland';
import type { ShapeContact } from './ShapeContact';

export class PhysicsScene {
  penetrationErrorCorrection = 0.7;
  maxCorrectablePenetration = 10;
  allowedPenetration = 0.01;
  collisionIterations = 4;
  contactIterations = 4;
  freezeSteps = 10;
  linSpeedFreezeLimit = 5;
  angSpeedFreezeLimit = 0.05;
  readonly gravity = new Vector3(0, 0, -9.8);
  collisionDetector!: CollisionDetector;
  bodies: Body[] = [];
  timeStamp = 0;
  time = 0;
  dt = 0;

  private readonly bodyContacts: BodyContact[] = [];
  private islandsGenerator: IslandsGenerator;

  constructor() {
    this.islandsGenerator = new IslandsGenerator(this);
  }

  addBody(body: Body): void {
    body.scene = this;
    body.id = this.bodies.length;
    this.bodies.push(body);
  }

  removeBody(body: Body): void {
    const index = this.bodies.indexOf(body);
    if (index > -1) {
      const last = this.bodies.length - 1;
      const lastBody = this.bodies[last];
      this.bodies[index] = lastBody;
      lastBody.id = index;
      this.bodies.length = last;
      body.scene = null;
    }
  }

  update(timeDeltaMs: number): void {
    this.timeStamp++;
    this.time += timeDeltaMs;
    this.dt = timeDeltaMs / 1000;
    this.applyForces();
    this.detectCollisions();
    this.prepareBodyContacts(this.bodyContacts, this.dt);
    this.islandsGenerator.generate(this.bodyContacts, this.bodies.length);
    this.resolveCollisions(this.islandsGenerator.contactIslands);
    this.intergateVelocities(this.dt);
    this.resolveContacts(this.islandsGenerator.contactIslands);
    this.islandsGenerator.clear();
    this.disposeBodyContacts(this.bodyContacts);
    this.integratePositions(this.dt);
    this.postPhysics();
  }

  private applyForces(): void {
    for (const body of this.bodies) {
      body.calcAccelerations();
      if (body.movable && !body.frozen) {
        body.acceleration.x += this.gravity.x;
        body.acceleration.y += this.gravity.y;
        body.acceleration.z += this.gravity.z;
      }
    }
  }

  private detectCollisions(): void {
    this.calculateBodiesDerivedData();
    this.collisionDetector.getBodyContacts(this.bodyContacts);
  }

  private calculateBodiesDerivedData(): void {
    for (const body of this.bodies) {
      if (!body.frozen) {
        body.saveState();
        body.calcDerivedData();
      }
    }
  }

  private prepareBodyContacts(bodyContacts: BodyContact[], dt: number): void {
    for (const bodyContact of bodyContacts) {
      this.prepareShapeContacts(bodyContact.shapeContacts, dt);
    }
  }

  private prepareShapeContacts(shapeContacts: ShapeContact[], dt: number): void {
    for (const contact of shapeContacts) {
      contact.calculatePersistentFrameData();
      contact.calcualteDynamicFrameData(this.allowedPenetration, this.penetrationErrorCorrection, this.maxCorrectablePenetration, dt);
    }
  }

  private resolveCollisions(islands: ContactIsland[]): void {
    for (const island of islands) {
      island.collisionPhase(this.collisionIterations);
    }
  }

  private resolveContacts(islands: ContactIsland[]): void {
    for (const island of islands) {
      island.contactPhase(this.contactIterations);
    }
  }

  private intergateVelocities(dt: number): void {
    for (const body of this.bodies) {
      body.integrateVelocity(dt);
    }
  }

  private integratePositions(dt: number): void {
    for (const body of this.bodies) {
      if (body.movable && !body.frozen) {
        body.integratePosition(dt);
        body.integratePseudoVelocity(dt);
      }
    }
  }

  private postPhysics(): void {
    for (const body of this.bodies) {
      body.clearAccumulators();
      body.calcDerivedData();
      if (body.canFreeze && !body.frozen) {
        const state = body.state;
        if (state.velocity.length() < this.linSpeedFreezeLimit && state.angularVelocity.length() < this.angSpeedFreezeLimit) {
          body.freezeCounter++;
          if (body.freezeCounter >= this.freezeSteps) {
            body.frozen = true;
          }
        } else {
          body.freezeCounter = 0;
          body.frozen = false;
        }
      }
    }
  }

  private disposeBodyContacts(bodyContacts: BodyContact[]): void {
    for (const bodyContact of bodyContacts) {
      bodyContact.dispose();
    }
    bodyContacts.length = 0;
  }
}
