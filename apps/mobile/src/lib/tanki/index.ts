import './core/provide';

import { init, inject } from './core/di';
import TYPES from './core/types';

import type LoggerService from './services/base/LoggerService';
import type StorageService from './services/base/StorageService';
import type EngineService from './services/base/EngineService';
import type GraphicsQualityService from './services/base/GraphicsQualityService';
import type TextureBudgetService from './services/base/TextureBudgetService';
import type FullscreenService from './services/base/FullscreenService';
import type AudioSettingsService from './services/base/AudioSettingsService';
import type AdService from './services/base/AdService';
import type AssetSourceService from './services/asset/AssetSourceService';
import type AssetCatalogService from './services/asset/AssetCatalogService';
import type TouchInputService from './services/control/TouchInputService';
import type GamepadInputService from './services/control/GamepadInputService';
import type GamepadSimulatorService from './services/control/GamepadSimulatorService';
import type ControlRegistryService from './services/control/ControlRegistryService';
import type TankDriverService from './services/control/TankDriverService';
import type PerceptionAdapterService from './services/adapter/PerceptionAdapterService';
import type NavWorldAdapterService from './services/adapter/NavWorldAdapterService';
import type OnlineBattleAdapterService from './services/adapter/OnlineBattleAdapterService';
import type ModeRuleService from './services/mode/ModeRuleService';
import type FlagModeService from './services/mode/FlagModeService';
import type BattleStateService from './services/battle/BattleStateService';
import type BattleEventService from './services/battle/BattleEventService';
import type MapStageService from './services/battle/MapStageService';
import type EffectsService from './services/battle/EffectsService';
import type CombatService from './services/battle/CombatService';
import type TankSpawnService from './services/battle/TankSpawnService';
import type RespawnService from './services/battle/RespawnService';
import type SupplyRuleService from './services/battle/SupplyRuleService';
import type ScoreService from './services/battle/ScoreService';
import type ClockService from './services/battle/ClockService';
import type CameraService from './services/battle/CameraService';
import type BattleLoopService from './services/battle/BattleLoopService';
import type BattleSessionService from './services/battle/BattleSessionService';
import type MapSceneLoaderService from './services/scene/MapSceneLoaderService';
import type MenuBackdropService from './services/scene/MenuBackdropService';
import type GaragePreviewService from './services/scene/GaragePreviewService';
import type UiRootService from './services/ui/UiRootService';
import type LoadingScreenService from './services/ui/LoadingScreenService';
import type MenuService from './services/ui/MenuService';
import type RoomsMenuService from './services/ui/RoomsMenuService';
import type HudService from './services/ui/HudService';
import type TouchControlsService from './services/ui/TouchControlsService';
import type PauseScreenService from './services/ui/PauseScreenService';
import type FullscreenPromptService from './services/ui/FullscreenPromptService';
import type ResultScreenService from './services/ui/ResultScreenService';
import type NavOverlayService from './services/ui/NavOverlayService';
import type GameFacadeService from './services/public/GameFacadeService';
import type SessionLogService from './services/public/SessionLogService';

const baseServices = {
  loggerService: inject<LoggerService>(TYPES.loggerService),
  storageService: inject<StorageService>(TYPES.storageService),
  engineService: inject<EngineService>(TYPES.engineService),
  graphicsQualityService: inject<GraphicsQualityService>(TYPES.graphicsQualityService),
  textureBudgetService: inject<TextureBudgetService>(TYPES.textureBudgetService),
  fullscreenService: inject<FullscreenService>(TYPES.fullscreenService),
  audioSettingsService: inject<AudioSettingsService>(TYPES.audioSettingsService),
  adService: inject<AdService>(TYPES.adService),
};

const assetServices = {
  assetSourceService: inject<AssetSourceService>(TYPES.assetSourceService),
  assetCatalogService: inject<AssetCatalogService>(TYPES.assetCatalogService),
};

const controlServices = {
  touchInputService: inject<TouchInputService>(TYPES.touchInputService),
  gamepadInputService: inject<GamepadInputService>(TYPES.gamepadInputService),
  gamepadSimulatorService: inject<GamepadSimulatorService>(TYPES.gamepadSimulatorService),
  controlRegistryService: inject<ControlRegistryService>(TYPES.controlRegistryService),
  tankDriverService: inject<TankDriverService>(TYPES.tankDriverService),
};

const adapterServices = {
  perceptionAdapterService: inject<PerceptionAdapterService>(TYPES.perceptionAdapterService),
  navWorldAdapterService: inject<NavWorldAdapterService>(TYPES.navWorldAdapterService),
  onlineBattleAdapterService: inject<OnlineBattleAdapterService>(TYPES.onlineBattleAdapterService),
};

const modeServices = {
  modeRuleService: inject<ModeRuleService>(TYPES.modeRuleService),
  flagModeService: inject<FlagModeService>(TYPES.flagModeService),
};

const battleServices = {
  battleStateService: inject<BattleStateService>(TYPES.battleStateService),
  battleEventService: inject<BattleEventService>(TYPES.battleEventService),
  mapStageService: inject<MapStageService>(TYPES.mapStageService),
  effectsService: inject<EffectsService>(TYPES.effectsService),
  combatService: inject<CombatService>(TYPES.combatService),
  tankSpawnService: inject<TankSpawnService>(TYPES.tankSpawnService),
  respawnService: inject<RespawnService>(TYPES.respawnService),
  supplyRuleService: inject<SupplyRuleService>(TYPES.supplyRuleService),
  scoreService: inject<ScoreService>(TYPES.scoreService),
  clockService: inject<ClockService>(TYPES.clockService),
  cameraService: inject<CameraService>(TYPES.cameraService),
  battleLoopService: inject<BattleLoopService>(TYPES.battleLoopService),
  battleSessionService: inject<BattleSessionService>(TYPES.battleSessionService),
};

const sceneServices = {
  mapSceneLoaderService: inject<MapSceneLoaderService>(TYPES.mapSceneLoaderService),
  menuBackdropService: inject<MenuBackdropService>(TYPES.menuBackdropService),
  garagePreviewService: inject<GaragePreviewService>(TYPES.garagePreviewService),
};

const uiServices = {
  uiRootService: inject<UiRootService>(TYPES.uiRootService),
  loadingScreenService: inject<LoadingScreenService>(TYPES.loadingScreenService),
  menuService: inject<MenuService>(TYPES.menuService),
  roomsMenuService: inject<RoomsMenuService>(TYPES.roomsMenuService),
  hudService: inject<HudService>(TYPES.hudService),
  touchControlsService: inject<TouchControlsService>(TYPES.touchControlsService),
  pauseScreenService: inject<PauseScreenService>(TYPES.pauseScreenService),
  fullscreenPromptService: inject<FullscreenPromptService>(TYPES.fullscreenPromptService),
  resultScreenService: inject<ResultScreenService>(TYPES.resultScreenService),
  navOverlayService: inject<NavOverlayService>(TYPES.navOverlayService),
};

const publicServices = {
  gameFacadeService: inject<GameFacadeService>(TYPES.gameFacadeService),
  sessionLogService: inject<SessionLogService>(TYPES.sessionLogService),
};

export const tanki = {
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

init();

Object.assign(globalThis, { tanki });

export default tanki;
