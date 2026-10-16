// The wire contract of the backend: lobby REST bodies and the signalling
// socket's JSON messages. Pure types, no imports — a client copies this file
// into its own package (CLAUDE.md rule 10: no imports between packages).
//
// Realtime model: the backend only matches peers and relays WebRTC
// signalling. The players then hold a full mesh of DataChannels (one per
// pair, <= 8 peers) and exchange tank commands directly; the HOST peer (the
// lowest joinSeq alive) is the authority for damage, deaths, flags and the
// clock. When the host leaves, the next peer in joinSeq order becomes host
// and `hostEpoch` grows; peers drop authority messages carrying an old epoch.
// On one LAN the ICE host candidates connect the phones without any server
// traffic in the battle; STUN/TURN from /api/ice cover the rest.

export type BattleModeId = 'dm' | 'tdm' | 'ctf' | 'assault';
export type TeamName = 'red' | 'blue';
export type RoomPhase = 'open' | 'playing' | 'finished';

/** What `POST /api/rooms` takes. */
export interface CreateRoomRequest {
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  /** Call sign of the creator (listing only; the creator still joins over the socket). */
  host: string;
  maxPlayers?: number;
  durationMs?: number;
  password?: string;
}

/** A room as the lobby shows it (never carries the password). */
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
  /** When the battle clock (re)started: the host's `listing playing` at START and again at the first kill; null while open. */
  playingSince: number | null;
  /** The battle's length, ms (null: the default). A playing room older than playingSince + durationMs is over for the lobby. */
  durationMs: number | null;
}

/** The room's own configuration, as sent in `welcome`. */
export interface RoomConfig {
  id: string;
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  host: string;
  maxPlayers: number;
  durationMs: number | null;
  locked: boolean;
  createdAt: number;
}

export interface PeerInfo {
  peerId: string;
  name: string;
  hull: string;
  turret: string;
  paint: string | null;
  team: TeamName | null;
  /** Join order; the lowest connected one is the host. */
  joinSeq: number;
  connected: boolean;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type SignalKind = 'offer' | 'answer' | 'ice';

// --- client -> server ---------------------------------------------------------

export interface JoinMessage {
  t: 'join';
  name: string;
  hull: string;
  turret: string;
  paint?: string;
  team?: TeamName;
  password?: string;
  /** From an earlier `welcome`: resume the same peerId after a reconnect. */
  token?: string;
}

export interface SignalMessage {
  t: 'signal';
  to: string;
  kind: SignalKind;
  /** The RTCSessionDescriptionInit or RTCIceCandidateInit, passed through untouched. */
  payload: unknown;
}

/** The host refreshes the lobby listing (phase changes, player count after a mesh change). */
export interface ListingMessage {
  t: 'listing';
  phase: RoomPhase;
}

export interface LeaveMessage {
  t: 'leave';
}

export type ClientMessage = JoinMessage | SignalMessage | ListingMessage | LeaveMessage;

// --- server -> client ---------------------------------------------------------

export interface WelcomeMessage {
  t: 'welcome';
  peerId: string;
  /** Rejoin token; keep it for a reconnect within the room's rejoin TTL. */
  token: string;
  /** The joiner's own seat as the room assigned it (the team may differ from the one asked for: sides are kept within one of each other). */
  me: PeerInfo;
  hostId: string;
  hostEpoch: number;
  /** Everyone already in the room (not including the newcomer). */
  peers: PeerInfo[];
  iceServers: IceServer[];
  room: RoomConfig;
}

export interface PeerJoinedMessage {
  t: 'peerJoined';
  peer: PeerInfo;
  /** True when a known peer came back with its token (its old connections are gone — renegotiate). */
  rejoined: boolean;
}

export interface PeerLeftMessage {
  t: 'peerLeft';
  peerId: string;
}

export interface RelayedSignalMessage {
  t: 'signal';
  from: string;
  kind: SignalKind;
  payload: unknown;
}

export interface HostChangedMessage {
  t: 'hostChanged';
  hostId: string;
  hostEpoch: number;
}

export interface ErrorMessage {
  t: 'error';
  code: string;
  message?: string;
}

export type ServerMessage =
  | WelcomeMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | RelayedSignalMessage
  | HostChangedMessage
  | ErrorMessage;
