import { provide } from './di';
import TYPES from './types';

import LoggerService from '../services/base/LoggerService';
import ClockService from '../services/base/ClockService';
import IdService from '../services/base/IdService';

import RoomRequestValidationService from '../services/validation/RoomRequestValidationService';
import SignalMessageValidationService from '../services/validation/SignalMessageValidationService';

import LobbyIndexService from '../services/lobby/LobbyIndexService';
import LobbyCatalogService from '../services/lobby/LobbyCatalogService';

import RoomStoreService from '../services/room/RoomStoreService';
import RoomMembershipService from '../services/room/RoomMembershipService';
import RoomSnapshotService from '../services/room/RoomSnapshotService';
import SignalRelayService from '../services/room/SignalRelayService';
import RoomLifecycleService from '../services/room/RoomLifecycleService';

import RoomApiService from '../services/public/RoomApiService';
import IceConfigService from '../services/public/IceConfigService';
import AssetRouteService from '../services/public/AssetRouteService';

{
  provide(TYPES.loggerService, () => new LoggerService());
  provide(TYPES.clockService, () => new ClockService());
  provide(TYPES.idService, () => new IdService());
}
{
  provide(TYPES.roomRequestValidationService, () => new RoomRequestValidationService());
  provide(TYPES.signalMessageValidationService, () => new SignalMessageValidationService());
}
{
  provide(TYPES.lobbyIndexService, () => new LobbyIndexService());
  provide(TYPES.lobbyCatalogService, () => new LobbyCatalogService());
}
{
  provide(TYPES.roomStoreService, () => new RoomStoreService());
  provide(TYPES.roomMembershipService, () => new RoomMembershipService());
  provide(TYPES.roomSnapshotService, () => new RoomSnapshotService());
  provide(TYPES.signalRelayService, () => new SignalRelayService());
  provide(TYPES.roomLifecycleService, () => new RoomLifecycleService());
}
{
  provide(TYPES.roomApiService, () => new RoomApiService());
  provide(TYPES.iceConfigService, () => new IceConfigService());
  provide(TYPES.assetRouteService, () => new AssetRouteService());
}
