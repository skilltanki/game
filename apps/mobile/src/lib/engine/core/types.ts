const navServices = {
  navGridBuildService: Symbol('navGridBuildService'),
  navGraphService: Symbol('navGraphService'),
  pathfindingService: Symbol('pathfindingService'),
  pathSmoothingService: Symbol('pathSmoothingService'),
  distanceFieldService: Symbol('distanceFieldService'),
  navQueryService: Symbol('navQueryService'),
  navCacheService: Symbol('navCacheService'),
  learnedBlockService: Symbol('learnedBlockService'),
};

const motionServices = {
  pathFollowService: Symbol('pathFollowService'),
  stuckRecoveryService: Symbol('stuckRecoveryService'),
  localAvoidanceService: Symbol('localAvoidanceService'),
  navigatorService: Symbol('navigatorService'),
};

const tacticsServices = {
  gunnerService: Symbol('gunnerService'),
  triggerService: Symbol('triggerService'),
  supplyService: Symbol('supplyService'),
  sightingService: Symbol('sightingService'),
  threatMapService: Symbol('threatMapService'),
  medicService: Symbol('medicService'),
};

const squadServices = {
  blackboardService: Symbol('blackboardService'),
  roleAuctionService: Symbol('roleAuctionService'),
  escortService: Symbol('escortService'),
  interceptService: Symbol('interceptService'),
};

const brainServices = {
  strategyService: Symbol('strategyService'),
  personaService: Symbol('personaService'),
  utilityPlannerService: Symbol('utilityPlannerService'),
  botEngineService: Symbol('botEngineService'),
};

const insightServices = {
  exposureService: Symbol('exposureService'),
  mapInsightService: Symbol('mapInsightService'),
};

const publicServices = {
  navDebugService: Symbol('navDebugService'),
  benchService: Symbol('benchService'),
};

export const TYPES = {
  ...navServices,
  ...motionServices,
  ...tacticsServices,
  ...squadServices,
  ...insightServices,
  ...brainServices,
  ...publicServices,
};

export default TYPES;
