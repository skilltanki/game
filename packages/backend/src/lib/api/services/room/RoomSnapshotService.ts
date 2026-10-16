// What the room looks like from outside: the public view of a peer, the
// `welcome` for a newcomer and the lobby listing. Strips the secrets
// (tokens, password).
import type { IceServer, PeerInfo, RoomConfig, RoomListing, WelcomeMessage } from '../../../../model/protocol';
import type { PeerRecord, RoomState } from '../../../../model/room';

export class RoomSnapshotService {
  public peerInfo = (peer: PeerRecord): PeerInfo => ({
    peerId: peer.peerId,
    name: peer.name,
    hull: peer.hull,
    turret: peer.turret,
    paint: peer.paint,
    team: peer.team,
    joinSeq: peer.joinSeq,
    connected: peer.connected,
  });

  public config = (state: RoomState): RoomConfig => {
    const c = state.config;
    if (c == null) throw new Error('room has no config');
    return {
      id: c.id,
      mode: c.mode,
      mapId: c.mapId,
      mapName: c.mapName,
      host: c.host,
      maxPlayers: c.maxPlayers,
      durationMs: c.durationMs,
      locked: c.password != null,
      createdAt: c.createdAt,
    };
  };

  public welcome = (state: RoomState, me: PeerRecord, iceServers: IceServer[]): WelcomeMessage => ({
    t: 'welcome',
    peerId: me.peerId,
    token: me.token,
    me: this.peerInfo(me),
    hostId: state.hostId ?? me.peerId,
    hostEpoch: state.hostEpoch,
    peers: [...state.peers.values()].filter((p) => p.peerId !== me.peerId).map(this.peerInfo),
    iceServers,
    room: this.config(state),
  });

  public listing = (state: RoomState, players: number, now: number): RoomListing => {
    const c = this.config(state);
    return {
      id: c.id,
      mode: c.mode,
      mapId: c.mapId,
      mapName: c.mapName,
      host: c.host,
      players,
      maxPlayers: c.maxPlayers,
      phase: state.phase,
      locked: c.locked,
      createdAt: c.createdAt,
      updatedAt: now,
      playingSince: state.playingSince,
      durationMs: c.durationMs,
    };
  };
}

export default RoomSnapshotService;
