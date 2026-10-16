// Port of the original BodyContact
import type { Body } from './Body';
import { ShapeContact } from './ShapeContact';

export class BodyContact {
  private static poolTop: BodyContact | null = null;

  body1!: Body;
  body2!: Body;
  shapeContacts: ShapeContact[] = [];
  private nextInPool: BodyContact | null = null;

  static create(): BodyContact {
    if (BodyContact.poolTop == null) {
      return new BodyContact();
    }
    const contact = BodyContact.poolTop;
    BodyContact.poolTop = contact.nextInPool;
    contact.nextInPool = null;
    return contact;
  }

  dispose(): void {
    this.body1 = null!;
    this.body2 = null!;
    for (const contact of this.shapeContacts) {
      contact.dispose();
    }
    this.shapeContacts.length = 0;
    this.nextInPool = BodyContact.poolTop;
    BodyContact.poolTop = this;
  }

  copy(other: BodyContact): void {
    this.body1 = other.body1;
    this.body2 = other.body2;
    for (const contact of other.shapeContacts) {
      this.shapeContacts.push(contact);
    }
  }

  setShapeContacts(contacts: ShapeContact[]): void {
    for (let i = 0; i < contacts.length; i++) {
      this.shapeContacts[i] = contacts[i];
    }
  }
}
