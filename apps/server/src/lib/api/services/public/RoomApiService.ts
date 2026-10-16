// The lobby REST behind the routes: create a room (its Durable Object gets
// the config, the lobby index gets the listing), get one, list them.
import type { Env } from '../../../../env';
import { ApiError } from '../../../../model/errors';
import type { RoomListing } from '../../../../model/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type ClockService from '../base/ClockService';
import type IdService from '../base/IdService';
import type LoggerService from '../base/LoggerService';
import type RoomRequestValidationService from '../validation/RoomRequestValidationService';
import type LobbyIndexService from '../lobby/LobbyIndexService';

export class RoomApiService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly idService = inject<IdService>(TYPES.idService);
  private readonly roomRequestValidationService = inject<RoomRequestValidationService>(TYPES.roomRequestValidationService);
  private readonly lobbyIndexService = inject<LobbyIndexService>(TYPES.lobbyIndexService);

  public create = async (env: Env, body: unknown): Promise<{ id: string }> => {
    const request = this.roomRequestValidationService.parseCreate(body);
    const id = this.idService.roomId();
    const stub = env.ROOM.get(env.ROOM.idFromName(id));
    const response = await stub.fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ ...request, id, createdAt: this.clockService.now() }),
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`room init failed: ${response.status}`);
    }
    this.loggerService.log('roomApiService', 'room created', { id, mode: request.mode, mapId: request.mapId });
    return { id };
  };

  public get = async (env: Env, id: string): Promise<RoomListing> => {
    const listing = await this.lobbyIndexService.get(env, id);
    if (listing == null) throw new ApiError('room_not_found');
    return listing;
  };

  public list = (env: Env, mode: string | null): Promise<RoomListing[]> => this.lobbyIndexService.list(env, mode);

  /** The room writes its own listing to the lobby index again (idempotent; a room that is gone is 404). */
  public republish = async (env: Env, id: string): Promise<RoomListing> => {
    const stub = env.ROOM.get(env.ROOM.idFromName(id));
    const response = await stub.fetch('https://room/republish', { method: 'POST' });
    if (response.status === 404) throw new ApiError('room_not_found');
    if (!response.ok) throw new Error(`room republish failed: ${response.status}`);
    return (await response.json()) as RoomListing;
  };
}

export default RoomApiService;
