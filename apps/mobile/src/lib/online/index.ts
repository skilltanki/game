// Multiplayer, as a di-kit module of its own: the lobby REST, the signalling
// socket, the WebRTC mesh, the room session and the netcode of a battle
// (host-peer authority). It knows nothing of PlayCanvas or the physics: the
// battle hands it a BattleBridge (src/model/online) and gets ControlSources
// back. lib/tanki imports this aggregate; never the reverse.
import './core/provide';

import { init, inject } from './core/di';
import TYPES from './core/types';

import type LoggerService from './services/base/LoggerService';
import type LobbyApiService from './services/lobby/LobbyApiService';
import type SignallingService from './services/signal/SignallingService';
import type RejoinStoreService from './services/signal/RejoinStoreService';
import type MeshService from './services/rtc/MeshService';
import type OnlineEventService from './services/room/OnlineEventService';
import type RoomSessionService from './services/room/RoomSessionService';
import type RemoteControlService from './services/battle/RemoteControlService';
import type StateSyncService from './services/battle/StateSyncService';
import type DamageRuleService from './services/battle/DamageRuleService';
import type AuthorityService from './services/battle/AuthorityService';
import type ReplicaService from './services/battle/ReplicaService';
import type NetBattleService from './services/battle/NetBattleService';

const baseServices = {
  loggerService: inject<LoggerService>(TYPES.loggerService),
};

const lobbyServices = {
  lobbyApiService: inject<LobbyApiService>(TYPES.lobbyApiService),
};

const transportServices = {
  signallingService: inject<SignallingService>(TYPES.signallingService),
  rejoinStoreService: inject<RejoinStoreService>(TYPES.rejoinStoreService),
  meshService: inject<MeshService>(TYPES.meshService),
};

const roomServices = {
  onlineEventService: inject<OnlineEventService>(TYPES.onlineEventService),
  roomSessionService: inject<RoomSessionService>(TYPES.roomSessionService),
};

const battleServices = {
  remoteControlService: inject<RemoteControlService>(TYPES.remoteControlService),
  stateSyncService: inject<StateSyncService>(TYPES.stateSyncService),
  damageRuleService: inject<DamageRuleService>(TYPES.damageRuleService),
  authorityService: inject<AuthorityService>(TYPES.authorityService),
  replicaService: inject<ReplicaService>(TYPES.replicaService),
  netBattleService: inject<NetBattleService>(TYPES.netBattleService),
};

export const online = {
  ...baseServices,
  ...lobbyServices,
  ...transportServices,
  ...roomServices,
  ...battleServices,
};

init();

Object.assign(globalThis, { online });

export default online;
