// Port of the original IslandsGenerator
// (the original's Dictionary replaced by Map)
import { QuickUnionFind } from '../QuickUnionFind';
import { ContactIsland } from './ContactIsland';
import type { BodyContact } from '../BodyContact';
import type { PhysicsScene } from '../PhysicsScene';

export class IslandsGenerator {
  readonly contactIslands: ContactIsland[] = [];

  private readonly contactIslandsByRootId = new Map<number, ContactIsland>();
  private readonly uf = new QuickUnionFind();
  private physicsScene: PhysicsScene;

  constructor(scene: PhysicsScene) {
    this.physicsScene = scene;
  }

  generate(bodyContacts: BodyContact[], numBodies: number): void {
    this.createUnions(bodyContacts, numBodies);
    this.createIslands(bodyContacts);
  }

  private createUnions(bodyContacts: BodyContact[], numBodies: number): void {
    this.uf.init(numBodies);
    for (const contact of bodyContacts) {
      if (contact.body1.movable && contact.body2.movable) {
        this.uf.union(contact.body1.id, contact.body2.id);
      }
    }
  }

  private createIslands(bodyContacts: BodyContact[]): void {
    for (const contact of bodyContacts) {
      const rootId = contact.body1.movable ? this.uf.root(contact.body1.id) : this.uf.root(contact.body2.id);
      let island = this.contactIslandsByRootId.get(rootId);
      if (island == null) {
        island = ContactIsland.create();
        this.contactIslands.push(island);
        this.contactIslandsByRootId.set(rootId, island);
      }
      island.bodyContacts.push(contact);
    }
    for (const island of this.contactIslands) {
      island.init(this.physicsScene);
    }
    this.contactIslandsByRootId.clear();
  }

  clear(): void {
    for (const island of this.contactIslands) {
      island.dispose();
    }
    this.contactIslands.length = 0;
  }
}
