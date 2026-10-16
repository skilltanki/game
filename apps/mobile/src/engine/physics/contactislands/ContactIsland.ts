// Port of the original ContactIsland (sequential-impulse solver)
import { Vector3 } from '../../math/Vector3';
import { ContactLevels } from './ContactLevels';
import type { Body } from '../Body';
import type { BodyContact } from '../BodyContact';
import type { PhysicsScene } from '../PhysicsScene';
import type { ShapeContact } from '../ShapeContact';

const COLLISION_MODE = 0;
const CONTACT_MODE = 1;

export class ContactIsland {
  private static pool: ContactIsland[] = [];
  private static poolSize = 0;
  private static readonly _relativeVelocity = new Vector3();

  readonly bodyContacts: BodyContact[] = [];

  private physicsScene: PhysicsScene | null = null;
  private readonly allShapeContacts: ShapeContact[] = [];
  private readonly levelShapeContacts: ShapeContact[] = [];
  private prevLevelBodies: Body[] = [];
  private levelBodies: Body[] = [];
  private readonly levelBodyContacts: BodyContact[] = [];
  private readonly contactLevels = new ContactLevels();

  static create(): ContactIsland {
    if (ContactIsland.poolSize === 0) {
      return new ContactIsland();
    }
    ContactIsland.poolSize--;
    const island = ContactIsland.pool[ContactIsland.poolSize];
    ContactIsland.pool[ContactIsland.poolSize] = null!;
    return island;
  }

  dispose(): void {
    this.physicsScene = null;
    this.bodyContacts.length = 0;
    this.allShapeContacts.length = 0;
    this.levelShapeContacts.length = 0;
    this.prevLevelBodies.length = 0;
    this.levelBodies.length = 0;
    this.levelBodyContacts.length = 0;
    this.contactLevels.clear();
    ContactIsland.pool[ContactIsland.poolSize++] = this;
  }

  init(scene: PhysicsScene): void {
    this.physicsScene = scene;
    for (const bodyContact of this.bodyContacts) {
      for (const shapeContact of bodyContact.shapeContacts) {
        this.allShapeContacts.push(shapeContact);
      }
    }
  }

  collisionPhase(iterations: number): void {
    this.resolveCollisions(iterations);
  }

  contactPhase(iterations: number): void {
    this.resolveContacts(iterations);
  }

  private resolveCollisions(iterations: number): void {
    const count = this.allShapeContacts.length;
    for (let iter = 0; iter < iterations; iter++) {
      this.shuffleContacts(this.allShapeContacts);
      for (let i = 0; i < count; i++) {
        this.resolveContact(this.allShapeContacts[i], COLLISION_MODE);
      }
    }
  }

  private resolveContacts(iterations: number): void {
    this.processContacts(iterations);
    this.contactLevels.init(this.bodyContacts);
    this.contactLevels.getStaticLevel(this.levelBodyContacts, this.levelBodies);
    if (this.levelBodyContacts.length > 0) {
      this.getShapeContacts(this.levelBodyContacts, this.levelShapeContacts);
      this.resolveContactsForLevel(iterations, this.levelShapeContacts);
      this.calculatePseudoVelocities(iterations, this.levelShapeContacts);
      while (this.contactLevels.hasContacts()) {
        const t = this.prevLevelBodies;
        this.prevLevelBodies = this.levelBodies;
        this.levelBodies = t;
        this.levelBodyContacts.length = 0;
        this.levelBodies.length = 0;
        this.contactLevels.getNextLevel(this.prevLevelBodies, this.levelBodyContacts, this.levelBodies);
        this.setBodiesMobility(this.prevLevelBodies, false);
        this.levelShapeContacts.length = 0;
        this.getShapeContacts(this.levelBodyContacts, this.levelShapeContacts);
        const scene = this.physicsScene!;
        for (const contact of this.levelShapeContacts) {
          contact.calcualteDynamicFrameData(scene.allowedPenetration, scene.penetrationErrorCorrection, scene.maxCorrectablePenetration, scene.dt);
        }
        this.resolveContactsForLevel(iterations, this.levelShapeContacts);
        this.calculatePseudoVelocities(iterations, this.levelShapeContacts);
        this.setBodiesMobility(this.prevLevelBodies, true);
      }
    } else {
      this.getShapeContacts(this.bodyContacts, this.levelShapeContacts);
      this.resolveContactsForLevel(iterations, this.levelShapeContacts);
      this.calculatePseudoVelocities(iterations, this.levelShapeContacts);
    }
  }

  private processContacts(iterations: number): void {
    const count = this.allShapeContacts.length;
    for (let iter = 0; iter < iterations; iter++) {
      this.shuffleContacts(this.allShapeContacts);
      for (let i = 0; i < count; i++) {
        this.resolveContact(this.allShapeContacts[i], CONTACT_MODE);
      }
    }
  }

  private getShapeContacts(bodyContacts: BodyContact[], out: ShapeContact[]): void {
    for (const bodyContact of bodyContacts) {
      for (const shapeContact of bodyContact.shapeContacts) {
        out.push(shapeContact);
      }
    }
  }

  private shuffleContacts(contacts: ShapeContact[]): void {
    const count = contacts.length;
    for (let i = 1; i < count; i++) {
      const j = (i * Math.random()) | 0;
      const t = contacts[j];
      contacts[j] = contacts[i];
      contacts[i] = t;
    }
  }

  private resolveContactsForLevel(iterations: number, contacts: ShapeContact[]): void {
    for (let iter = 0; iter < iterations; iter++) {
      this.shuffleContacts(contacts);
      const count = contacts.length;
      for (let i = 0; i < count; i++) {
        this.resolveContact(contacts[i], CONTACT_MODE);
      }
    }
  }

  private calculatePseudoVelocities(iterations: number, contacts: ShapeContact[]): void {
    for (let iter = 0; iter < iterations; iter++) {
      this.shuffleContacts(contacts);
      const count = contacts.length;
      for (let i = 0; i < count; i++) {
        this.resolveContactPseudoVelocity(contacts[i]);
      }
    }
  }

  private setBodiesMobility(bodies: Body[], movable: boolean): void {
    for (const body of bodies) {
      body.movable = movable;
    }
  }

  private resolveContact(contact: ShapeContact, mode: number): void {
    const normal = contact.normal;
    const body1 = contact.shape1.body!;
    const body2 = contact.shape2.body!;
    const relativeVelocity = ContactIsland._relativeVelocity;
    this.calculateRelativeVelocity(contact, relativeVelocity);
    let normalSpeed = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y + relativeVelocity.z * normal.z;
    let targetSpeed: number;
    if (mode === CONTACT_MODE) {
      targetSpeed = 0;
      if (normalSpeed < 0) {
        contact.satisfied = false;
      } else if (contact.satisfied) {
        return;
      }
    } else {
      contact.satisfied = true;
      targetSpeed = contact.collisionSpeed;
    }
    const tangentSpeed1 = relativeVelocity.dot(contact.tangent1);
    const tangentSpeed2 = relativeVelocity.dot(contact.tangent2);
    let tangentImpulse1 = contact.tangentImpulse1 - tangentSpeed1 / contact.tangentSpeedDelta1;
    let tangentImpulse2 = contact.tangentImpulse2 - tangentSpeed2 / contact.tangentSpeedDelta2;
    const tangentImpulseSqr = tangentImpulse1 * tangentImpulse1 + tangentImpulse2 * tangentImpulse2;
    const maxFriction = contact.friction * contact.normalImpulse;
    if (tangentImpulseSqr > maxFriction * maxFriction) {
      const tangentImpulseLength = Math.sqrt(tangentImpulseSqr);
      tangentImpulse1 *= maxFriction / tangentImpulseLength;
      tangentImpulse2 *= maxFriction / tangentImpulseLength;
    }
    const deltaTangent1 = tangentImpulse1 - contact.tangentImpulse1;
    const deltaTangent2 = tangentImpulse2 - contact.tangentImpulse2;
    contact.tangentImpulse1 = tangentImpulse1;
    contact.tangentImpulse2 = tangentImpulse2;
    if (body1.movable) {
      body1.applyWorldImpulseAtLocalPoint(contact.r1, contact.tangent1, deltaTangent1);
      body1.applyWorldImpulseAtLocalPoint(contact.r1, contact.tangent2, deltaTangent2);
    }
    if (body2.movable) {
      body2.applyWorldImpulseAtLocalPoint(contact.r2, contact.tangent1, -deltaTangent1);
      body2.applyWorldImpulseAtLocalPoint(contact.r2, contact.tangent2, -deltaTangent2);
    }
    this.calculateRelativeVelocity(contact, relativeVelocity);
    normalSpeed = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y + relativeVelocity.z * normal.z;
    const speedError = targetSpeed - normalSpeed;
    let normalImpulse = contact.normalImpulse + speedError / contact.normalSpeedDelta;
    if (normalImpulse < 0) {
      normalImpulse = 0;
    }
    const deltaNormal = normalImpulse - contact.normalImpulse;
    contact.normalImpulse = normalImpulse;
    if (body1.movable) {
      body1.applyWorldImpulseAtLocalPoint(contact.r1, contact.normal, deltaNormal);
    }
    if (body2.movable) {
      body2.applyWorldImpulseAtLocalPoint(contact.r2, contact.normal, -deltaNormal);
    }
  }

  private calculateRelativeVelocity(contact: ShapeContact, out: Vector3): void {
    let angular = contact.shape1.body!.state.angularVelocity;
    let r = contact.r1;
    let cx = angular.y * r.z - angular.z * r.y;
    let cy = angular.z * r.x - angular.x * r.z;
    let cz = angular.x * r.y - angular.y * r.x;
    let velocity = contact.shape1.body!.state.velocity;
    out.x = velocity.x + cx;
    out.y = velocity.y + cy;
    out.z = velocity.z + cz;
    angular = contact.shape2.body!.state.angularVelocity;
    r = contact.r2;
    cx = angular.y * r.z - angular.z * r.y;
    cy = angular.z * r.x - angular.x * r.z;
    cz = angular.x * r.y - angular.y * r.x;
    velocity = contact.shape2.body!.state.velocity;
    out.x -= velocity.x + cx;
    out.y -= velocity.y + cy;
    out.z -= velocity.z + cz;
  }

  private resolveContactPseudoVelocity(contact: ShapeContact): void {
    const relativeVelocity = ContactIsland._relativeVelocity;
    this.calcPseudoSeparationVelocity(contact, relativeVelocity);
    const normalSpeed = relativeVelocity.x * contact.normal.x + relativeVelocity.y * contact.normal.y + relativeVelocity.z * contact.normal.z;
    const speedError = contact.contactSeparationSpeed - normalSpeed;
    const impulse = speedError / contact.normalSpeedDelta;
    if (contact.shape1.body!.movable) {
      contact.shape1.body!.applyWorldPseudoImpulseAtLocalPoint(contact.r1, contact.normal, impulse);
    }
    if (contact.shape2.body!.movable) {
      contact.shape2.body!.applyWorldPseudoImpulseAtLocalPoint(contact.r2, contact.normal, -impulse);
    }
  }

  private calcPseudoSeparationVelocity(contact: ShapeContact, out: Vector3): void {
    let angular = contact.shape1.body!.pseudoAngularVelocity;
    let r = contact.r1;
    let cx = angular.y * r.z - angular.z * r.y;
    let cy = angular.z * r.x - angular.x * r.z;
    let cz = angular.x * r.y - angular.y * r.x;
    let velocity = contact.shape1.body!.pseudoVelocity;
    out.x = velocity.x + cx;
    out.y = velocity.y + cy;
    out.z = velocity.z + cz;
    angular = contact.shape2.body!.pseudoAngularVelocity;
    r = contact.r2;
    cx = angular.y * r.z - angular.z * r.y;
    cy = angular.z * r.x - angular.x * r.z;
    cz = angular.x * r.y - angular.y * r.x;
    velocity = contact.shape2.body!.pseudoVelocity;
    out.x -= velocity.x + cx;
    out.y -= velocity.y + cy;
    out.z -= velocity.z + cz;
  }
}
