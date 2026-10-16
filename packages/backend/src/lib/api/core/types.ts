// Service keys, grouped by responsibility (one service — one responsibility).
const baseServices = {
  loggerService: Symbol('loggerService'),
  clockService: Symbol('clockService'),
  idService: Symbol('idService'),
  bootstrapService: Symbol('bootstrapService'),
  redisService: Symbol('redisService'),
  mongooseService: Symbol('mongooseService'),
  minioService: Symbol('minioService'),
  shutdownService: Symbol('shutdownService'),
};

const validationServices = {
  roomRequestValidationService: Symbol('roomRequestValidationService'),
  signalMessageValidationService: Symbol('signalMessageValidationService'),
};

/** Pure logic over RoomState (copied from apps/server: the rules are the same, the store differs). */
const roomServices = {
  roomMembershipService: Symbol('roomMembershipService'),
  roomSnapshotService: Symbol('roomSnapshotService'),
  signalRelayService: Symbol('signalRelayService'),
  roomLifecycleService: Symbol('roomLifecycleService'),
};

/** The stores: Redis (live rooms, lobby index), MongoDB (the journal), MinIO (the assets). */
const storeServices = {
  roomStoreService: Symbol('roomStoreService'),
  lobbyIndexService: Symbol('lobbyIndexService'),
  roomRecordService: Symbol('roomRecordService'),
  assetStorageService: Symbol('assetStorageService'),
};

/** The sockets of this process, the pub/sub between processes, the room's handlers, the sweeper. */
const realtimeServices = {
  processPresenceService: Symbol('processPresenceService'),
  socketRegistryService: Symbol('socketRegistryService'),
  roomBusService: Symbol('roomBusService'),
  roomSessionService: Symbol('roomSessionService'),
  roomSweepService: Symbol('roomSweepService'),
};

/** What the routes call. */
const publicServices = {
  roomApiService: Symbol('roomApiService'),
  iceConfigService: Symbol('iceConfigService'),
  assetRouteService: Symbol('assetRouteService'),
};

export const TYPES = {
  ...baseServices,
  ...validationServices,
  ...roomServices,
  ...storeServices,
  ...realtimeServices,
  ...publicServices,
};

export default TYPES;
