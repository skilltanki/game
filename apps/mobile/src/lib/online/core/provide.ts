import { provide } from './di';
import TYPES from './types';

import LoggerService from '../services/base/LoggerService';

import LobbyApiService from '../services/lobby/LobbyApiService';

import SignallingService from '../services/signal/SignallingService';
import RejoinStoreService from '../services/signal/RejoinStoreService';
import MeshService from '../services/rtc/MeshService';

import OnlineEventService from '../services/room/OnlineEventService';
import RoomSessionService from '../services/room/RoomSessionService';

import RemoteControlService from '../services/battle/RemoteControlService';
import StateSyncService from '../services/battle/StateSyncService';
import DamageRuleService from '../services/battle/DamageRuleService';
import AuthorityService from '../services/battle/AuthorityService';
import ReplicaService from '../services/battle/ReplicaService';
import NetBattleService from '../services/battle/NetBattleService';

{
  provide(TYPES.loggerService, () => new LoggerService());
}

{
  provide(TYPES.lobbyApiService, () => new LobbyApiService());
}

{
  provide(TYPES.signallingService, () => new SignallingService());
  provide(TYPES.rejoinStoreService, () => new RejoinStoreService());
  provide(TYPES.meshService, () => new MeshService());
}

{
  provide(TYPES.onlineEventService, () => new OnlineEventService());
  provide(TYPES.roomSessionService, () => new RoomSessionService());
}

{
  provide(TYPES.remoteControlService, () => new RemoteControlService());
  provide(TYPES.stateSyncService, () => new StateSyncService());
  provide(TYPES.damageRuleService, () => new DamageRuleService());
  provide(TYPES.authorityService, () => new AuthorityService());
  provide(TYPES.replicaService, () => new ReplicaService());
  provide(TYPES.netBattleService, () => new NetBattleService());
}
