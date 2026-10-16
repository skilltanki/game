// The lobby REST of the backend (apps/server, same origin): the rooms list
// and room creation. Joining a room is the signalling socket's job
// (SignallingService).
//
// At most ONE listing request is in flight: a call made while one runs
// joins it instead of starting another, so a hammered REFRESH chip and the
// rooms screen's 10 s poll (RoomsMenuService) together cost one round trip
// at a time (the owner's requirement).
import type { RoomListing } from '../../../../model/Lobby';
import type { CreateRoomRequest } from '../../../../model/online/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

/** A request that takes longer than this is given up (a phone off the network). */
const REQUEST_TIMEOUT_MS = 6000;

export class LobbyApiService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  /** The listing request in flight, shared by every caller until it settles. */
  private inFlight: Promise<RoomListing[]> | null = null;

  /** True while a listing request is running. */
  public get busy(): boolean {
    return this.inFlight != null;
  }

  /** Open rooms, newest first, of one mode when given. Throws when the lobby cannot be reached. One request at a time. */
  public list = (mode: string | null = null): Promise<RoomListing[]> => {
    if (this.inFlight == null) {
      this.inFlight = this.fetchList(mode).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  };

  /** Creates a room; resolves with its id. The creator still joins over the socket. */
  public create = async (request: CreateRoomRequest): Promise<string> => {
    const response = await this.request('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const body = (await response.json()) as { status: string; id?: string; code?: string; message?: string };
    if (!response.ok || body.id == null) {
      throw new Error(body.message ?? body.code ?? `lobby ${response.status}`);
    }
    this.loggerService.log('room created', body.id, request.mode, request.mapId);
    return body.id;
  };

  private async fetchList(mode: string | null): Promise<RoomListing[]> {
    // Dev layout aid: `?rooms=mock` answers with the fixture (src/bench/mockRooms.ts), every mode.
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('rooms') === 'mock') {
      const { MOCK_ROOMS } = await import('../../../../bench/mockRooms');
      await new Promise((resolve) => setTimeout(resolve, 400));
      this.loggerService.log('lobby listed (mock)', MOCK_ROOMS.length);
      return [...MOCK_ROOMS];
    }
    const response = await this.request(mode != null ? `/api/rooms?mode=${encodeURIComponent(mode)}` : '/api/rooms', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`lobby ${response.status}`);
    }
    const body = (await response.json()) as { status: string; rooms?: RoomListing[] };
    const rooms = body.rooms ?? [];
    this.loggerService.log('lobby listed', rooms.length);
    return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(new URL(path, location.origin).href, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export default LobbyApiService;
