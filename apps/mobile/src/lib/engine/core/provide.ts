import { provide } from './di';
import TYPES from './types';

import NavGridBuildService from '../services/nav/NavGridBuildService';
import NavGraphService from '../services/nav/NavGraphService';
import PathfindingService from '../services/nav/PathfindingService';
import PathSmoothingService from '../services/nav/PathSmoothingService';
import DistanceFieldService from '../services/nav/DistanceFieldService';
import NavQueryService from '../services/nav/NavQueryService';
import NavCacheService from '../services/nav/NavCacheService';
import LearnedBlockService from '../services/nav/LearnedBlockService';

import PathFollowService from '../services/motion/PathFollowService';
import StuckRecoveryService from '../services/motion/StuckRecoveryService';
import LocalAvoidanceService from '../services/motion/LocalAvoidanceService';
import NavigatorService from '../services/motion/NavigatorService';

import GunnerService from '../services/tactics/GunnerService';
import TriggerService from '../services/tactics/TriggerService';
import SupplyService from '../services/tactics/SupplyService';
import SightingService from '../services/tactics/SightingService';
import ThreatMapService from '../services/tactics/ThreatMapService';
import MedicService from '../services/tactics/MedicService';

import BlackboardService from '../services/squad/BlackboardService';
import RoleAuctionService from '../services/squad/RoleAuctionService';
import EscortService from '../services/squad/EscortService';
import InterceptService from '../services/squad/InterceptService';

import StrategyService from '../services/brain/StrategyService';
import PersonaService from '../services/brain/PersonaService';
import UtilityPlannerService from '../services/brain/UtilityPlannerService';
import BotEngineService from '../services/brain/BotEngineService';

import NavDebugService from '../services/public/NavDebugService';
import ExposureService from '../services/insight/ExposureService';
import MapInsightService from '../services/insight/MapInsightService';
import BenchService from '../services/public/BenchService';

{
  provide(TYPES.navGridBuildService, () => new NavGridBuildService());
  provide(TYPES.navGraphService, () => new NavGraphService());
  provide(TYPES.pathfindingService, () => new PathfindingService());
  provide(TYPES.pathSmoothingService, () => new PathSmoothingService());
  provide(TYPES.distanceFieldService, () => new DistanceFieldService());
  provide(TYPES.navQueryService, () => new NavQueryService());
  provide(TYPES.navCacheService, () => new NavCacheService());
  provide(TYPES.learnedBlockService, () => new LearnedBlockService());
}

{
  provide(TYPES.pathFollowService, () => new PathFollowService());
  provide(TYPES.stuckRecoveryService, () => new StuckRecoveryService());
  provide(TYPES.localAvoidanceService, () => new LocalAvoidanceService());
  provide(TYPES.navigatorService, () => new NavigatorService());
}

{
  provide(TYPES.gunnerService, () => new GunnerService());
  provide(TYPES.triggerService, () => new TriggerService());
  provide(TYPES.supplyService, () => new SupplyService());
  provide(TYPES.sightingService, () => new SightingService());
  provide(TYPES.threatMapService, () => new ThreatMapService());
  provide(TYPES.medicService, () => new MedicService());
}

{
  provide(TYPES.blackboardService, () => new BlackboardService());
  provide(TYPES.roleAuctionService, () => new RoleAuctionService());
  provide(TYPES.escortService, () => new EscortService());
  provide(TYPES.interceptService, () => new InterceptService());
}

{
  provide(TYPES.strategyService, () => new StrategyService());
  provide(TYPES.personaService, () => new PersonaService());
  provide(TYPES.utilityPlannerService, () => new UtilityPlannerService());
  provide(TYPES.botEngineService, () => new BotEngineService());
}

{
  provide(TYPES.exposureService, () => new ExposureService());
  provide(TYPES.mapInsightService, () => new MapInsightService());
}

{
  provide(TYPES.navDebugService, () => new NavDebugService());
  provide(TYPES.benchService, () => new BenchService());
}
