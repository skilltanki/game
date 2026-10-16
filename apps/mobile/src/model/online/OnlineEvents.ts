// What the room session tells the UI (the lobby screen) and the battle.
// Plain data, no DOM.
import type { BattleModeId } from '../BattleConfig';
import type { LobbyRoom } from '../Lobby';
import type { OnlineSeat } from './wire';

/** Where the local player stands with the room. */
export type SessionPhase = 'idle' | 'connecting' | 'lobby' | 'battle';

/** What the host decided when it pressed START (or what a late joiner is told). */
export interface OnlineStart {
  roomId: string;
  localPeerId: string;
  hostId: string;
  hostEpoch: number;
  mode: BattleModeId;
  mapId: string;
  seed: number;
  durationMs: number | null;
  seats: OnlineSeat[];
  botDifficulty: 'easy' | 'normal' | 'hard';
}

export interface OnlineEventMap {
  /** The room changed (a peer came or went, ready flags, host, link state): redraw. */
  room: { room: LobbyRoom | null; phase: SessionPhase };
  /** The battle starts for everyone seated. */
  start: OnlineStart;
  /** The host changed (the old one left); the epoch grows. */
  host: { hostId: string; hostEpoch: number };
  /** A peer's seat appeared or vanished while a battle runs. */
  peer: { peerId: string; joined: boolean; seat: OnlineSeat | null };
  /** A seat changed hands (the host's word): a bot's brain moves to `owner`, or a player is back on it. */
  seat: { id: string; bot: boolean; owner: string | null };
  /** Something the player should see (a failed join, a dropped connection). */
  error: { code: string; message: string };
  /** The session ended (we left, the room died, the socket gave up). */
  left: { reason: string };
}

export type OnlineEventName = keyof OnlineEventMap;
