// The PlayCanvas application: canvas, camera, light and the Z-up sim root
// the engine renders into. One application for the app's lifetime; one
// fresh `simRoot` per battle, so tearing a battle down is a single destroy.
import * as pc from 'playcanvas';
import { applyMapVisual, UNITS_TO_METERS, type MapVisual } from '../../../../engine/logic/bootstrap';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';
import type GraphicsQualityService from './GraphicsQualityService';
import type AudioSettingsService from './AudioSettingsService';
import type TextureBudgetService from './TextureBudgetService';

export type UpdateListener = (dtSec: number) => void;

export class EngineService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly graphicsQualityService = inject<GraphicsQualityService>(TYPES.graphicsQualityService);
  private readonly audioSettingsService = inject<AudioSettingsService>(TYPES.audioSettingsService);
  private readonly textureBudgetService = inject<TextureBudgetService>(TYPES.textureBudgetService);

  private _app: pc.AppBase | null = null;
  private _camera: pc.Entity | null = null;
  private _light: pc.Entity | null = null;
  private _simRoot: pc.Entity | null = null;
  private readonly updateListeners = new Set<UpdateListener>();
  private started = false;

  public get app(): pc.AppBase {
    if (this._app == null) {
      throw new Error('EngineService.create() has not run');
    }
    return this._app;
  }

  public get camera(): pc.Entity {
    if (this._camera == null) {
      throw new Error('EngineService.create() has not run');
    }
    return this._camera;
  }

  /** The current battle's Z-up root (see createSimRoot). */
  public get simRoot(): pc.Entity {
    if (this._simRoot == null) {
      this._simRoot = this.createSimRoot();
    }
    return this._simRoot;
  }

  public create = (canvas: HTMLCanvasElement): void => {
    if (this._app != null) {
      return;
    }
    const app = new pc.Application(canvas, {
      // No pc.Keyboard: the mobile client reads touch; a desktop debugger
      // may still attach one through TouchInputService.attachKeyboard.
      // MSAA follows the graphics preset; it is fixed for the device's life.
      graphicsDeviceOptions: { antialias: this.graphicsQualityService.settings.antialias, alpha: false, powerPreference: 'high-performance' },
    });
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    // Backing-store resolution: capped by the preset (2x at most — a 3x panel
    // costs more than it shows), changeable from the menu.
    this.graphicsQualityService.attach(app.graphicsDevice, () => app.resizeCanvas(), app.assets);
    // Textures leave the GPU with their scene (see TextureBudgetService).
    this.textureBudgetService.attach(app);
    this.audioSettingsService.attach(app);
    window.addEventListener('resize', () => app.resizeCanvas());
    window.addEventListener('orientationchange', () => setTimeout(() => app.resizeCanvas(), 100));

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color(0.55, 0.7, 0.9), farClip: 2000 });
    camera.setPosition(0, 8, 14);
    camera.addComponent('audiolistener');
    app.root.addChild(camera);

    const light = new pc.Entity('light');
    light.addComponent('light', { type: 'directional', castShadows: false, intensity: 1.2 });
    light.setEulerAngles(50, 30, 0);
    app.root.addChild(light);

    app.on('update', (dt: number) => {
      for (const listener of this.updateListeners) {
        listener(dt);
      }
    });

    this._app = app;
    this._camera = camera;
    this._light = light;
    this.loggerService.log('engine created', { width: canvas.width, height: canvas.height });
  };

  /** Starts rendering (idempotent). */
  public start = (): void => {
    if (!this.started) {
      this.started = true;
      this.app.start();
    }
  };

  public onUpdate = (listener: UpdateListener): (() => void) => {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  };

  /** Lighting, fog and the clear colour of the loaded map. */
  public applyVisual = (visual: MapVisual | undefined): void => {
    if (visual != null) {
      applyMapVisual(this.app, this.camera, visual);
    } else {
      this.app.scene.fog.type = pc.FOG_NONE;
      this.camera.camera!.clearColor = new pc.Color(0.55, 0.7, 0.9);
    }
  };

  /** Drops everything of the previous battle and creates a fresh sim root. */
  public resetSimRoot = (): pc.Entity => {
    if (this._simRoot != null) {
      this._simRoot.destroy();
      this._simRoot = null;
    }
    return this.simRoot;
  };

  /**
   * A root in the engine's space (Z-up, 100 units per metre) for anything
   * rendered outside the battle — the menu backdrop lives in one of these.
   */
  public createZUpRoot = (name: string): pc.Entity => {
    // Z-up sim space -> PlayCanvas Y-up world: rotate -90deg about X, scale to metres.
    const root = new pc.Entity(name);
    root.setLocalEulerAngles(-90, 0, 0);
    root.setLocalScale(UNITS_TO_METERS, UNITS_TO_METERS, UNITS_TO_METERS);
    this.app.root.addChild(root);
    return root;
  };

  private createSimRoot(): pc.Entity {
    return this.createZUpRoot('simRoot');
  }
}

export default EngineService;
