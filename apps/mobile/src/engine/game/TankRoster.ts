// The battle roster: every tank in the fight, addressable by id.
//
// This replaces two patterns that cannot cross a network boundary:
//
//  - `Map<GameTank, …>` keyed by object reference — a remote tank arrives as
//    data, not as the same object, so reference keys silently miss;
//  - `tanks.find(t => t.tank === hit.tank)` — a linear scan run four times per
//    hit just to get from a physics Tank back to its GameTank.
//
// The original addressed objects the same way (every SpaceCommand carries a
// Model.object.id), so this is also the shape the protocol will want.

import type { GameTank } from './GameTank';
import type { Tank, TankId } from '../tank/Tank';

export class TankRoster {
  private readonly byId = new Map<TankId, GameTank>();
  /** Reverse index: physics body -> its GameTank, for weapon hits. */
  private readonly byTank = new Map<Tank, GameTank>();

  add(gameTank: GameTank): void {
    this.byId.set(gameTank.id, gameTank);
    this.byTank.set(gameTank.tank, gameTank);
  }

  remove(id: TankId): void {
    const gameTank = this.byId.get(id);
    if (gameTank == null) {
      return;
    }
    this.byId.delete(id);
    this.byTank.delete(gameTank.tank);
  }

  get(id: TankId): GameTank | null {
    return this.byId.get(id) ?? null;
  }

  /** The GameTank owning this physics tank — what weapon hits report. */
  ofTank(tank: Tank): GameTank | null {
    return this.byTank.get(tank) ?? null;
  }

  has(id: TankId): boolean {
    return this.byId.has(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /** Every tank in the battle. */
  all(): GameTank[] {
    return [...this.byId.values()];
  }

  /** Physics tanks, for the weapons' target search. */
  allTanks(): Tank[] {
    return [...this.byTank.keys()];
  }

  /** The tank this client drives, if any. */
  local(): GameTank | null {
    for (const gameTank of this.byId.values()) {
      if (gameTank.isLocal) {
        return gameTank;
      }
    }
    return null;
  }

  [Symbol.iterator](): IterableIterator<GameTank> {
    return this.byId.values();
  }
}

/**
 * Per-tank state keyed by ID rather than by object reference.
 *
 * Same surface as a Map, so the call sites read unchanged, but a tank that is
 * removed and re-added (or that arrives from the network) resolves correctly.
 */
export class TankState<T> {
  private readonly values = new Map<TankId, T>();

  get(tank: { id: TankId }): T | undefined {
    return this.values.get(tank.id);
  }

  set(tank: { id: TankId }, value: T): void {
    this.values.set(tank.id, value);
  }

  has(tank: { id: TankId }): boolean {
    return this.values.has(tank.id);
  }

  delete(tank: { id: TankId }): void {
    this.values.delete(tank.id);
  }

  clear(): void {
    this.values.clear();
  }

  entries(): IterableIterator<[TankId, T]> {
    return this.values.entries();
  }

  /** The stored values, for callers that tick every entry. */
  all(): IterableIterator<T> {
    return this.values.values();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values.values();
  }
}
