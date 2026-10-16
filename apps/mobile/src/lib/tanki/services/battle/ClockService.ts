// The battle clock: ten minutes (a room: its own durationMs) from the first
// kill, in SIMULATION time, so a paused battle does not run down. Explore
// has no clock. Online, a non-host peer shows the HOST's clock (setRemote)
// and never ends the battle itself — the host's `finish` does.
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from './BattleStateService';
import type BattleEventService from './BattleEventService';

export const BATTLE_DURATION_MS = 10 * 60 * 1000;

export class ClockService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);

  private durationMs = BATTLE_DURATION_MS;
  private startedAtMs: number | null = null;
  private over = false;
  private lastEmittedSecond = -1;
  /** Fired once when time runs out; wired by the session through setOnTimeUp (di-kit accessors drop field writes). */
  private onTimeUp: (() => void) | null = null;
  /** Online replica: the host's value stands in for the local count. */
  private remote = false;
  private remoteMsLeft: number | null = null;

  /**
   * Who counts: the host counts, a replica shows the host's value. The seat
   * may change mid-battle (a host migration): the new host's count goes on
   * from the old host's last word, so the clock neither freezes nor jumps.
   */
  public setRemoteMode = (on: boolean): void => {
    if (on === this.remote) return;
    const left = this.msLeft;
    this.remote = on;
    if (on) {
      this.remoteMsLeft = left ?? this.durationMs;
      return;
    }
    const remoteLeft = this.remoteMsLeft;
    this.remoteMsLeft = null;
    // A clock the old host had started goes on from its value; one it had not (no kill yet) waits for the first kill here.
    this.startedAtMs = remoteLeft != null && remoteLeft < this.durationMs ? this.battleStateService.timeMs - (this.durationMs - remoteLeft) : null;
  };

  /** The battle's length (a room's `durationMs`); null = the default ten minutes. Set after reset(), before the battle starts. */
  public setDuration = (ms: number | null): void => {
    this.durationMs = ms != null && ms > 0 ? ms : BATTLE_DURATION_MS;
  };

  public setRemote = (msLeft: number | null): void => {
    this.remoteMsLeft = msLeft;
  };

  public setOnTimeUp = (hook: (() => void) | null): void => {
    this.onTimeUp = hook;
  };

  public reset = (): void => {
    this.durationMs = BATTLE_DURATION_MS;
    this.startedAtMs = null;
    this.over = false;
    this.lastEmittedSecond = -1;
    this.remote = false;
    this.remoteMsLeft = null;
  };

  public get enabled(): boolean {
    return this.battleStateService.config.mode !== 'explore';
  }

  /** True when this call started the count (the first kill of the battle on the counting machine). */
  public startOnFirstKill = (): boolean => {
    if (this.enabled && !this.remote && this.startedAtMs == null) {
      this.startedAtMs = this.battleStateService.timeMs;
      return true;
    }
    return false;
  };

  public get msLeft(): number | null {
    if (!this.enabled) {
      return null;
    }
    if (this.remote) {
      return this.remoteMsLeft;
    }
    if (this.startedAtMs == null) {
      return this.durationMs;
    }
    return Math.max(0, this.durationMs - (this.battleStateService.timeMs - this.startedAtMs));
  }

  /** Fixed-step: emits the clock once per second and ends the battle at zero. */
  public step = (): void => {
    if (this.over) {
      return;
    }
    const left = this.msLeft;
    const second = left == null ? -1 : Math.ceil(left / 1000);
    if (second !== this.lastEmittedSecond) {
      this.lastEmittedSecond = second;
      this.battleEventService.emit('clock', { msLeft: left });
    }
    if (!this.remote && left != null && left <= 0 && this.startedAtMs != null) {
      this.over = true;
      this.onTimeUp?.();
    }
  };
}

export default ClockService;
