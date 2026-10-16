// What the multiplayer forms work with: the lobby listing the backend
// publishes, the draft of a room being created, and the room a player sits
// in while the lobby fills up. The wire shapes are a COPY of
// apps/server/src/model/protocol.ts (CLAUDE.md rule 10: no imports between
// packages) and are kept in step by hand.
import type { BattleModeId } from '../engine/game/BattleMode';
import type { TeamSide } from './BattleConfig';

/** Against the bots on this phone, or in a room with other players. */
export type PlaySide = 'single' | 'multi';

/** The modes a room can be opened in (explore is a solo drive). */
export const MULTIPLAYER_MODES: BattleModeId[] = ['dm', 'tdm', 'ctf', 'assault'];

export type RoomPhase = 'open' | 'playing' | 'finished';

/** A room as the lobby shows it (protocol.ts `RoomListing`; never carries the password). */
export interface RoomListing {
  id: string;
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  host: string;
  players: number;
  maxPlayers: number;
  phase: RoomPhase;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  /** When the battle clock (re)started (null while open) and the battle's length, ms. */
  playingSince: number | null;
  durationMs: number | null;
}

/** The create form's values (protocol.ts `CreateRoomRequest` plus the UI's minutes). */
export interface RoomDraft {
  name: string;
  password: string;
  mode: BattleModeId;
  mapId: string;
  maxPlayers: number;
  durationMin: number;
}

/** One seat in the lobby (protocol.ts `PeerInfo` as the lobby screen needs it). */
export interface LobbyPeer {
  peerId: string;
  name: string;
  hull: string;
  turret: string;
  team: TeamSide | null;
  isHost: boolean;
  isLocal: boolean;
  /** Pressed READY (guests; the host starts instead). */
  ready: boolean;
  /** The DataChannel to this peer is open (the local seat is always linked). */
  linked: boolean;
}

/** The room the local player is sitting in while it fills up. */
export interface LobbyRoom {
  id: string;
  name: string;
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  maxPlayers: number;
  durationMin: number;
  locked: boolean;
  peers: LobbyPeer[];
}
