// Port of the original ContactLevels
import type { Body } from '../Body';
import type { BodyContact } from '../BodyContact';

export class ContactLevels {
  private readonly contacts: BodyContact[] = [];

  init(bodyContacts: BodyContact[]): void {
    this.contacts.length = bodyContacts.length;
    for (let i = 0; i < bodyContacts.length; i++) {
      this.contacts[i] = bodyContacts[i];
    }
  }

  clear(): void {
    this.contacts.length = 0;
  }

  getStaticLevel(outContacts: BodyContact[], outBodies: Body[]): void {
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i];
      if (this.isStaticContact(contact)) {
        outContacts.push(contact);
        outBodies.push(this.getNonStaticBody(contact));
        this.removeContact(i);
        i--;
      }
    }
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i];
      if (outBodies.indexOf(contact.body1) >= 0 && outBodies.indexOf(contact.body2) >= 0) {
        outContacts.push(contact);
        this.removeContact(i);
        i--;
      }
    }
  }

  private isStaticContact(contact: BodyContact): boolean {
    return !(contact.body1.movable && contact.body2.movable);
  }

  private getNonStaticBody(contact: BodyContact): Body {
    if (contact.body1.movable) {
      return contact.body1;
    }
    return contact.body2;
  }

  private removeContact(index: number): void {
    const last = this.contacts.length - 1;
    this.contacts[index] = this.contacts[last];
    this.contacts.length = last;
  }

  getNextLevel(prevLevelBodies: Body[], outContacts: BodyContact[], outBodies: Body[]): void {
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i];
      if (this.isInContactWith(prevLevelBodies, contact)) {
        outContacts.push(contact);
        outBodies.push(this.getNextLevelBody(contact, prevLevelBodies));
        this.removeContact(i);
        i--;
      }
    }
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i];
      if (outBodies.indexOf(contact.body1) >= 0 && outBodies.indexOf(contact.body2) >= 0) {
        outContacts.push(contact);
        this.removeContact(i);
        i--;
      }
    }
  }

  private isInContactWith(bodies: Body[], contact: BodyContact): boolean {
    return bodies.indexOf(contact.body1) >= 0 || bodies.indexOf(contact.body2) >= 0;
  }

  private getNextLevelBody(contact: BodyContact, bodies: Body[]): Body {
    if (bodies.indexOf(contact.body1) < 0) {
      return contact.body1;
    }
    return contact.body2;
  }

  hasContacts(): boolean {
    return this.contacts.length > 0;
  }
}
