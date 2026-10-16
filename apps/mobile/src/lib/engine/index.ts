// The bot engine: map reflection (walkability grid), pathfinding, path
// following and the bot brains, as a di-kit module of its own. It knows
// nothing of PlayCanvas or the physics engine: the battle hands it a
// StaticWorld and BotPerceptions (src/model), and it hands back
// ControlSources. lib/tanki imports this aggregate; never the reverse.
import './core/provide';

import { init, inject } from './core/di';
import TYPES from './core/types';

import type NavGridBuildService from './services/nav/NavGridBuildService';
import type NavGraphService from './services/nav/NavGraphService';
import type PathfindingService from './services/nav/PathfindingService';
import type PathSmoothingService from './services/nav/PathSmoothingService';
import type DistanceFieldService from './services/nav/DistanceFieldService';
import type NavQueryService from './services/nav/NavQueryService';
import type NavCacheService from './services/nav/NavCacheService';
import type LearnedBlockService from './services/nav/LearnedBlockService';
import type PathFollowService from './services/motion/PathFollowService';
import type StuckRecoveryService from './services/motion/StuckRecoveryService';
import type LocalAvoidanceService from './services/motion/LocalAvoidanceService';
import type NavigatorService from './services/motion/NavigatorService';
import type GunnerService from './services/tactics/GunnerService';
import type TriggerService from './services/tactics/TriggerService';
import type SupplyService from './services/tactics/SupplyService';
import type SightingService from './services/tactics/SightingService';
import type ThreatMapService from './services/tactics/ThreatMapService';
import type MedicService from './services/tactics/MedicService';
import type BlackboardService from './services/squad/BlackboardService';
import type RoleAuctionService from './services/squad/RoleAuctionService';
import type EscortService from './services/squad/EscortService';
import type InterceptService from './services/squad/InterceptService';
import type StrategyService from './services/brain/StrategyService';
import type PersonaService from './services/brain/PersonaService';
import type UtilityPlannerService from './services/brain/UtilityPlannerService';
import type BotEngineService from './services/brain/BotEngineService';
import type NavDebugService from './services/public/NavDebugService';
import type ExposureService from './services/insight/ExposureService';
import type MapInsightService from './services/insight/MapInsightService';
import type BenchService from './services/public/BenchService';

const navServices = {
  navGridBuildService: inject<NavGridBuildService>(TYPES.navGridBuildService),
  navGraphService: inject<NavGraphService>(TYPES.navGraphService),
  pathfindingService: inject<PathfindingService>(TYPES.pathfindingService),
  pathSmoothingService: inject<PathSmoothingService>(TYPES.pathSmoothingService),
  distanceFieldService: inject<DistanceFieldService>(TYPES.distanceFieldService),
  navQueryService: inject<NavQueryService>(TYPES.navQueryService),
  navCacheService: inject<NavCacheService>(TYPES.navCacheService),
  learnedBlockService: inject<LearnedBlockService>(TYPES.learnedBlockService),
};

const motionServices = {
  pathFollowService: inject<PathFollowService>(TYPES.pathFollowService),
  stuckRecoveryService: inject<StuckRecoveryService>(TYPES.stuckRecoveryService),
  localAvoidanceService: inject<LocalAvoidanceService>(TYPES.localAvoidanceService),
  navigatorService: inject<NavigatorService>(TYPES.navigatorService),
};

const tacticsServices = {
  gunnerService: inject<GunnerService>(TYPES.gunnerService),
  triggerService: inject<TriggerService>(TYPES.triggerService),
  supplyService: inject<SupplyService>(TYPES.supplyService),
  sightingService: inject<SightingService>(TYPES.sightingService),
  threatMapService: inject<ThreatMapService>(TYPES.threatMapService),
  medicService: inject<MedicService>(TYPES.medicService),
};

const squadServices = {
  blackboardService: inject<BlackboardService>(TYPES.blackboardService),
  roleAuctionService: inject<RoleAuctionService>(TYPES.roleAuctionService),
  escortService: inject<EscortService>(TYPES.escortService),
  interceptService: inject<InterceptService>(TYPES.interceptService),
};

const brainServices = {
  strategyService: inject<StrategyService>(TYPES.strategyService),
  personaService: inject<PersonaService>(TYPES.personaService),
  utilityPlannerService: inject<UtilityPlannerService>(TYPES.utilityPlannerService),
  botEngineService: inject<BotEngineService>(TYPES.botEngineService),
};

const insightServices = {
  exposureService: inject<ExposureService>(TYPES.exposureService),
  mapInsightService: inject<MapInsightService>(TYPES.mapInsightService),
};

const publicServices = {
  navDebugService: inject<NavDebugService>(TYPES.navDebugService),
  benchService: inject<BenchService>(TYPES.benchService),
};

export const engine = {
  ...navServices,
  ...motionServices,
  ...tacticsServices,
  ...squadServices,
  ...insightServices,
  ...brainServices,
  ...publicServices,
};

init();

Object.assign(globalThis, { engine });

export default engine;
