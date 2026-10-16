const baseServices = {
  loggerService: Symbol('loggerService'),
};

/** The backend's lobby REST (same origin). */
const lobbyServices = {
  lobbyApiService: Symbol('lobbyApiService'),
};

/** The signalling socket and the WebRTC mesh it brokers. */
const transportServices = {
  signallingService: Symbol('signallingService'),
  rejoinStoreService: Symbol('rejoinStoreService'),
  meshService: Symbol('meshService'),
};

/** The room the player sits in: seats, host, ready flags, start. */
const roomServices = {
  onlineEventService: Symbol('onlineEventService'),
  roomSessionService: Symbol('roomSessionService'),
};

/** The netcode of a running battle, over the BattleBridge. */
const battleServices = {
  remoteControlService: Symbol('remoteControlService'),
  stateSyncService: Symbol('stateSyncService'),
  damageRuleService: Symbol('damageRuleService'),
  authorityService: Symbol('authorityService'),
  replicaService: Symbol('replicaService'),
  netBattleService: Symbol('netBattleService'),
};

export const TYPES = {
  ...baseServices,
  ...lobbyServices,
  ...transportServices,
  ...roomServices,
  ...battleServices,
};

export default TYPES;
