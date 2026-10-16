// The room journal in MongoDB: one document per room, kept up as the room
// moves through its phases and closed when it is purged. The live state is
// in Redis (RoomStoreService); this is the record that outlives it — who
// hosted what, when it played, how many came, when it ended.
import mongoose, { Schema, type Document } from 'mongoose';
import type { BattleModeId, RoomPhase } from '../model/protocol';

export interface IRoomDto {
  roomId: string;
  mode: BattleModeId;
  mapId: string;
  mapName: string;
  host: string;
  maxPlayers: number;
  durationMs: number | null;
  locked: boolean;
  phase: RoomPhase;
  hostId: string | null;
  hostEpoch: number;
  /** The most players connected at once. */
  playersPeak: number;
  playingSince: number | null;
  finishedAt: number | null;
  purgedAt: number | null;
  /** The room's own creation stamp (ms since the epoch), as the lobby shows it. */
  roomCreatedAt: number;
}

export interface IRoomRow extends IRoomDto {
  id: string;
  createDate: Date;
  updatedDate: Date;
}

export interface RoomDocument extends IRoomDto, Document {}

const RoomSchema: Schema<RoomDocument> = new Schema(
  {
    roomId: { type: String, required: true },
    mode: { type: String, required: true },
    mapId: { type: String, required: true },
    mapName: { type: String, required: true },
    host: { type: String, required: true },
    maxPlayers: { type: Number, required: true },
    durationMs: { type: Number, default: null },
    locked: { type: Boolean, default: false },
    phase: { type: String, required: true },
    hostId: { type: String, default: null },
    hostEpoch: { type: Number, default: 0 },
    playersPeak: { type: Number, default: 0 },
    playingSince: { type: Number, default: null },
    finishedAt: { type: Number, default: null },
    purgedAt: { type: Number, default: null },
    roomCreatedAt: { type: Number, required: true },
  },
  { timestamps: { createdAt: 'createDate', updatedAt: 'updatedDate' } },
);

RoomSchema.index({ roomId: 1 }, { unique: true });
RoomSchema.index({ phase: 1, updatedDate: -1 });

export const RoomModel = mongoose.model<RoomDocument>('rooms', RoomSchema);
