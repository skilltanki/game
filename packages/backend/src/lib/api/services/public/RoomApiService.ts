// The lobby REST behind the routes: create a room, get one, list them,
// republish one. The listing reads come from the Redis index; the rooms
// themselves are RoomSessionService's.
import { ApiError } from '../../../../model/errors';
import type { RoomListing } from '../../../../model/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type ClockService from '../base/ClockService';
import type RoomRequestValidationService from '../validation/RoomRequestValidationService';
import type LobbyIndexService from '../store/LobbyIndexService';
import type RoomSessionService from '../realtime/RoomSessionService';

export class RoomApiService {
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly roomRequestValidationService = inject<RoomRequestValidationService>(TYPES.roomRequestValidationService);
  private readonly lobbyIndexService = inject<LobbyIndexService>(TYPES.lobbyIndexService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);

  public create = async (body: unknown): Promise<{ id: string }> => {
    const request = this.roomRequestValidationService.parseCreate(body);
    const id = await this.roomSessionService.create(request);
    return { id };
  };

  public get = async (id: string): Promise<RoomListing> => {
    const listing = await this.lobbyIndexService.get(id, this.clockService.now());
    if (listing == null) throw new ApiError('room_not_found');
    return listing;
  };

  public list = (mode: string | null): Promise<RoomListing[]> => this.lobbyIndexService.list(mode, this.clockService.now());

  /** The room writes its own listing to the lobby index again (idempotent; a room that is gone is 404). */
  public republish = (id: string): Promise<RoomListing> => this.roomSessionService.republish(id);
}

export default RoomApiService;
