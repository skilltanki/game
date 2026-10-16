// Starts, ticks and stops every actor's ControlSource. The loop only ever
// talks to this service, so swapping a bot for a remote peer (or a human)
// is a matter of handing the actor a different source.
import type { TankActor } from '../../../../classes/TankActor';
import type { ControlSource } from '../../../../model/ControlSource';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type BattleStateService from '../battle/BattleStateService';

export class ControlRegistryService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  private readonly started = new Set<string>();

  /** Wires the actor's source to its inbox. Resolves when the source is ready. */
  public attach = async (actor: TankActor): Promise<void> => {
    if (this.started.has(actor.id)) {
      return;
    }
    this.started.add(actor.id);
    await actor.control.start(actor.commands, {
      actorId: actor.id,
      currentTick: () => this.battleStateService.tick,
    });
    this.loggerService.log('control attached', actor.id, actor.control.kind);
  };

  /** Replaces the source at runtime (bot -> remote player, player -> bot on disconnect). */
  public replace = async (actor: TankActor, next: ControlSource): Promise<void> => {
    this.detach(actor);
    actor.control = next;
    actor.commands.reset();
    await this.attach(actor);
  };

  public detach = (actor: TankActor): void => {
    if (this.started.delete(actor.id)) {
      actor.control.stop();
    }
  };

  /**
   * One physics step for every source: stamp the inbox with the tick, let
   * the source think (bots) or keepalive (touch), then take the command.
   */
  public collect = (tick: number, dtSec: number): void => {
    for (const actor of this.battleStateService.actors()) {
      actor.commands.setCurrentTick(tick);
      try {
        actor.control.tick?.(tick, dtSec);
      } catch (error) {
        this.loggerService.error('control source tick failed', actor.id, error);
      }
      actor.lastCommand = actor.commands.take(tick);
      actor.commands.setCurrentTick(tick + 1);
    }
  };

  public detachAll = (): void => {
    for (const actor of this.battleStateService.actors()) {
      this.detach(actor);
    }
    this.started.clear();
  };
}

export default ControlRegistryService;
