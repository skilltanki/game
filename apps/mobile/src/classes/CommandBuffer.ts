// Per-actor inbox for TankCommands, stamped with the tick they apply to.
//
// The loop asks `take(tick)` once per physics step and gets the newest
// command whose stamp is <= tick (commands from the future are kept for
// later, which is what a mesh peer running slightly ahead produces).
// Nothing newer? The previous command is repeated ("hold what you had"),
// except one-shot fields (supply), which fire once.
import { cloneCommand, IDLE_COMMAND, type TankCommand } from '../model/TankCommand';
import type { CommandSink } from '../model/ControlSource';

interface Stamped {
  tick: number;
  command: TankCommand;
}

export class CommandBuffer implements CommandSink {
  private pending: Stamped[] = [];
  private current: TankCommand = cloneCommand(IDLE_COMMAND);
  private nextTick = 0;
  /** Tick of the last command that was actually consumed. */
  lastConsumedTick = -1;
  /** True after `take` had to repeat a stale command (remote lag indicator). */
  starved = false;

  /** Sets the tick the next unstamped push will be assigned to. */
  setCurrentTick(tick: number): void {
    this.nextTick = tick;
  }

  push(command: TankCommand, tick: number = this.nextTick): void {
    const stamped = { tick, command: cloneCommand(command) };
    // Keep the queue sorted; most pushes are in order, so scan from the end.
    let index = this.pending.length;
    while (index > 0 && this.pending[index - 1].tick > tick) {
      index--;
    }
    this.pending.splice(index, 0, stamped);
  }

  /** The command to apply for `tick`. Never returns null. */
  take(tick: number): TankCommand {
    let consumed: Stamped | null = null;
    // Several commands can land for one tick (a supply tap followed by the
    // per-tick keepalive). The newest wins for held fields, but a ONE-SHOT
    // carried by any of the skipped ones must not be lost.
    let supply: TankCommand['supply'] = null;
    while (this.pending.length > 0 && this.pending[0].tick <= tick) {
      consumed = this.pending.shift()!;
      if (consumed.command.supply != null) {
        supply = consumed.command.supply;
      }
    }
    if (consumed != null) {
      this.current = consumed.command.supply == null && supply != null ? { ...consumed.command, supply } : consumed.command;
      this.lastConsumedTick = consumed.tick;
      this.starved = false;
      return this.current;
    }
    // Repeat the held command; one-shots must not repeat.
    this.starved = true;
    if (this.current.supply != null) {
      this.current = { ...this.current, supply: null };
    }
    return this.current;
  }

  /** The command in effect right now (what `take` returned last). */
  peek(): TankCommand {
    return this.current;
  }

  reset(): void {
    this.pending.length = 0;
    this.current = cloneCommand(IDLE_COMMAND);
    this.lastConsumedTick = -1;
    this.starved = false;
  }
}
