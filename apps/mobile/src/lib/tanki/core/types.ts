const baseServices = {
  loggerService: Symbol('loggerService'),
  storageService: Symbol('storageService'),
  engineService: Symbol('engineService'),
  graphicsQualityService: Symbol('graphicsQualityService'),
  textureBudgetService: Symbol('textureBudgetService'),
  fullscreenService: Symbol('fullscreenService'),
  deviceFormService: Symbol('deviceFormService'),
  audioSettingsService: Symbol('audioSettingsService'),
  adService: Symbol('adService'),
};

const assetServices = {
  assetSourceService: Symbol('assetSourceService'),
  assetCatalogService: Symbol('assetCatalogService'),
};

const controlServices = {
  touchInputService: Symbol('touchInputService'),
  gamepadInputService: Symbol('gamepadInputService'),
  gamepadSimulatorService: Symbol('gamepadSimulatorService'),
  controlRegistryService: Symbol('controlRegistryService'),
  tankDriverService: Symbol('tankDriverService'),
};

/** Adapters between the battle's live objects and lib/engine's model interfaces. */
const adapterServices = {
  perceptionAdapterService: Symbol('perceptionAdapterService'),
  navWorldAdapterService: Symbol('navWorldAdapterService'),
  onlineBattleAdapterService: Symbol('onlineBattleAdapterService'),
};

const modeServices = {
  modeRuleService: Symbol('modeRuleService'),
  flagModeService: Symbol('flagModeService'),
};

const battleServices = {
  battleStateService: Symbol('battleStateService'),
  battleEventService: Symbol('battleEventService'),
  mapStageService: Symbol('mapStageService'),
  effectsService: Symbol('effectsService'),
  combatService: Symbol('combatService'),
  tankSpawnService: Symbol('tankSpawnService'),
  respawnService: Symbol('respawnService'),
  supplyRuleService: Symbol('supplyRuleService'),
  supplySoundService: Symbol('supplySoundService'),
  scoreService: Symbol('scoreService'),
  clockService: Symbol('clockService'),
  cameraService: Symbol('cameraService'),
  battleLoopService: Symbol('battleLoopService'),
  battleSessionService: Symbol('battleSessionService'),
};

/** 3D outside the battle: the menu backdrop and the garage preview. */
const sceneServices = {
  mapSceneLoaderService: Symbol('mapSceneLoaderService'),
  menuBackdropService: Symbol('menuBackdropService'),
  garagePreviewService: Symbol('garagePreviewService'),
};

const uiServices = {
  uiRootService: Symbol('uiRootService'),
  loadingScreenService: Symbol('loadingScreenService'),
  menuService: Symbol('menuService'),
  roomsMenuService: Symbol('roomsMenuService'),
  hudService: Symbol('hudService'),
  touchControlsService: Symbol('touchControlsService'),
  pauseScreenService: Symbol('pauseScreenService'),
  fullscreenPromptService: Symbol('fullscreenPromptService'),
  resultScreenService: Symbol('resultScreenService'),
  navOverlayService: Symbol('navOverlayService'),
};

const publicServices = {
  gameFacadeService: Symbol('gameFacadeService'),
  sessionLogService: Symbol('sessionLogService'),
};

export const TYPES = {
  ...baseServices,
  ...assetServices,
  ...controlServices,
  ...adapterServices,
  ...modeServices,
  ...battleServices,
  ...sceneServices,
  ...uiServices,
  ...publicServices,
};

export default TYPES;
