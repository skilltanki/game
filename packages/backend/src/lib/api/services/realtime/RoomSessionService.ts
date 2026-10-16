// What the room's Durable Object did in apps/server, over Redis instead:
// create, join (new or back with a token), the socket's messages (signal
// relay, the host's listing, leave) and the socket's end. Every mutation
// runs under the room's lock (RoomStoreService.withLock) and is announced
// through the bus; the rules themselves are the copied room services.
import type { ClientMessage, JoinMessage, RoomListing } from '../../../../model/protocol';
import { emptyRoomState, type RoomSocket, type RoomState } from '../../../../model/room';
import { readParams } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type ClockService from '../base/ClockService';
import type IdService from '../base/IdService';
import type RoomMembershipService from '../room/RoomMembershipService';
import type RoomSnapshotService from '../room/RoomSnapshotService';
import type SignalRelayService from '../room/SignalRelayService';
import type RoomLifecycleService from '../room/RoomLifecycleService';
import type RoomStoreService from '../store/RoomStoreService';
import type LobbyIndexService from '../store/LobbyIndexService';
import type RoomRecordService from '../store/RoomRecordService';
import type ProcessPresenceService from './ProcessPresenceService';
import type SocketRegistryService from './SocketRegistryService';
import type RoomBusService from './RoomBusService';
import type IceConfigService from '../public/IceConfigService';
import type { ValidatedRoomRequest } from '../validation/RoomRequestValidationService';

export class RoomSessionService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly idService = inject<IdService>(TYPES.idService);
  private readonly roomMembershipService = inject<RoomMembershipService>(TYPES.roomMembershipService);
  private readonly roomSnapshotService = inject<RoomSnapshotService>(TYPES.roomSnapshotService);
  private readonly signalRelayService = inject<SignalRelayService>(TYPES.signalRelayService);
  private readonly roomLifecycleService = inject<RoomLifecycleService>(TYPES.roomLifecycleService);
  private readonly roomStoreService = inject<RoomStoreService>(TYPES.roomStoreService);
  private readonly lobbyIndexService = inject<LobbyIndexService>(TYPES.lobbyIndexService);
  private readonly roomRecordService = inject<RoomRecordService>(TYPES.roomRecordService);
  private readonly processPresenceService = inject<ProcessPresenceService>(TYPES.processPresenceService);
  private readonly socketRegistryService = inject<SocketRegistryService>(TYPES.socketRegistryService);
  private readonly roomBusService = inject<RoomBusService>(TYPES.roomBusService);
  private readonly iceConfigService = inject<IceConfigService>(TYPES.iceConfigService);

  /** A new room: its state in Redis, its listing in the lobby (empty, so not browsable yet), its journal entry. Returns the id. */
  public create = async (request: ValidatedRoomRequest): Promise<string> => {
    const now = this.clockService.now();
    const id = this.idService.roomId();
    const state = emptyRoomState();
    state.config = {
      id,
      mode: request.mode,
      mapId: request.mapId,
      mapName: request.mapName,
      host: request.host,
      maxPlayers: request.maxPlayers,
      durationMs: request.durationMs,
      locked: request.password != null,
      createdAt: now,
      password: request.password,
    };
    state.updatedAt = now;
    // A room nobody joins must not live forever either: the grace starts now.
    state.emptySince = now;
    await this.roomStoreService.save(state);
    await this.publishListing(state, now);
    this.roomRecordService.record(state, 0, now);
    this.loggerService.log('roomSessionService', 'room created', { id, mode: request.mode, mapId: request.mapId });
    return id;
  };

  /** A socket's `join`: the seat (new or back with the token), the welcome, the announcements. Returns the peerId. */
  public join = async (roomId: string, msg: JoinMessage, socket: RoomSocket): Promise<string> => {
    // The ICE servers may be minted over the network: outside the lock.
    const iceServers = await this.iceConfigService.servers();
    return this.roomStoreService.withLock(roomId, async () => {
      const now = this.clockService.now();
      const { rejoinTtlMs } = readParams();
      const state = await this.roomStoreService.require(roomId);
      const { peer, rejoined, hostChanged } = this.roomMembershipService.join(state, msg, now, rejoinTtlMs);
      state.emptySince = null;
      await this.roomStoreService.save(state);
      await this.roomStoreService.setSocket(roomId, peer.peerId, { socketId: socket.socketId, processId: this.processPresenceService.id });
      this.socketRegistryService.attach(roomId, peer.peerId, socket);
      socket.send(JSON.stringify(this.roomSnapshotService.welcome(state, peer, iceServers)));
      // A peer back with its token while its old socket is still around (anywhere): the new one carries the seat.
      this.roomBusService.closePeer(roomId, peer.peerId, socket.socketId, 4001, 'replaced');
      this.roomBusService.broadcast(roomId, peer.peerId, { t: 'peerJoined', peer: this.roomSnapshotService.peerInfo(peer), rejoined });
      if (hostChanged && state.hostId != null) {
        this.roomBusService.broadcast(roomId, peer.peerId, { t: 'hostChanged', hostId: state.hostId, hostEpoch: state.hostEpoch });
      }
      await this.publishListing(state, now);
      this.roomRecordService.record(state, this.connected(state), now);
      return peer.peerId;
    });
  };

  /** A joined socket's message. */
  public message = async (roomId: string, peerId: string, msg: Exclude<ClientMessage, { t: 'join' }>, socket: RoomSocket): Promise<void> => {
    switch (msg.t) {
      case 'signal': {
        const state = await this.roomStoreService.require(roomId);
        const { to, message } = this.signalRelayService.relay(state, peerId, msg);
        this.roomBusService.send(roomId, to, message);
        return;
      }
      case 'listing':
        await this.roomStoreService.withLock(roomId, async () => {
          const now = this.clockService.now();
          const state = await this.roomStoreService.require(roomId);
          this.roomLifecycleService.setPhase(state, peerId, msg.phase, now);
          await this.roomStoreService.save(state);
          await this.publishListing(state, now);
          this.roomRecordService.record(state, this.connected(state), now);
        });
        return;
      case 'leave':
        await this.roomStoreService.withLock(roomId, async () => {
          const now = this.clockService.now();
          const state = await this.roomStoreService.load(roomId);
          if (state == null) return;
          const { peer, hostChanged } = this.roomMembershipService.leave(state, peerId, now);
          await this.roomStoreService.clearSocket(roomId, peerId, socket.socketId);
          this.socketRegistryService.detach(roomId, peerId, socket.socketId);
          socket.close(1000, 'left');
          if (peer != null) {
            this.roomBusService.broadcast(roomId, peerId, { t: 'peerLeft', peerId });
            if (hostChanged && state.hostId != null) {
              this.roomBusService.broadcast(roomId, peerId, { t: 'hostChanged', hostId: state.hostId, hostEpoch: state.hostEpoch });
            }
          }
          await this.afterDeparture(state, now);
        });
        return;
      default:
        return;
    }
  };

  /** A socket closed or failed: the peer keeps its seat for the rejoin window — unless another socket took the seat meanwhile. */
  public gone = async (roomId: string, peerId: string, socketId: string): Promise<void> => {
    this.socketRegistryService.detach(roomId, peerId, socketId);
    const current = await this.roomStoreService.socketOf(roomId, peerId);
    if (current !== socketId) return;
    await this.roomStoreService.withLock(roomId, async () => {
      const now = this.clockService.now();
      const state = await this.roomStoreService.load(roomId);
      if (state == null) return;
      // Re-checked under the lock: a join may have replaced the socket while we waited.
      if ((await this.roomStoreService.socketOf(roomId, peerId)) !== socketId) return;
      const { peer, hostChanged } = this.roomMembershipService.disconnect(state, peerId, now);
      await this.roomStoreService.clearSocket(roomId, peerId, socketId);
      if (peer != null) {
        this.roomBusService.broadcast(roomId, peerId, { t: 'peerLeft', peerId });
        if (hostChanged && state.hostId != null) {
          this.roomBusService.broadcast(roomId, peerId, { t: 'hostChanged', hostId: state.hostId, hostEpoch: state.hostEpoch });
        }
      }
      await this.afterDeparture(state, now);
    });
  };

  /** The room writes its listing to the lobby again (idempotent; migrate/ and a lost write). */
  public republish = async (roomId: string): Promise<RoomListing> => {
    const now = this.clockService.now();
    const state = await this.roomStoreService.require(roomId);
    const listing = this.roomSnapshotService.listing(state, this.connected(state), now);
    await this.lobbyIndexService.upsert(listing);
    return listing;
  };

  /**
   * The sweeper's call, under the room's lock: a connected seat whose socket
   * sits on a process that stopped beating died without a close — it goes
   * the way a closed socket goes (peerLeft, the host election). Returns
   * true when a seat was let go.
   */
  public reapDeadSockets = async (roomId: string, state: RoomState, now: number): Promise<boolean> => {
    const sockets = await this.roomStoreService.sockets(roomId);
    let reaped = false;
    for (const peer of [...state.peers.values()]) {
      if (!peer.connected) continue;
      const record = sockets.get(peer.peerId);
      // No socket on record for a connected seat (the join crashed between the two writes) counts as dead too.
      const alive = record != null && record.processId !== '' && (await this.processPresenceService.alive(record.processId));
      if (alive) continue;
      const { hostChanged } = this.roomMembershipService.disconnect(state, peer.peerId, now);
      if (record != null) await this.roomStoreService.clearSocket(roomId, peer.peerId, record.socketId);
      this.roomBusService.broadcast(roomId, peer.peerId, { t: 'peerLeft', peerId: peer.peerId });
      if (hostChanged && state.hostId != null) {
        this.roomBusService.broadcast(roomId, peer.peerId, { t: 'hostChanged', hostId: state.hostId, hostEpoch: state.hostEpoch });
      }
      this.loggerService.warn('roomSessionService', 'seat reaped: its process is gone', { roomId, peerId: peer.peerId, processId: record?.processId ?? null });
      reaped = true;
    }
    return reaped;
  };

  // --- internals -------------------------------------------------------------------

  public connected = (state: RoomState): number => this.roomMembershipService.connectedCount(state);

  /** The room's listing to the lobby index, as it stands now. */
  public publishListing = async (state: RoomState, now: number): Promise<void> => {
    await this.lobbyIndexService.upsert(this.roomSnapshotService.listing(state, this.connected(state), now));
  };

  private async afterDeparture(state: RoomState, now: number): Promise<void> {
    if (this.connected(state) === 0 && state.emptySince == null) {
      // Nobody left: the sweeper purges the room after the grace.
      state.emptySince = now;
    }
    await this.roomStoreService.save(state);
    await this.publishListing(state, now);
    this.roomRecordService.record(state, this.connected(state), now);
  }
}

export default RoomSessionService;
