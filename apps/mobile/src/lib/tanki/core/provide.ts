import { provide } from './di';
import TYPES from './types';

import LoggerService from '../services/base/LoggerService';
import StorageService from '../services/base/StorageService';
import EngineService from '../services/base/EngineService';
import GraphicsQualityService from '../services/base/GraphicsQualityService';
import TextureBudgetService from '../services/base/TextureBudgetService';
import FullscreenService from '../services/base/FullscreenService';
import AudioSettingsService from '../services/base/AudioSettingsService';
import AdService from '../services/base/AdService';

import AssetSourceService from '../services/asset/AssetSourceService';
import AssetCatalogService from '../services/asset/AssetCatalogService';

import TouchInputService from '../services/control/TouchInputService';
import GamepadInputService from '../services/control/GamepadInputService';
import GamepadSimulatorService from '../services/control/GamepadSimulatorService';
import ControlRegistryService from '../services/control/ControlRegistryService';
import TankDriverService from '../services/control/TankDriverService';

import PerceptionAdapterService from '../services/adapter/PerceptionAdapterService';
import NavWorldAdapterService from '../services/adapter/NavWorldAdapterService';
import OnlineBattleAdapterService from '../services/adapter/OnlineBattleAdapterService';

import ModeRuleService from '../services/mode/ModeRuleService';
import FlagModeService from '../services/mode/FlagModeService';

import BattleStateService from '../services/battle/BattleStateService';
import BattleEventService from '../services/battle/BattleEventService';
import MapStageService from '../services/battle/MapStageService';
import EffectsService from '../services/battle/EffectsService';
import CombatService from '../services/battle/CombatService';
import TankSpawnService from '../services/battle/TankSpawnService';
import RespawnService from '../services/battle/RespawnService';
import SupplyRuleService from '../services/battle/SupplyRuleService';
import ScoreService from '../services/battle/ScoreService';
import ClockService from '../services/battle/ClockService';
import CameraService from '../services/battle/CameraService';
import BattleLoopService from '../services/battle/BattleLoopService';
import BattleSessionService from '../services/battle/BattleSessionService';

import MapSceneLoaderService from '../services/scene/MapSceneLoaderService';
import MenuBackdropService from '../services/scene/MenuBackdropService';
import GaragePreviewService from '../services/scene/GaragePreviewService';

import UiRootService from '../services/ui/UiRootService';
import LoadingScreenService from '../services/ui/LoadingScreenService';
import MenuService from '../services/ui/MenuService';
import RoomsMenuService from '../services/ui/RoomsMenuService';
import HudService from '../services/ui/HudService';
import TouchControlsService from '../services/ui/TouchControlsService';
import PauseScreenService from '../services/ui/PauseScreenService';
import FullscreenPromptService from '../services/ui/FullscreenPromptService';
import ResultScreenService from '../services/ui/ResultScreenService';
import NavOverlayService from '../services/ui/NavOverlayService';

import GameFacadeService from '../services/public/GameFacadeService';
import SessionLogService from '../services/public/SessionLogService';

{
  provide(TYPES.loggerService, () => new LoggerService());
  provide(TYPES.storageService, () => new StorageService());
  provide(TYPES.engineService, () => new EngineService());
  provide(TYPES.graphicsQualityService, () => new GraphicsQualityService());
  provide(TYPES.textureBudgetService, () => new TextureBudgetService());
  provide(TYPES.fullscreenService, () => new FullscreenService());
  provide(TYPES.audioSettingsService, () => new AudioSettingsService());
  provide(TYPES.adService, () => new AdService());
}

{
  provide(TYPES.assetSourceService, () => new AssetSourceService());
  provide(TYPES.assetCatalogService, () => new AssetCatalogService());
}

{
  provide(TYPES.touchInputService, () => new TouchInputService());
  provide(TYPES.gamepadInputService, () => new GamepadInputService());
  provide(TYPES.gamepadSimulatorService, () => new GamepadSimulatorService());
  provide(TYPES.controlRegistryService, () => new ControlRegistryService());
  provide(TYPES.tankDriverService, () => new TankDriverService());
}

{
  provide(TYPES.perceptionAdapterService, () => new PerceptionAdapterService());
  provide(TYPES.navWorldAdapterService, () => new NavWorldAdapterService());
  provide(TYPES.onlineBattleAdapterService, () => new OnlineBattleAdapterService());
}

{
  provide(TYPES.modeRuleService, () => new ModeRuleService());
  provide(TYPES.flagModeService, () => new FlagModeService());
}

{
  provide(TYPES.battleStateService, () => new BattleStateService());
  provide(TYPES.battleEventService, () => new BattleEventService());
  provide(TYPES.mapStageService, () => new MapStageService());
  provide(TYPES.effectsService, () => new EffectsService());
  provide(TYPES.combatService, () => new CombatService());
  provide(TYPES.tankSpawnService, () => new TankSpawnService());
  provide(TYPES.respawnService, () => new RespawnService());
  provide(TYPES.supplyRuleService, () => new SupplyRuleService());
  provide(TYPES.scoreService, () => new ScoreService());
  provide(TYPES.clockService, () => new ClockService());
  provide(TYPES.cameraService, () => new CameraService());
  provide(TYPES.battleLoopService, () => new BattleLoopService());
  provide(TYPES.battleSessionService, () => new BattleSessionService());
}

{
  provide(TYPES.mapSceneLoaderService, () => new MapSceneLoaderService());
  provide(TYPES.menuBackdropService, () => new MenuBackdropService());
  provide(TYPES.garagePreviewService, () => new GaragePreviewService());
}

{
  provide(TYPES.uiRootService, () => new UiRootService());
  provide(TYPES.loadingScreenService, () => new LoadingScreenService());
  provide(TYPES.menuService, () => new MenuService());
  provide(TYPES.roomsMenuService, () => new RoomsMenuService());
  provide(TYPES.hudService, () => new HudService());
  provide(TYPES.touchControlsService, () => new TouchControlsService());
  provide(TYPES.pauseScreenService, () => new PauseScreenService());
  provide(TYPES.fullscreenPromptService, () => new FullscreenPromptService());
  provide(TYPES.resultScreenService, () => new ResultScreenService());
  provide(TYPES.navOverlayService, () => new NavOverlayService());
}

{
  provide(TYPES.gameFacadeService, () => new GameFacadeService());
  provide(TYPES.sessionLogService, () => new SessionLogService());
}
