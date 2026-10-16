// The facade of the backend's services: routes and the entry points reach
// everything through `api.<service>`. Built once per process at module
// evaluation; the stores connect lazily (waitForInit) on the first request.
import './core/provide';
import { init, inject } from './core/di';
import TYPES from './core/types';

import type LoggerService from './services/base/LoggerService';
import type ClockService from './services/base/ClockService';
import type IdService from './services/base/IdService';
import type BootstrapService from './services/base/BootstrapService';
import type RedisService from './services/base/RedisService';
import type MongooseService from './services/base/MongooseService';
import type MinioService from './services/base/MinioService';
import type ShutdownService from './services/base/ShutdownService';
import type RoomRequestValidationService from './services/validation/RoomRequestValidationService';
import type SignalMessageValidationService from './services/validation/SignalMessageValidationService';
import type RoomMembershipService from './services/room/RoomMembershipService';
import type RoomSnapshotService from './services/room/RoomSnapshotService';
import type SignalRelayService from './services/room/SignalRelayService';
import type RoomLifecycleService from './services/room/RoomLifecycleService';
import type RoomStoreService from './services/store/RoomStoreService';
import type LobbyIndexService from './services/store/LobbyIndexService';
import type RoomRecordService from './services/store/RoomRecordService';
import type AssetStorageService from './services/store/AssetStorageService';
import type ProcessPresenceService from './services/realtime/ProcessPresenceService';
import type SocketRegistryService from './services/realtime/SocketRegistryService';
import type RoomBusService from './services/realtime/RoomBusService';
import type RoomSessionService from './services/realtime/RoomSessionService';
import type RoomSweepService from './services/realtime/RoomSweepService';
import type RoomApiService from './services/public/RoomApiService';
import type IceConfigService from './services/public/IceConfigService';
import type AssetRouteService from './services/public/AssetRouteService';

const baseServices = {
  loggerService: inject<LoggerService>(TYPES.loggerService),
  clockService: inject<ClockService>(TYPES.clockService),
  idService: inject<IdService>(TYPES.idService),
  bootstrapService: inject<BootstrapService>(TYPES.bootstrapService),
  redisService: inject<RedisService>(TYPES.redisService),
  mongooseService: inject<MongooseService>(TYPES.mongooseService),
  minioService: inject<MinioService>(TYPES.minioService),
  shutdownService: inject<ShutdownService>(TYPES.shutdownService),
};

const validationServices = {
  roomRequestValidationService: inject<RoomRequestValidationService>(TYPES.roomRequestValidationService),
  signalMessageValidationService: inject<SignalMessageValidationService>(TYPES.signalMessageValidationService),
};

const roomServices = {
  roomMembershipService: inject<RoomMembershipService>(TYPES.roomMembershipService),
  roomSnapshotService: inject<RoomSnapshotService>(TYPES.roomSnapshotService),
  signalRelayService: inject<SignalRelayService>(TYPES.signalRelayService),
  roomLifecycleService: inject<RoomLifecycleService>(TYPES.roomLifecycleService),
};

const storeServices = {
  roomStoreService: inject<RoomStoreService>(TYPES.roomStoreService),
  lobbyIndexService: inject<LobbyIndexService>(TYPES.lobbyIndexService),
  roomRecordService: inject<RoomRecordService>(TYPES.roomRecordService),
  assetStorageService: inject<AssetStorageService>(TYPES.assetStorageService),
};

const realtimeServices = {
  processPresenceService: inject<ProcessPresenceService>(TYPES.processPresenceService),
  socketRegistryService: inject<SocketRegistryService>(TYPES.socketRegistryService),
  roomBusService: inject<RoomBusService>(TYPES.roomBusService),
  roomSessionService: inject<RoomSessionService>(TYPES.roomSessionService),
  roomSweepService: inject<RoomSweepService>(TYPES.roomSweepService),
};

const publicServices = {
  roomApiService: inject<RoomApiService>(TYPES.roomApiService),
  iceConfigService: inject<IceConfigService>(TYPES.iceConfigService),
  assetRouteService: inject<AssetRouteService>(TYPES.assetRouteService),
};

export const api = {
  ...baseServices,
  ...validationServices,
  ...roomServices,
  ...storeServices,
  ...realtimeServices,
  ...publicServices,
};

init();

Object.assign(globalThis, { api });

export default api;
