// Persists a RoomState in the Durable Object's storage and loads it back on
// wake. Small keys: `config`, `host`, `peer:<id>`; peers are the only thing
// that changes often and each change touches one key.
import type { PeerRecord, RoomState } from '../../../../model/room';
import { emptyRoomState } from '../../../../model/room';

interface HostRecord {
  hostId: string | null;
  hostEpoch: number;
  nextJoinSeq: number;
  phase: RoomState['phase'];
  playingSince?: number | null;
  updatedAt: number;
}

export class RoomStoreService {
  public load = async (storage: DurableObjectStorage): Promise<RoomState> => {
    const state = emptyRoomState();
    const config = await storage.get<RoomState['config']>('config');
    if (config == null) return state;
    state.config = config;
    const host = await storage.get<HostRecord>('host');
    if (host != null) {
      state.hostId = host.hostId;
      state.hostEpoch = host.hostEpoch;
      state.nextJoinSeq = host.nextJoinSeq;
      state.phase = host.phase;
      state.playingSince = host.playingSince ?? null;
      state.updatedAt = host.updatedAt;
    }
    for (const [key, peer] of await storage.list<PeerRecord>({ prefix: 'peer:' })) {
      state.peers.set(key.slice('peer:'.length), peer);
    }
    return state;
  };

  public saveConfig = async (storage: DurableObjectStorage, state: RoomState): Promise<void> => {
    await storage.put('config', state.config);
  };

  public saveHost = async (storage: DurableObjectStorage, state: RoomState): Promise<void> => {
    const record: HostRecord = {
      hostId: state.hostId,
      hostEpoch: state.hostEpoch,
      nextJoinSeq: state.nextJoinSeq,
      phase: state.phase,
      playingSince: state.playingSince,
      updatedAt: state.updatedAt,
    };
    await storage.put('host', record);
  };

  public savePeer = async (storage: DurableObjectStorage, peer: PeerRecord): Promise<void> => {
    await storage.put(`peer:${peer.peerId}`, peer);
  };

  public deletePeer = async (storage: DurableObjectStorage, peerId: string): Promise<void> => {
    await storage.delete(`peer:${peerId}`);
  };

  public clear = async (storage: DurableObjectStorage): Promise<void> => {
    await storage.deleteAll();
  };
}

export default RoomStoreService;
