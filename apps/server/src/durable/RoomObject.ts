// One room = one Durable Object: the peers, their hibernating WebSockets,
// the host election and the lobby listing. Thin on purpose — every rule
// lives in a lib/api service, this class owns the state, the storage and
// the sockets and wires the two together.
//
// Hibernation: a socket outlives the object's eviction; the runtime wakes
// the object with webSocketMessage/webSocketClose. The constructor runs on
// every wake, so the state is reloaded from storage and each socket knows
// its peer through its attachment. During webSocketClose the closing socket
// is still returned by getWebSockets(): everything that counts or
// broadcasts takes an `except`.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { readParams } from '../config/params';
import { ApiError } from '../model/errors';
import type { ClientMessage, ServerMessage } from '../model/protocol';
import { emptyRoomState, type RoomState, type SocketAttachment } from '../model/room';
import { api } from '../lib/api';
import type { ValidatedRoomRequest } from '../lib/api/services/validation/RoomRequestValidationService';

export class RoomObject extends DurableObject<Env> {
  private state: RoomState = emptyRoomState();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = await api.roomStoreService.load(ctx.storage);
    });
    // Keepalives answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/init') {
      const body = (await request.json()) as ValidatedRoomRequest & { id: string; createdAt: number };
      this.state = emptyRoomState();
      this.state.config = {
        id: body.id,
        mode: body.mode,
        mapId: body.mapId,
        mapName: body.mapName,
        host: body.host,
        maxPlayers: body.maxPlayers,
        durationMs: body.durationMs,
        locked: body.password != null,
        createdAt: body.createdAt,
        password: body.password,
      };
      this.state.updatedAt = body.createdAt;
      await api.roomStoreService.saveConfig(this.ctx.storage, this.state);
      await api.roomStoreService.saveHost(this.ctx.storage, this.state);
      await this.publishListing();
      // A room nobody joins must not live forever either.
      await this.ctx.storage.setAlarm(api.clockService.now() + readParams(this.env).emptyGraceMs);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/ws') {
      if (this.state.config == null) {
        return new Response('room does not exist', { status: 404 });
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/listing') {
      if (this.state.config == null) return new Response('room does not exist', { status: 404 });
      return Response.json(api.roomSnapshotService.listing(this.state, this.connected(), api.clockService.now()));
    }
    if (request.method === 'POST' && url.pathname === '/republish') {
      // The listing goes to the lobby index again (a moved index, a lost write).
      if (this.state.config == null) return new Response('room does not exist', { status: 404 });
      await this.publishListing();
      return Response.json(api.roomSnapshotService.listing(this.state, this.connected(), api.clockService.now()));
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = api.signalMessageValidationService.parse(raw);
    if (msg == null) return;
    const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
    try {
      if (msg.t === 'join') {
        if (attachment != null) throw new ApiError('bad_request', 'already joined');
        await this.onJoin(ws, msg);
        return;
      }
      if (attachment == null) throw new ApiError('bad_request', 'join first');
      await this.onMessage(ws, attachment.peerId, msg);
    } catch (error) {
      if (ApiError.is(error)) {
        this.send(ws, { t: 'error', code: error.code, message: error.message });
        if (msg.t === 'join') ws.close(4000, error.code);
        return;
      }
      api.loggerService.error('roomObject', 'message failed', error);
      this.send(ws, { t: 'error', code: 'internal' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  /** The empty-room grace ran out: still nobody? Then the room is gone. */
  async alarm(): Promise<void> {
    if (this.state.config == null) return;
    if (!api.roomLifecycleService.shouldPurge(this.connected())) return;
    const id = this.state.config.id;
    await api.lobbyIndexService.remove(this.env, id);
    await api.roomStoreService.clear(this.ctx.storage);
    this.state = emptyRoomState();
    api.loggerService.log('roomObject', 'room purged', { id });
  }

  // --- handlers -------------------------------------------------------------

  private async onJoin(ws: WebSocket, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const now = api.clockService.now();
    const { rejoinTtlMs } = readParams(this.env);
    const { peer, rejoined, hostChanged } = api.roomMembershipService.join(this.state, msg, now, rejoinTtlMs);
    // A peer back with its token while its old socket is still here (closing, or
    // dead without a close): the new one carries the seat, the old one is dropped.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && (other.deserializeAttachment() as SocketAttachment | null)?.peerId === peer.peerId) {
        try {
          other.close(4001, 'replaced');
        } catch {
          // already gone
        }
      }
    }
    ws.serializeAttachment({ peerId: peer.peerId } satisfies SocketAttachment);
    await api.roomStoreService.savePeer(this.ctx.storage, peer);
    await api.roomStoreService.saveHost(this.ctx.storage, this.state);
    await this.ctx.storage.deleteAlarm();
    this.send(ws, api.roomSnapshotService.welcome(this.state, peer, await api.iceConfigService.servers(this.env)));
    this.broadcast({ t: 'peerJoined', peer: api.roomSnapshotService.peerInfo(peer), rejoined }, ws);
    if (hostChanged && this.state.hostId != null) {
      this.broadcast({ t: 'hostChanged', hostId: this.state.hostId, hostEpoch: this.state.hostEpoch }, ws);
    }
    await this.publishListing();
  }

  private async onMessage(ws: WebSocket, peerId: string, msg: Exclude<ClientMessage, { t: 'join' }>): Promise<void> {
    switch (msg.t) {
      case 'signal': {
        const { to, message } = api.signalRelayService.relay(this.state, peerId, msg);
        const target = this.socketOf(to);
        if (target != null) this.send(target, message);
        return;
      }
      case 'listing': {
        api.roomLifecycleService.setPhase(this.state, peerId, msg.phase, api.clockService.now());
        await api.roomStoreService.saveHost(this.ctx.storage, this.state);
        await this.publishListing();
        return;
      }
      case 'leave': {
        const { peer, hostChanged } = api.roomMembershipService.leave(this.state, peerId, api.clockService.now());
        if (peer != null) await api.roomStoreService.deletePeer(this.ctx.storage, peer.peerId);
        await api.roomStoreService.saveHost(this.ctx.storage, this.state);
        ws.serializeAttachment(null);
        ws.close(1000, 'left');
        this.broadcast({ t: 'peerLeft', peerId }, ws);
        if (hostChanged && this.state.hostId != null) {
          this.broadcast({ t: 'hostChanged', hostId: this.state.hostId, hostEpoch: this.state.hostEpoch }, ws);
        }
        await this.afterDeparture(ws);
        return;
      }
      default:
        return;
    }
  }

  /** A socket closed or failed: the peer keeps its seat for the rejoin window. */
  private async onGone(ws: WebSocket): Promise<void> {
    const attachment = (ws.deserializeAttachment() ?? null) as SocketAttachment | null;
    if (attachment == null) return;
    // Another socket already carries this peer (a rejoin replaced us): nothing to announce.
    if (this.socketOf(attachment.peerId, ws) != null) return;
    const { peer, hostChanged } = api.roomMembershipService.disconnect(this.state, attachment.peerId, api.clockService.now());
    if (peer != null) await api.roomStoreService.savePeer(this.ctx.storage, peer);
    await api.roomStoreService.saveHost(this.ctx.storage, this.state);
    this.broadcast({ t: 'peerLeft', peerId: attachment.peerId }, ws);
    if (hostChanged && this.state.hostId != null) {
      this.broadcast({ t: 'hostChanged', hostId: this.state.hostId, hostEpoch: this.state.hostEpoch }, ws);
    }
    await this.afterDeparture(ws);
  }

  private async afterDeparture(except: WebSocket): Promise<void> {
    await this.publishListing(except);
    if (api.roomLifecycleService.shouldPurge(this.connected(except))) {
      await this.ctx.storage.setAlarm(api.clockService.now() + readParams(this.env).emptyGraceMs);
    }
  }

  // --- sockets ----------------------------------------------------------------

  private connected(except?: WebSocket): number {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if ((ws.deserializeAttachment() ?? null) != null) n++;
    }
    return n;
  }

  private socketOf(peerId: string, except?: WebSocket): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if ((ws.deserializeAttachment() as SocketAttachment | null)?.peerId === peerId) return ws;
    }
    return null;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // closing socket
    }
  }

  private broadcast(message: ServerMessage, except?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      if ((ws.deserializeAttachment() ?? null) == null) continue;
      try {
        ws.send(data);
      } catch {
        // closing socket
      }
    }
  }

  private async publishListing(except?: WebSocket): Promise<void> {
    if (this.state.config == null) return;
    await api.lobbyIndexService.upsert(this.env, api.roomSnapshotService.listing(this.state, this.connected(except), api.clockService.now()));
  }
}

export default RoomObject;
