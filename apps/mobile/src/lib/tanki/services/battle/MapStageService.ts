// Loads the battle stage: map geometry and props, spawn points, flag
// pedestals, the skybox and the out-of-world kill height. Port of
// logic/mapStage.ts with the loading screen decoupled through callbacks.
import type * as pc from 'playcanvas';
import { assetProgress } from '../../../../engine/game/AssetProgress';
import { DEFAULT_SKYBOX, type MapRegistryEntry } from '../../../../engine/logic/bootstrap';
import type { CollisionShape } from '../../../../engine/physics/collision/CollisionShape';
import type { SpawnPoint } from '../../../../engine/map/SpawnPoints';
import type { CtfFlagPositions } from '../../../../engine/map/CtfFlags';
import type { BonusRegion } from '../../../../engine/map/BonusRegions';
import type { SkyBox } from '../../../../engine/map/SkyBox';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type EngineService from '../base/EngineService';
import type BattleStateService from './BattleStateService';
import type MapSceneLoaderService from '../scene/MapSceneLoaderService';
import type { MapScene } from '../scene/MapSceneLoaderService';

export interface MapStage {
  staticShapes: CollisionShape[];
  spawnPoints: SpawnPoint[];
  bonusRegions: BonusRegion[];
  ctfFlagPositions: CtfFlagPositions | null;
  /** Sprite props (bushes/trees) that billboard toward the camera. */
  billboards: pc.Entity[];
  skyBox: SkyBox | null;
  /** Below this height a tank has left the world and dies. */
  killZ: number;
}

export interface StageProgress {
  setPhase(phase: string): void;
}

export class MapStageService {
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly mapSceneLoaderService = inject<MapSceneLoaderService>(TYPES.mapSceneLoaderService);

  private scene: MapScene | null = null;

  /** Releases the stage's textures (the sim root itself is reset by EngineService). */
  public unload = (): void => {
    if (this.scene != null) {
      this.mapSceneLoaderService.unload(this.scene);
      this.scene = null;
    }
  };

  public load = async (mapEntry: MapRegistryEntry, progress: StageProgress): Promise<MapStage> => {
    this.unload();
    const simRoot = this.engineService.simRoot;
    const physics = this.battleStateService.physics;

    // Byte budget for the loading bar: the map group, its sky and the shared
    // effect/sound groups. Hull/turret bytes are added as tanks are built.
    assetProgress.begin(
      assetProgress.groupBytes(`map:${mapEntry.id}`, `skybox:${mapEntry.skybox ?? DEFAULT_SKYBOX}`, 'effects', 'sounds', 'boot'),
    );
    // The visible scene (props, billboards, sky) is shared with the menu backdrop.
    const scene = await this.mapSceneLoaderService.load(mapEntry, simRoot, progress);
    this.scene = scene;
    const { loaded, skyBox } = scene;
    physics.initStaticGeometry(loaded.collisionShapes);

    const stage: MapStage = {
      staticShapes: loaded.collisionShapes,
      spawnPoints: loaded.spawnPoints,
      bonusRegions: loaded.bonusRegions,
      ctfFlagPositions: loaded.ctfFlags,
      billboards: loaded.billboards,
      skyBox,
      killZ: computeKillZ(loaded.collisionShapes, loaded.spawnPoints),
    };
    this.battleStateService.setMapStage(stage);
    return stage;
  };
}

/**
 * 1000 units below the lowest collision shape: past anything you can stand
 * on, close enough to catch a fall off the edge quickly.
 */
function computeKillZ(staticShapes: CollisionShape[], spawnPoints: SpawnPoint[]): number {
  let lowest = Infinity;
  for (const shape of staticShapes) {
    if (shape.aabb.minZ < lowest) {
      lowest = shape.aabb.minZ;
    }
  }
  if (lowest === Infinity) {
    return spawnPoints.length > 0 ? Math.min(...spawnPoints.map((p) => p.position.z)) - 800 : -2000;
  }
  return lowest - 1000;
}

export default MapStageService;
