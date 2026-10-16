// The application's public surface: boot, the menu <-> battle transitions,
// pause/resume/leave. main.ts calls boot(); everything else is driven by UI
// taps and battle events. No page reloads anywhere.
import type { BattleConfig } from '../../../../model/BattleConfig';
import { detectWebGL, showWebGLModal } from '../../../../ui/webglSupport';
import { CC_AD_PLACEMENTS } from '../../../../config/params';
import { online } from '../../../online';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type AdService from '../base/AdService';
import type BattleSessionService from '../battle/BattleSessionService';
import type BattleStateService from '../battle/BattleStateService';
import type BattleEventService from '../battle/BattleEventService';
import type TouchInputService from '../control/TouchInputService';
import type GamepadInputService from '../control/GamepadInputService';
import type GamepadSimulatorService from '../control/GamepadSimulatorService';
import type UiRootService from '../ui/UiRootService';
import type LoadingScreenService from '../ui/LoadingScreenService';
import type MenuService from '../ui/MenuService';
import type HudService from '../ui/HudService';
import type TouchControlsService from '../ui/TouchControlsService';
import type PauseScreenService from '../ui/PauseScreenService';
import type FullscreenPromptService from '../ui/FullscreenPromptService';
import type ResultScreenService from '../ui/ResultScreenService';
import type SessionLogService from './SessionLogService';

export class GameFacadeService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly adService = inject<AdService>(TYPES.adService);
  private readonly battleSessionService = inject<BattleSessionService>(TYPES.battleSessionService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);
  private readonly gamepadInputService = inject<GamepadInputService>(TYPES.gamepadInputService);
  private readonly gamepadSimulatorService = inject<GamepadSimulatorService>(TYPES.gamepadSimulatorService);
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly loadingScreenService = inject<LoadingScreenService>(TYPES.loadingScreenService);
  private readonly menuService = inject<MenuService>(TYPES.menuService);
  private readonly hudService = inject<HudService>(TYPES.hudService);
  private readonly touchControlsService = inject<TouchControlsService>(TYPES.touchControlsService);
  private readonly pauseScreenService = inject<PauseScreenService>(TYPES.pauseScreenService);
  private readonly fullscreenPromptService = inject<FullscreenPromptService>(TYPES.fullscreenPromptService);
  private readonly resultScreenService = inject<ResultScreenService>(TYPES.resultScreenService);
  private readonly sessionLogService = inject<SessionLogService>(TYPES.sessionLogService);

  /** Creates the engine, loads the catalog, shows the menu. */
  public boot = async (canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<void> => {
    this.uiRootService.mount(uiRoot);
    // Chrome's install prompt fires once, early: catch it for the modal below.
    this.fullscreenPromptService.listen();
    this.loadingScreenService.show('Loading', 'Manifests');
    try {
      this.engineService.create(canvas);
    } catch (error) {
      // The renderer refused: WebGL is off or the driver is blocked. Explain,
      // do not blame the network.
      this.loggerService.error('renderer failed', error);
      this.loadingScreenService.hide();
      showWebGLModal(detectWebGL() ?? 'unavailable');
      return;
    }
    try {
      await this.assetCatalogService.load();
    } catch (error) {
      this.loggerService.error('boot failed', error);
      this.loadingScreenService.fail('Could not reach the asset server. Check the connection and reload.');
      return;
    }
    this.loadingScreenService.hide();
    // Desktop debugging of the PWA: harmless on a phone, no keys arrive.
    this.touchInputService.attachKeyboard();
    // Dev `?gamepad=sim`: a virtual pad in a popup behind the real Gamepad API (installed before the poller starts).
    this.gamepadSimulatorService.attach();
    // A gamepad (Bluetooth on a phone, USB on a desktop): the battle and the screens alike.
    this.gamepadInputService.attach();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pause();
      }
    });
    // Desktop: Escape toggles the pause screen, as in the original client.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      const phase = this.battleStateService.phase;
      if (phase === 'playing') {
        e.preventDefault();
        this.pause();
      } else if (phase === 'paused') {
        e.preventDefault();
        this.resume();
      }
    });
    this.openMenu();
    // A phone in a browser tab: the home-screen prompt sits over the garage
    // like the pause box over a battle — the backdrop and the tank load and
    // turn behind its vignette (the owner's call: not a box on a black page).
    await this.fullscreenPromptService.prompt();
  };

  public openMenu = (): void => {
    this.sessionLogService.end();
    this.battleSessionService.dispose();
    // A room is left with its battle: the menu comes back on the rooms list.
    if (online.roomSessionService.phase === 'battle') {
      online.roomSessionService.leave('battle over');
    }
    this.hudService.hide();
    this.touchControlsService.hide();
    this.pauseScreenService.hide();
    this.resultScreenService.hide();
    this.uiRootService.requireLandscape(false);
    this.adService.preloadInterstitial(CC_AD_PLACEMENTS.battleStartInterstitial);
    this.menuService.show((config) => void this.play(config));
  };

  public play = async (config: BattleConfig): Promise<void> => {
    this.menuService.hide();
    // Modal ad between the menu and the loading screen (no-op without a provider).
    await this.adService.showInterstitial(CC_AD_PLACEMENTS.battleStartInterstitial);
    this.uiRootService.requireLandscape(true);
    try {
      await this.battleSessionService.start(config);
    } catch {
      // The loading screen shows the error; a tap anywhere returns to the menu.
      const back = (): void => {
        document.removeEventListener('pointerup', back);
        this.loadingScreenService.hide();
        this.openMenu();
      };
      document.addEventListener('pointerup', back);
      return;
    }
    this.hudService.show();
    this.touchControlsService.show();
    // Dev: the owner's battle goes to the bench log for the K/D balance measurement.
    this.sessionLogService.begin(config);
    this.battleEventService.once('finished', () => {
      this.touchControlsService.hide();
      this.resultScreenService.show(() => this.openMenu());
    });
  };

  public pause = (): void => {
    if (this.battleStateService.phase !== 'playing') {
      return;
    }
    this.battleSessionService.pause();
    // Online the world does not wait (BattleLoopService): the player is told so.
    const online = this.battleStateService.config.online != null;
    this.pauseScreenService.show(
      () => this.resume(),
      () => this.openMenu(),
      online ? 'The battle goes on without you: your tank stands still and can be hit.' : undefined,
    );
  };

  public resume = (): void => {
    this.pauseScreenService.hide();
    this.battleSessionService.resume();
  };

  public leaveBattle = (): void => {
    this.openMenu();
  };
}

export default GameFacadeService;
