// The battle's event bus. Logic emits, presentation listens; listeners are
// dropped wholesale when a battle ends.
import { TypedEmitter } from '../../../../classes/TypedEmitter';
import type { BattleEventMap } from '../../../../model/BattleEvents';

export class BattleEventService {
  private emitter = new TypedEmitter<BattleEventMap>();

  public on = <K extends keyof BattleEventMap>(name: K, listener: (payload: BattleEventMap[K]) => void): (() => void) =>
    this.emitter.on(name, listener);

  public once = <K extends keyof BattleEventMap>(name: K, listener: (payload: BattleEventMap[K]) => void): (() => void) =>
    this.emitter.once(name, listener);

  public emit = <K extends keyof BattleEventMap>(name: K, payload: BattleEventMap[K]): void => {
    this.emitter.emit(name, payload);
  };

  public clear = (): void => {
    this.emitter.clear();
  };
}

export default BattleEventService;
