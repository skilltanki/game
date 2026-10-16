// The state a room Durable Object holds between messages. Plain data so the
// room services stay pure functions over it and the store service can
// persist it as is. Sockets are not part of it: the runtime keeps them
// (hibernation) and each socket's attachment names its peerId.
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
  updatedAt: number;
}

export function emptyRoomState(): RoomState {
  return { config: null, peers: new Map(), nextJoinSeq: 1, hostId: null, hostEpoch: 0, phase: 'open', playingSince: null, updatedAt: 0 };
}

/** What a socket remembers about itself across hibernation (<= 2 KiB). */
export interface SocketAttachment {
  peerId: string;
}
