// Loads what a map LOOKS like — geometry props, sprite billboards, the sky —
// into any Z-up root, with no physics and no battle state. The battle stage
// (MapStageService) and the menu backdrop (MenuBackdropService) both build
// on this, so a map renders the same behind the menu as in the fight.
import * as pc from 'playcanvas';
import { MapLoader, type LoadedMap } from '../../../../engine/map/MapLoader';
import { DEFAULT_SKYBOX, hexColor, SKYBOX_SIZE, type MapRegistryEntry } from '../../../../engine/logic/bootstrap';
import { assetUrl } from '../../../../engine/tank/TankAssets';
import type { SkyBox } from '../../../../engine/map/SkyBox';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type TextureBudgetService from '../base/TextureBudgetService';

export interface MapScene {
  loaded: LoadedMap;
  /** Null when the sky set failed to load (the clear colour stands in). */
  skyBox: SkyBox | null;
  /** Textures this scene holds on the GPU; released by unload(). */
  textureUrls: string[];
}

export interface MapSceneProgress {
  setPhase(phase: string): void;
}

const NO_PROGRESS: MapSceneProgress = { setPhase: () => {} };

export class MapSceneLoaderService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly textureBudgetService = inject<TextureBudgetService>(TYPES.textureBudgetService);

  /** Props under `root/map`, the sky directly under `root`. */
  public load = async (mapEntry: MapRegistryEntry, root: pc.Entity, progress: MapSceneProgress = NO_PROGRESS): Promise<MapScene> => {
    const app = this.engineService.app;
    progress.setPhase('Map geometry');
    const loader = new MapLoader(app);
    const mapRoot = new pc.Entity('map');
    root.addChild(mapRoot);
    const loaded = await loader.load(mapEntry.file, mapRoot);
    this.loggerService.log(
      `map ${mapEntry.id}: ${loaded.collisionShapes.length} shapes, ${loaded.propCount} props (${loaded.skippedProps} skipped, ${loaded.duplicateProps} duplicates dropped, ${loaded.overlapPairs} coplanar overlaps -> ${loaded.biasedProps} depth-biased), ${loaded.spawnPoints.length} spawns`,
    );

    let skyBox: SkyBox | null = null;
    try {
      progress.setPhase('Sky');
      const { SkyBox } = await import('../../../../engine/map/SkyBox');
      const visual = mapEntry.visual;
      const skyFog = visual != null && visual.fogAlpha > 0 ? { color: hexColor(visual.fogColor), alpha: visual.fogAlpha } : null;
      // SkyBox takes a FOLDER; resolve it through the first face so a bundled
      // set is served locally and any other set remotely.
      const skyId = mapEntry.skybox ?? DEFAULT_SKYBOX;
      const skyFolder = assetUrl(`/battle/skyboxes/${skyId}/01.jpg`).replace(/\/01\.jpg$/, '');
      skyBox = await SkyBox.create(app, root, skyFolder, SKYBOX_SIZE, skyFog);
    } catch (error) {
      this.loggerService.warn('skybox unavailable, clear colour stands in', error);
    }
    const textureUrls = [...loader.textureUrls, ...(skyBox?.textureUrls ?? [])];
    this.textureBudgetService.retain(textureUrls);
    return { loaded, skyBox, textureUrls };
  };

  /** Tears the sky down and lets the scene's textures go (the caller destroys the root entity). */
  public unload = (scene: MapScene): void => {
    scene.skyBox?.destroy();
    this.textureBudgetService.release(scene.textureUrls);
  };

  /** Turns sprite props (bushes, trees) toward the camera around sim Z. */
  public faceBillboards = (billboards: pc.Entity[], camSimPos: pc.Vec3): void => {
    for (const sprite of billboards) {
      const p = sprite.getLocalPosition();
      const angle = Math.atan2(-(camSimPos.x - p.x), camSimPos.y - p.y);
      sprite.setLocalEulerAngles(0, 0, (angle * 180) / Math.PI);
    }
  };
}

export default MapSceneLoaderService;
