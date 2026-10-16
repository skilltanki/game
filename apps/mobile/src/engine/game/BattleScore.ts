// Kills, deaths and the team score — the one place a death is recorded.
//
// This used to be open-coded in four places in main.ts (weapon kill, drowning,
// self-destruct, wreck blast), each repeating "bump the frag, bump the team
// score, refresh the HUD, write the kill log" with slightly different details.
// A death is exactly the kind of event a server will own, so it gets a single
// entry point here rather than four call sites to keep in sync.

import type { GameTank } from './GameTank';
import type { TeamType } from '../tank/Tank';
import { TankState } from './TankRoster';

export interface PlayerStats {
  name: string;
  frags: number;
  deaths: number;
}

/** How a tank died, which decides the kill-log wording. */
export type DeathCause = 'weapon' | 'drown' | 'selfDestruct' | 'blast';

export interface DeathEvent {
  victim: GameTank;
  /** Who gets the frag; null when nobody earned it (a lone drowning). */
  killer: GameTank | null;
  cause: DeathCause;
}

export class BattleScore {
  readonly stats = new TankState<PlayerStats>();
  readonly teamScore: Record<'red' | 'blue', number> = { red: 0, blue: 0 };

  /** Called whenever the score changes, so the HUD can redraw. */
  onChange: ((red: number, blue: number) => void) | null = null;
  /** Called with a ready-to-display kill-log line. */
  onLogMessage: ((message: string) => void) | null = null;
  /**
   * Called for every death, before the log line. Modes that react to a tank
   * dying (CTF dropping a carried flag) hook this instead of each of the four
   * death call sites.
   */
  onDeath: ((event: DeathEvent) => void) | null = null;
  /** Renders a tank's name tag; injected so this module owns no styling. */
  nameTag: (gameTank: GameTank | null) => string = (t) => t?.name ?? '???';

  register(gameTank: GameTank): void {
    this.stats.set(gameTank, { name: gameTank.name, frags: 0, deaths: 0 });
  }

  /** A tank left the battle: its row leaves the Tab table and the results. */
  unregister(gameTank: GameTank): void {
    this.stats.delete(gameTank);
  }

  statsOf(gameTank: GameTank): PlayerStats | undefined {
    return this.stats.get(gameTank);
  }

  /**
   * Records one death: the victim's death count, the killer's frag, the team
   * score and the kill-log line. Every death path funnels through here.
   */
  recordDeath(event: DeathEvent): void {
    const { victim, killer, cause } = event;
    const victimStats = this.stats.get(victim);
    if (victimStats != null) {
      victimStats.deaths++;
    }
    // A tank killing itself earns nothing.
    if (killer != null && killer !== victim) {
      const killerStats = this.stats.get(killer);
      if (killerStats != null) {
        killerStats.frags++;
      }
      this.addTeamPoint(killer.tank.team);
    }
    this.onDeath?.(event);
    this.onLogMessage?.(this.describe(event));
  }

  /**
   * Server reconciliation: a multiplayer snapshot carries absolute counters,
   * which override whatever this client tallied locally.
   */
  setStats(gameTank: GameTank, frags: number, deaths: number): void {
    const stats = this.stats.get(gameTank);
    if (stats != null) {
      stats.frags = frags;
      stats.deaths = deaths;
    }
    this.onChange?.(this.teamScore.red, this.teamScore.blue);
  }

  /** Server reconciliation: the authoritative team score, applied absolutely. */
  setTeamScore(red: number, blue: number): void {
    this.teamScore.red = red;
    this.teamScore.blue = blue;
    this.onChange?.(red, blue);
  }

  /** Team score only, for kills credited to a team rather than a tank. */
  addTeamPoint(team: TeamType): void {
    if (team === 'red' || team === 'blue') {
      this.teamScore[team]++;
      this.onChange?.(this.teamScore.red, this.teamScore.blue);
    }
  }

  private describe({ victim, killer, cause }: DeathEvent): string {
    const grey = (word: string): string => `<span style="color:#ccc">${word}</span>`;
    const v = this.nameTag(victim);
    if (cause === 'selfDestruct') {
      if (killer == null || killer === victim) {
        return `${v} ${grey('self-destructed')}`;
      }
      return (
        `${v} ${grey('self-destructed')}` +
        ` <span style="color:#fff">(kill for </span> ${this.nameTag(killer)}<span style="color:#fff">)</span>`
      );
    }
    if (killer == null || killer === victim) {
      return cause === 'drown' ? `${v} ${grey('drowned')}` : `${v} ${grey('died')}`;
    }
    const verb = cause === 'drown' ? 'drowned' : cause === 'blast' ? 'blew up' : 'destroyed';
    return `${this.nameTag(killer)} ${grey(verb)} ${v}`;
  }
}
