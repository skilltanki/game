// The room session's events for the UI and the battle (model/online/OnlineEvents.ts).
import { TypedEmitter } from '../../../../classes/TypedEmitter';
import type { OnlineEventMap, OnlineEventName } from '../../../../model/online/OnlineEvents';

export class OnlineEventService {
  private readonly emitter = new TypedEmitter<OnlineEventMap>();

  public on = <K extends OnlineEventName>(name: K, listener: (payload: OnlineEventMap[K]) => void): (() => void) => this.emitter.on(name, listener);

  public once = <K extends OnlineEventName>(name: K, listener: (payload: OnlineEventMap[K]) => void): (() => void) => this.emitter.once(name, listener);

  public emit = <K extends OnlineEventName>(name: K, payload: OnlineEventMap[K]): void => this.emitter.emit(name, payload);
}

export default OnlineEventService;
