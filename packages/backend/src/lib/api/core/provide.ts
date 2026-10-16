import { provide } from './di';
import TYPES from './types';

import LoggerService from '../services/base/LoggerService';
import ClockService from '../services/base/ClockService';
import IdService from '../services/base/IdService';
import BootstrapService from '../services/base/BootstrapService';
import RedisService from '../services/base/RedisService';
import MongooseService from '../services/base/MongooseService';
import MinioService from '../services/base/MinioService';
import ShutdownService from '../services/base/ShutdownService';

import RoomRequestValidationService from '../services/validation/RoomRequestValidationService';
import SignalMessageValidationService from '../services/validation/SignalMessageValidationService';

import RoomMembershipService from '../services/room/RoomMembershipService';
import RoomSnapshotService from '../services/room/RoomSnapshotService';
import SignalRelayService from '../services/room/SignalRelayService';
import RoomLifecycleService from '../services/room/RoomLifecycleService';

import RoomStoreService from '../services/store/RoomStoreService';
import LobbyIndexService from '../services/store/LobbyIndexService';
import RoomRecordService from '../services/store/RoomRecordService';
import AssetStorageService from '../services/store/AssetStorageService';

import ProcessPresenceService from '../services/realtime/ProcessPresenceService';
import SocketRegistryService from '../services/realtime/SocketRegistryService';
import RoomBusService from '../services/realtime/RoomBusService';
import RoomSessionService from '../services/realtime/RoomSessionService';
import RoomSweepService from '../services/realtime/RoomSweepService';

import RoomApiService from '../services/public/RoomApiService';
import IceConfigService from '../services/public/IceConfigService';
import AssetRouteService from '../services/public/AssetRouteService';

{
  provide(TYPES.loggerService, () => new LoggerService());
  provide(TYPES.clockService, () => new ClockService());
  provide(TYPES.idService, () => new IdService());
  provide(TYPES.bootstrapService, () => new BootstrapService());
  provide(TYPES.redisService, () => new RedisService());
  provide(TYPES.mongooseService, () => new MongooseService());
  provide(TYPES.minioService, () => new MinioService());
  provide(TYPES.shutdownService, () => new ShutdownService());
}
{
  provide(TYPES.roomRequestValidationService, () => new RoomRequestValidationService());
  provide(TYPES.signalMessageValidationService, () => new SignalMessageValidationService());
}
{
  provide(TYPES.roomMembershipService, () => new RoomMembershipService());
  provide(TYPES.roomSnapshotService, () => new RoomSnapshotService());
  provide(TYPES.signalRelayService, () => new SignalRelayService());
  provide(TYPES.roomLifecycleService, () => new RoomLifecycleService());
}
{
  provide(TYPES.roomStoreService, () => new RoomStoreService());
  provide(TYPES.lobbyIndexService, () => new LobbyIndexService());
  provide(TYPES.roomRecordService, () => new RoomRecordService());
  provide(TYPES.assetStorageService, () => new AssetStorageService());
}
{
  provide(TYPES.processPresenceService, () => new ProcessPresenceService());
  provide(TYPES.socketRegistryService, () => new SocketRegistryService());
  provide(TYPES.roomBusService, () => new RoomBusService());
  provide(TYPES.roomSessionService, () => new RoomSessionService());
  provide(TYPES.roomSweepService, () => new RoomSweepService());
}
{
  provide(TYPES.roomApiService, () => new RoomApiService());
  provide(TYPES.iceConfigService, () => new IceConfigService());
  provide(TYPES.assetRouteService, () => new AssetRouteService());
}
