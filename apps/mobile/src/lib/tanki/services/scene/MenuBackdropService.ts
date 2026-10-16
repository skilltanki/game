// The 3D backdrop behind the start menu: the chosen map rendered under its
// own sky, with the camera slowly circling a spawn point — the same backdrop
// the original client's menu always had. Lives in its own Z-up root, apart
// from the battle's simRoot, so a battle can start without touching it and
// the menu can come back after a battle without reloading the page.
//
// Loads are cancellable: picking another map tile while one is still
// loading drops the stale result the moment it arrives.
import * as pc from 'playcanvas';
import { UNITS_TO_METERS, type MapRegistryEntry } from '../../../../engine/logic/bootstrap';
import type { SpawnPoint } from '../../../../engine/map/SpawnPoints';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type MapSceneLoaderService from './MapSceneLoaderService';
import type { MapScene } from './MapSceneLoaderService';

/** Where the camera circles: wide over the map, or close around the garage tank. */
export type OrbitPreset = 'wide' | 'garage';

interface Orbit {
  /** Metres from the focus in plan and above it. */
  radius: number;
  height: number;
  /** Radians per second. */
  speed: number;
  /**
   * Where the focus sits on screen, as a fraction of the half width (0 =
   * centre, +1 = right edge). Landscape only. The garage strips run the full
   * width (the owner's call), so the tank stays centred behind them.
   */
  shift: number;
}

const ORBITS: Record<OrbitPreset, Orbit> = {
  wide: { radius: 16, height: 7, speed: 0.12, shift: 0 },
  garage: { radius: 10, height: 3.4, speed: 0.2, shift: 0 },
};
/** How fast the orbit blends between presets (fraction per second). */
const ORBIT_BLEND = 2.5;
/** A map tile tap while another load is in flight waits this long before loading. */
const SWITCH_DEBOUNCE_MS = 450;

export class MenuBackdropService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly mapSceneLoaderService = inject<MapSceneLoaderService>(TYPES.mapSceneLoaderService);

  private root: pc.Entity | null = null;
  private scene: MapScene | null = null;
  private mapId: string | null = null;
  private detach: (() => void) | null = null;
  /** Bumped on every show/hide; a load whose token is stale throws its result away. */
  private token = 0;
  private switchTimer: ReturnType<typeof setTimeout> | null = null;

  private angle = 0;
  private preset: OrbitPreset = 'wide';
  private readonly orbit: Orbit = { ...ORBITS.wide };
  private readonly lookAt = new pc.Vec3();
  /** Focus in world metres (PlayCanvas Y-up). */
  private readonly focus = new pc.Vec3(0, 1, 0);
  private readonly focusSim = { x: 0, y: 0, z: 0 };
  private focusYaw = 0;
  private readonly camSimPos = new pc.Vec3();
  private readonly invRoot = new pc.Mat4();

  /** True once a map is on screen. */
  public get visible(): boolean {
    return this.scene != null;
  }

  /** The spawn the camera circles, in sim units, and the hull yaw there. */
  public get focusPoint(): { x: number; y: number; z: number; yaw: number } {
    return { ...this.focusSim, yaw: this.focusYaw };
  }

  /** The Z-up root the backdrop renders in (null while hidden). */
  public get sceneRoot(): pc.Entity | null {
    return this.root;
  }

  /**
   * Shows `mapId` behind the menu. Resolves true once that map is on screen,
   * false when it was superseded, hidden or failed to load.
   */
  public show = (mapId: string): Promise<boolean> => {
    if (this.switchTimer != null) {
      clearTimeout(this.switchTimer);
      this.switchTimer = null;
    }
    if (this.mapId === mapId && this.scene != null) {
      return Promise.resolve(true);
    }
    const debounce = this.root != null && this.scene == null;
    const token = ++this.token;
    return new Promise<boolean>((resolve) => {
      const run = (): void => {
        this.switchTimer = null;
        void this.load(mapId, token).then(resolve);
      };
      // The first map comes at once; a tap-through over the map strip waits
      // for the thumb to settle instead of loading every tile it crossed.
      if (debounce) {
        this.switchTimer = setTimeout(run, SWITCH_DEBOUNCE_MS);
      } else {
        run();
      }
    });
  };

  public setOrbit = (preset: OrbitPreset): void => {
    this.preset = preset;
  };

  public hide = (): void => {
    this.token++;
    if (this.switchTimer != null) {
      clearTimeout(this.switchTimer);
      this.switchTimer = null;
    }
    this.detach?.();
    this.detach = null;
    this.destroyScene();
    this.mapId = null;
  };

  private async load(mapId: string, token: number): Promise<boolean> {
    const entry = this.assetCatalogService.map(mapId);
    if (entry == null) {
      this.loggerService.warn('backdrop: unknown map', mapId);
      return false;
    }
    this.mapId = mapId;
    // A fresh root per map: the old one stays on screen until the new one is ready.
    const root = this.engineService.createZUpRoot('backdrop');
    root.enabled = false;
    let scene: MapScene;
    try {
      scene = await this.mapSceneLoaderService.load(entry, root);
    } catch (error) {
      root.destroy();
      if (token === this.token) {
        this.loggerService.warn('backdrop failed to load', mapId, error);
      }
      return false;
    }
    if (token !== this.token) {
      this.mapSceneLoaderService.unload(scene);
      root.destroy();
      return false;
    }
    this.destroyScene();
    this.root = root;
    this.scene = scene;
    this.pickFocus(entry, scene.loaded.spawnPoints);
    this.engineService.applyVisual(entry.visual);
    root.enabled = true;
    this.detach ??= this.engineService.onUpdate(this.onFrame);
    this.engineService.start();
    this.loggerService.log('backdrop ready', mapId);
    return true;
  }

  private pickFocus(entry: MapRegistryEntry, spawns: SpawnPoint[]): void {
    const spawn = spawns.find((p) => p.type === 'dm') ?? spawns[0];
    if (spawn == null) {
      this.focusSim.x = this.focusSim.y = this.focusSim.z = 0;
      this.focusYaw = 0;
    } else {
      this.focusSim.x = spawn.position.x;
      this.focusSim.y = spawn.position.y;
      this.focusSim.z = spawn.position.z;
      this.focusYaw = spawn.rotationZ;
    }
    // Sim space is Z-up at 100 units per metre; the root converts it.
    this.focus.set(this.focusSim.x * UNITS_TO_METERS, this.focusSim.z * UNITS_TO_METERS + 1, -this.focusSim.y * UNITS_TO_METERS);
    void entry;
  }

  private destroyScene(): void {
    if (this.scene != null) {
      this.mapSceneLoaderService.unload(this.scene);
      this.scene = null;
    }
    if (this.root != null) {
      this.root.destroy();
      this.root = null;
    }
  }

  private readonly onFrame = (dt: number): void => {
    const scene = this.scene;
    const root = this.root;
    if (scene == null || root == null) {
      return;
    }
    const want = ORBITS[this.preset];
    const k = Math.min(1, dt * ORBIT_BLEND);
    this.orbit.radius += (want.radius - this.orbit.radius) * k;
    this.orbit.height += (want.height - this.orbit.height) * k;
    this.orbit.speed += (want.speed - this.orbit.speed) * k;
    this.orbit.shift += (want.shift - this.orbit.shift) * k;
    this.angle += dt * this.orbit.speed;

    const camera = this.engineService.camera;
    const device = this.engineService.app.graphicsDevice;
    const aspect = device.height > 0 ? device.width / device.height : 1;
    // Portrait sees a narrow slice of the view (the FOV is vertical), so the
    // camera backs off to keep the whole tank in the frame.
    const zoom = aspect < 1 ? 1.5 : 1;
    const radius = this.orbit.radius * zoom;
    const height = this.orbit.height * zoom;
    const cx = this.focus.x + Math.cos(this.angle) * radius;
    const cy = this.focus.y + height;
    const cz = this.focus.z + Math.sin(this.angle) * radius;
    camera.setPosition(cx, cy, cz);
    // Look past the focus to its left so the focus lands right of centre:
    // the lateral offset at the focus' distance for the wanted screen fraction.
    const shift = aspect > 1 ? this.orbit.shift : 0;
    const halfFov = ((camera.camera?.fov ?? 45) * Math.PI) / 360;
    const distance = Math.hypot(radius, height);
    const lateral = distance * Math.tan(halfFov) * aspect * shift;
    // Camera right vector in plan: perpendicular to (focus - camera).
    const dx = this.focus.x - cx;
    const dz = this.focus.z - cz;
    const len = Math.hypot(dx, dz) || 1;
    this.lookAt.set(this.focus.x - (-dz / len) * lateral, this.focus.y, this.focus.z - (dx / len) * lateral);
    camera.lookAt(this.lookAt);

    // Sky around the camera, bushes turned toward it (both in sim space).
    this.invRoot.copy(root.getWorldTransform()).invert();
    this.invRoot.transformPoint(camera.getPosition(), this.camSimPos);
    scene.skyBox?.update(this.camSimPos);
    this.mapSceneLoaderService.faceBillboards(scene.loaded.billboards, this.camSimPos);
  };
}

export default MenuBackdropService;
