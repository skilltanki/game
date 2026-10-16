// Who is in the room: join (new or back with a token), leave, host
// election. Pure over RoomState; the Durable Object persists what changed
// and talks to the sockets.
import { ApiError } from '../../../../model/errors';
import type { JoinMessage, TeamName } from '../../../../model/protocol';
import type { PeerRecord, RoomState } from '../../../../model/room';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type IdService from '../base/IdService';

export interface JoinResult {
  peer: PeerRecord;
  rejoined: boolean;
  /** True when this join made the peer the host (first in, or the old host gone). */
  hostChanged: boolean;
}

export interface LeaveResult {
  peer: PeerRecord | null;
  hostChanged: boolean;
}

export class RoomMembershipService {
  private readonly idService = inject<IdService>(TYPES.idService);

  public join = (state: RoomState, msg: JoinMessage, now: number, rejoinTtlMs: number): JoinResult => {
    const config = state.config;
    if (config == null) throw new ApiError('room_not_found');
    if (state.phase === 'finished') throw new ApiError('finished');
    if (config.password != null && msg.token == null && msg.password !== config.password) throw new ApiError('bad_password');
    this.prune(state, now, rejoinTtlMs);

    // Back with a token: the same seat, the same peerId (the others renegotiate).
    // The token is the seat's secret, so its bearer IS the player — even while
    // the old socket still reads as connected (a reloaded page, a phone whose
    // radio died: the close may reach us late or never); the object drops it.
    if (msg.token != null) {
      const known = [...state.peers.values()].find((p) => p.token === msg.token);
      if (known == null) throw new ApiError('bad_token');
      known.connected = true;
      known.lastSeenAt = now;
      known.name = msg.name;
      known.hull = msg.hull;
      known.turret = msg.turret;
      known.paint = msg.paint ?? null;
      known.team = this.balancedTeam(state, msg.team ?? known.team, known.peerId);
      state.updatedAt = now;
      return { peer: known, rejoined: true, hostChanged: this.electHost(state) };
    }

    if (this.connectedCount(state) >= config.maxPlayers) throw new ApiError('room_full');
    const peer: PeerRecord = {
      peerId: this.idService.peerId(),
      name: msg.name,
      hull: msg.hull,
      turret: msg.turret,
      paint: msg.paint ?? null,
      team: this.balancedTeam(state, msg.team ?? null, null),
      joinSeq: state.nextJoinSeq++,
      connected: true,
      token: this.idService.token(),
      lastSeenAt: now,
    };
    state.peers.set(peer.peerId, peer);
    state.updatedAt = now;
    return { peer, rejoined: false, hostChanged: this.electHost(state) };
  };

  /**
   * A seat that asked for a side gets it — friends sort their own teams. A
   * seat with no wish lands on the emptier side (the mobile client joins
   * without one and lets the player switch in the lobby). Deathmatch seats
   * carry no side.
   */
  private balancedTeam(state: RoomState, wanted: TeamName | null, selfId: string | null): TeamName | null {
    const mode = state.config?.mode;
    if (mode !== 'tdm' && mode !== 'ctf' && mode !== 'assault') return null;
    if (wanted != null) return wanted;
    let red = 0;
    let blue = 0;
    for (const p of state.peers.values()) {
      if (!p.connected || p.peerId === selfId) continue;
      if (p.team === 'red') red++;
      else if (p.team === 'blue') blue++;
    }
    return red <= blue ? 'red' : 'blue';
  }

  /** A socket closed: the peer stays (for a rejoin) but no longer counts; the host may move. */
  public disconnect = (state: RoomState, peerId: string, now: number): LeaveResult => {
    const peer = state.peers.get(peerId) ?? null;
    if (peer == null) return { peer: null, hostChanged: false };
    peer.connected = false;
    peer.lastSeenAt = now;
    state.updatedAt = now;
    return { peer, hostChanged: this.electHost(state) };
  };

  /** An explicit leave: the seat is given up, no rejoin. */
  public leave = (state: RoomState, peerId: string, now: number): LeaveResult => {
    const peer = state.peers.get(peerId) ?? null;
    if (peer == null) return { peer: null, hostChanged: false };
    state.peers.delete(peerId);
    state.updatedAt = now;
    return { peer, hostChanged: this.electHost(state) };
  };

  public connectedCount = (state: RoomState): number => {
    let n = 0;
    for (const p of state.peers.values()) if (p.connected) n++;
    return n;
  };

  /** Peers whose rejoin window closed are dropped for good. */
  public prune = (state: RoomState, now: number, rejoinTtlMs: number): string[] => {
    const gone: string[] = [];
    for (const [id, p] of state.peers) {
      if (!p.connected && now - p.lastSeenAt > rejoinTtlMs) {
        state.peers.delete(id);
        gone.push(id);
      }
    }
    return gone;
  };

  /**
   * The host keeps the seat while connected (a returning earlier peer does not
   * take it back — authority must not flip-flop); only when the host is gone
   * is the connected peer with the lowest joinSeq promoted, and the epoch grows.
   */
  private electHost(state: RoomState): boolean {
    if (state.hostId != null && state.peers.get(state.hostId)?.connected) return false;
    let best: PeerRecord | null = null;
    for (const p of state.peers.values()) {
      if (p.connected && (best == null || p.joinSeq < best.joinSeq)) best = p;
    }
    const nextId = best?.peerId ?? null;
    if (nextId === state.hostId) return false;
    state.hostId = nextId;
    if (nextId != null) state.hostEpoch += 1;
    return nextId != null;
  }
}

export default RoomMembershipService;
