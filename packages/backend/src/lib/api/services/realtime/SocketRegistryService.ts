// The sockets THIS process holds, by room and peer (a peer may briefly hold
// two: the one being replaced and its successor). Delivery from the bus
// lands here: a message for one peer goes to its sockets here, a broadcast
// to every socket of the room here; other processes do the same with
// theirs.
import type { RoomSocket } from '../../../../model/room';

export class SocketRegistryService {
  private readonly rooms = new Map<string, Map<string, Map<string, RoomSocket>>>();

  public attach = (roomId: string, peerId: string, socket: RoomSocket): void => {
    let peers = this.rooms.get(roomId);
    if (peers == null) this.rooms.set(roomId, (peers = new Map()));
    let sockets = peers.get(peerId);
    if (sockets == null) peers.set(peerId, (sockets = new Map()));
    sockets.set(socket.socketId, socket);
  };

  public detach = (roomId: string, peerId: string, socketId: string): void => {
    const peers = this.rooms.get(roomId);
    const sockets = peers?.get(peerId);
    if (peers == null || sockets == null) return;
    sockets.delete(socketId);
    if (sockets.size === 0) peers.delete(peerId);
    if (peers.size === 0) this.rooms.delete(roomId);
  };

  public send = (roomId: string, peerId: string, text: string): void => {
    for (const socket of this.rooms.get(roomId)?.get(peerId)?.values() ?? []) this.trySend(socket, text);
  };

  public broadcast = (roomId: string, except: string | null, text: string): void => {
    for (const [peerId, sockets] of this.rooms.get(roomId) ?? []) {
      if (peerId === except) continue;
      for (const socket of sockets.values()) this.trySend(socket, text);
    }
  };

  /** Closes every socket of the peer held here but `exceptSocketId` (the seat's new carrier). */
  public closePeer = (roomId: string, peerId: string, exceptSocketId: string | null, code: number, reason: string): void => {
    for (const socket of [...(this.rooms.get(roomId)?.get(peerId)?.values() ?? [])]) {
      if (socket.socketId === exceptSocketId) continue;
      try {
        socket.close(code, reason);
      } catch {
        // already gone
      }
      this.detach(roomId, peerId, socket.socketId);
    }
  };

  /** How many sockets this process holds in the room (diagnostics). */
  public count = (roomId: string): number => {
    let n = 0;
    for (const sockets of this.rooms.get(roomId)?.values() ?? []) n += sockets.size;
    return n;
  };

  /** How many sockets this process holds in all. */
  public total = (): number => {
    let n = 0;
    for (const peers of this.rooms.values()) for (const sockets of peers.values()) n += sockets.size;
    return n;
  };

  /** Every socket held here, with its room and peer (a shutdown walks them). */
  public entries = (): { roomId: string; peerId: string; socket: RoomSocket }[] => {
    const out: { roomId: string; peerId: string; socket: RoomSocket }[] = [];
    for (const [roomId, peers] of this.rooms) {
      for (const [peerId, sockets] of peers) {
        for (const socket of sockets.values()) out.push({ roomId, peerId, socket });
      }
    }
    return out;
  };

  private trySend(socket: RoomSocket, text: string): void {
    try {
      socket.send(text);
    } catch {
      // closing socket
    }
  }
}

export default SocketRegistryService;
