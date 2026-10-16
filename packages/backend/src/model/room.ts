// The state of a room between messages, as it lives in Redis (one JSON
// document per room, read and written under the room's lock). Plain data,
// so the room services stay pure functions over it — the same services as
// apps/server's Durable Object used. Sockets are not part of it: every
// process keeps its own (SocketRegistryService) and Redis pub/sub carries the
// messages between processes.
import type { PeerInfo, RoomConfig, RoomPhase } from './protocol';

export interface PeerRecord extends PeerInfo {
  /** Rejoin secret, never sent to anyone but its owner. */
  token: string;
  /** Last time the peer was seen connected (for the rejoin TTL). */
  lastSeenAt: number;
}

export interface RoomState {
  config: (RoomConfig & { password: string | null }) | null;
  peers: Map<string, PeerRecord>;
  nextJoinSeq: number;
  hostId: string | null;
  hostEpoch: number;
  phase: RoomPhase;
  /** When the host last said `playing` (START, then the first kill — the battle clock's start); null while open. */
  playingSince: number | null;
  /** Since when nobody has been connected (the purge comes emptyGraceMs later); null while someone is. */
  emptySince: number | null;
  updatedAt: number;
}

export function emptyRoomState(): RoomState {
  return { config: null, peers: new Map(), nextJoinSeq: 1, hostId: null, hostEpoch: 0, phase: 'open', playingSince: null, emptySince: null, updatedAt: 0 };
}

/** The JSON shape of a RoomState in Redis (a Map does not serialize). */
export interface RoomStateJson extends Omit<RoomState, 'peers'> {
  peers: PeerRecord[];
}

export function toJson(state: RoomState): RoomStateJson {
  return { ...state, peers: [...state.peers.values()] };
}

export function fromJson(json: RoomStateJson): RoomState {
  return { ...json, peers: new Map(json.peers.map((p) => [p.peerId, p])) };
}

/** What a socket is for the room: its process-local identity, where to send, how to close. */
export interface RoomSocket {
  /** Unique per socket across processes (a UUID): tells a replaced socket from the one that replaced it. */
  socketId: string;
  send(text: string): void;
  close(code: number, reason: string): void;
}
