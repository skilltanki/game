// Battle-wide events. Game logic emits plain data; presentation (HUD, sounds,
// ads) subscribes. No HTML strings cross this boundary.
import type { TeamType } from './BattleConfig';

export type BattlePhase = 'idle' | 'loading' | 'playing' | 'paused' | 'over';

export type DeathCause = 'weapon' | 'drown' | 'selfDestruct' | 'blast';

export interface BattleEventMap {
  phase: { phase: BattlePhase };
  /** Someone died. */
  death: { victimId: string; victimName: string; victimTeam: TeamType; killerId: string | null; killerName: string | null; killerTeam: TeamType | null; cause: DeathCause };
  /** Team score changed. */
  teamScore: { red: number; blue: number };
  /** Flag event (CTF / Assault). */
  flag: { kind: 'taken' | 'dropped' | 'returned' | 'delivered'; flag: 'red' | 'blue'; byId: string | null; byName: string | null; byTeam: TeamType | null };
  /** Battle clock. */
  clock: { msLeft: number | null };
  /** The local player's respawn countdown (ms dead; 0 when alive). */
  localDeath: { deadMs: number; respawnInMs: number };
  /** Final whistle. */
  finished: { reason: 'time' | 'left' };
  /** An actor joined or left mid-battle (multiplayer later). */
  roster: { actorId: string; joined: boolean };
}

export type BattleEventName = keyof BattleEventMap;
