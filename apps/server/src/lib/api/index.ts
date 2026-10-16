// The facade of the backend's services: routes and the Durable Object reach
// everything through `api.<service>`. Built once per isolate at module
// evaluation (pure JS, no I/O — Workers forbid I/O at global scope).
import './core/provide';
import { init, inject } from './core/di';
import TYPES from './core/types';

import type LoggerService from './services/base/LoggerService';
import type ClockService from './services/base/ClockService';
import type IdService from './services/base/IdService';
import type RoomRequestValidationService from './services/validation/RoomRequestValidationService';
import type SignalMessageValidationService from './services/validation/SignalMessageValidationService';
import type LobbyIndexService from './services/lobby/LobbyIndexService';
import type LobbyCatalogService from './services/lobby/LobbyCatalogService';
import type RoomStoreService from './services/room/RoomStoreService';
import type RoomMembershipService from './services/room/RoomMembershipService';
import type RoomSnapshotService from './services/room/RoomSnapshotService';
import type SignalRelayService from './services/room/SignalRelayService';
import type RoomLifecycleService from './services/room/RoomLifecycleService';
import type RoomApiService from './services/public/RoomApiService';
import type IceConfigService from './services/public/IceConfigService';
import type AssetRouteService from './services/public/AssetRouteService';

const baseServices = {
  loggerService: inject<LoggerService>(TYPES.loggerService),
  clockService: inject<ClockService>(TYPES.clockService),
  idService: inject<IdService>(TYPES.idService),
};

const validationServices = {
  roomRequestValidationService: inject<RoomRequestValidationService>(TYPES.roomRequestValidationService),
  signalMessageValidationService: inject<SignalMessageValidationService>(TYPES.signalMessageValidationService),
};

const lobbyServices = {
  lobbyIndexService: inject<LobbyIndexService>(TYPES.lobbyIndexService),
  lobbyCatalogService: inject<LobbyCatalogService>(TYPES.lobbyCatalogService),
};

const roomServices = {
  roomStoreService: inject<RoomStoreService>(TYPES.roomStoreService),
  roomMembershipService: inject<RoomMembershipService>(TYPES.roomMembershipService),
  roomSnapshotService: inject<RoomSnapshotService>(TYPES.roomSnapshotService),
  signalRelayService: inject<SignalRelayService>(TYPES.signalRelayService),
  roomLifecycleService: inject<RoomLifecycleService>(TYPES.roomLifecycleService),
};

const publicServices = {
  roomApiService: inject<RoomApiService>(TYPES.roomApiService),
  iceConfigService: inject<IceConfigService>(TYPES.iceConfigService),
  assetRouteService: inject<AssetRouteService>(TYPES.assetRouteService),
};

export const api = {
  ...baseServices,
  ...validationServices,
  ...lobbyServices,
  ...roomServices,
  ...publicServices,
};

init();

export default api;
