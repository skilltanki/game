// What the processes tell each other over Redis pub/sub (one channel for
// all rooms): a server message for one peer or for everyone in a room, or an
// order to close a peer's sockets (its seat was taken over by a new socket,
// possibly on another process). Every process receives every event and acts
// on the sockets it holds.
import type { ServerMessage } from '../model/protocol';

export interface RoomEventContract {
  topic: 'room-event';
  data: {
    roomId: string;
    /** A peer, or null for everyone in the room. */
    to: string | null;
    /** Skipped when broadcasting (the sender of a peerJoined / peerLeft). */
    except: string | null;
    message: ServerMessage;
  };
}

export interface RoomCloseContract {
  topic: 'room-close';
  data: {
    roomId: string;
    peerId: string;
    /** The socket that stays (the one that just joined); every other socket of the peer closes. */
    exceptSocketId: string | null;
    code: number;
    reason: string;
  };
}

export type RoomBusMessage = RoomEventContract | RoomCloseContract;
