// Dev only: the local player's battle, line by line, into the dev server's
// bench log (.bench/events.jsonl via BenchMode.benchLog) — start with the
// difficulty, every death with who killed whom, a 30 s heartbeat and the
// final K/D. The owner plays a few battles per difficulty; the file is the
// measurement (PLAN.md: balance against a live player).
import { benchLog } from '../../../../bench/BenchMode';
import type { BattleConfig } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleEventService from '../battle/BattleEventService';
import type BattleStateService from '../battle/BattleStateService';

const HEARTBEAT_MS = 30000;

export class SessionLogService {
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  private detach: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private kills = 0;
  private deaths = 0;
  private tag = '';

  /** Call once the battle is playing; stops itself at the final whistle. */
  public begin = (config: BattleConfig): void => {
    if (!import.meta.env.DEV) return;
    this.end();
    this.kills = 0;
    this.deaths = 0;
    this.tag = `${config.mode}:${config.mapId}:${config.botDifficulty}:${config.bots}`;
    benchLog({ kind: 'session-start', tag: this.tag, config: { mode: config.mode, map: config.mapId, difficulty: config.botDifficulty, bots: config.bots, team: config.team, hull: config.loadout.hull, turret: config.loadout.turret } });
    this.detach.push(
      this.battleEventService.on('death', (e) => {
        const me = this.battleStateService.hasLocal ? this.battleStateService.local.id : 'player';
        const playerKill = e.killerId === me && e.victimId !== me;
        const playerDeath = e.victimId === me;
        if (playerKill) this.kills++;
        if (playerDeath) this.deaths++;
        if (playerKill || playerDeath) {
          benchLog({ kind: 'session-death', tag: this.tag, t: this.seconds(), playerKill, playerDeath, victim: e.victimName, killer: e.killerName, cause: e.cause, kills: this.kills, deaths: this.deaths });
        }
      }),
      this.battleEventService.on('finished', (e) => {
        benchLog({ kind: 'session-end', tag: this.tag, t: this.seconds(), reason: e.reason, kills: this.kills, deaths: this.deaths, kd: this.deaths > 0 ? +(this.kills / this.deaths).toFixed(2) : this.kills });
        for (const off of this.detach) off();
        this.detach = [];
      }),
    );
    this.timer = setInterval(() => {
      if (!this.battleStateService.running) return;
      benchLog({ kind: 'session-tick', tag: this.tag, t: this.seconds(), kills: this.kills, deaths: this.deaths });
    }, HEARTBEAT_MS);
  };

  /** Leaving a battle early still closes the session line (reason 'left'). */
  public end = (): void => {
    if (this.detach.length > 0 && this.battleStateService.running) {
      benchLog({ kind: 'session-end', tag: this.tag, t: this.seconds(), reason: 'left', kills: this.kills, deaths: this.deaths, kd: this.deaths > 0 ? +(this.kills / this.deaths).toFixed(2) : this.kills });
    }
    for (const off of this.detach) off();
    this.detach = [];
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  private seconds(): number {
    return Math.round(this.battleStateService.timeMs / 1000);
  }
}

export default SessionLogService;
