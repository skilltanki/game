// The room journal in MongoDB (schema/Room.schema.ts): a document per room,
// written on every change of phase, host or head count and closed when the
// room is purged. Fire-and-forget: the lobby does not wait for Mongo, a
// failed write is logged and the next change writes the whole record again.
import { RoomModel, type IRoomDto } from '../../../../schema/Room.schema';
import type { RoomState } from '../../../../model/room';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type MongooseService from '../base/MongooseService';

export class RoomRecordService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly mongooseService = inject<MongooseService>(TYPES.mongooseService);

  /** The room as it stands now (`players`: connected right now, for the peak). */
  public record = (state: RoomState, players: number, now: number): void => {
    const c = state.config;
    if (c == null || !this.mongooseService.ready) return;
    const dto: Omit<IRoomDto, 'playersPeak' | 'purgedAt'> = {
      roomId: c.id,
      mode: c.mode,
      mapId: c.mapId,
      mapName: c.mapName,
      host: c.host,
      maxPlayers: c.maxPlayers,
      durationMs: c.durationMs,
      locked: c.password != null,
      phase: state.phase,
      hostId: state.hostId,
      hostEpoch: state.hostEpoch,
      playingSince: state.playingSince,
      finishedAt: state.phase === 'finished' ? now : null,
      roomCreatedAt: c.createdAt,
    };
    RoomModel.updateOne({ roomId: c.id }, { $set: dto, $max: { playersPeak: players }, $setOnInsert: { purgedAt: null } }, { upsert: true })
      .exec()
      .catch((error: unknown) => this.loggerService.error('roomRecordService', 'record failed', error));
  };

  /** The room is gone from Redis: the journal closes its document. */
  public purged = (roomId: string, now: number): void => {
    if (!this.mongooseService.ready) return;
    RoomModel.updateOne({ roomId }, { $set: { purgedAt: now } })
      .exec()
      .catch((error: unknown) => this.loggerService.error('roomRecordService', 'purge record failed', error));
  };
}

export default RoomRecordService;
