// Checks and clamps what `POST /api/rooms` sends (the old lobby's rules,
// players capped by the mesh size). Returns the room's configuration minus
// what the Durable Object adds (id, createdAt).
import { CC_ROOM_LIMITS } from '../../../../config/params';
import { ApiError } from '../../../../model/errors';
import type { BattleModeId, CreateRoomRequest } from '../../../../model/protocol';

const MODES: BattleModeId[] = ['dm', 'tdm', 'ctf', 'assault'];

export interface ValidatedRoomRequest {
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  host: string;
  maxPlayers: number;
  durationMs: number | null;
  password: string | null;
}

export class RoomRequestValidationService {
  public parseCreate = (body: unknown): ValidatedRoomRequest => {
    const b = (body ?? {}) as Partial<CreateRoomRequest>;
    if (typeof b.mode !== 'string' || !MODES.includes(b.mode as BattleModeId)) {
      throw new ApiError('bad_request', 'mode must be one of dm, tdm, ctf, assault');
    }
    if (typeof b.mapId !== 'string' || !/^[a-z0-9_]+$/.test(b.mapId)) {
      throw new ApiError('bad_request', 'mapId is required');
    }
    if (typeof b.mapName !== 'string' || b.mapName.trim() === '') {
      throw new ApiError('bad_request', 'mapName is required');
    }
    if (typeof b.host !== 'string' || b.host.trim() === '') {
      throw new ApiError('bad_request', 'host is required');
    }
    const mode = b.mode as BattleModeId;
    const wanted = typeof b.maxPlayers === 'number' ? Math.trunc(b.maxPlayers) : CC_ROOM_LIMITS.defaultPlayers[mode];
    const maxPlayers = Math.max(CC_ROOM_LIMITS.minPlayers, Math.min(CC_ROOM_LIMITS.maxPlayers, wanted));
    const durationMs =
      typeof b.durationMs === 'number'
        ? Math.max(CC_ROOM_LIMITS.minDurationMs, Math.min(CC_ROOM_LIMITS.maxDurationMs, Math.trunc(b.durationMs)))
        : null;
    const password = typeof b.password === 'string' && b.password.trim() !== '' ? b.password.trim().slice(0, CC_ROOM_LIMITS.maxPasswordLength) : null;
    return {
      mode,
      mapId: b.mapId,
      mapName: b.mapName.trim().slice(0, CC_ROOM_LIMITS.maxMapNameLength),
      host: b.host.trim().slice(0, CC_ROOM_LIMITS.maxNameLength),
      maxPlayers,
      durationMs,
      password,
    };
  };
}

export default RoomRequestValidationService;
