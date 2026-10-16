// Service keys, grouped by responsibility (one service — one responsibility).
const baseServices = {
  loggerService: Symbol('loggerService'),
  clockService: Symbol('clockService'),
  idService: Symbol('idService'),
};

const validationServices = {
  roomRequestValidationService: Symbol('roomRequestValidationService'),
  signalMessageValidationService: Symbol('signalMessageValidationService'),
};

const lobbyServices = {
  lobbyIndexService: Symbol('lobbyIndexService'),
  lobbyCatalogService: Symbol('lobbyCatalogService'),
};

/** Pure logic over RoomState (the Durable Object holds the state and the sockets). */
const roomServices = {
  roomStoreService: Symbol('roomStoreService'),
  roomMembershipService: Symbol('roomMembershipService'),
  roomSnapshotService: Symbol('roomSnapshotService'),
  signalRelayService: Symbol('signalRelayService'),
  roomLifecycleService: Symbol('roomLifecycleService'),
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
  ...lobbyServices,
  ...roomServices,
  ...publicServices,
};

export default TYPES;
