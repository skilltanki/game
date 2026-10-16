// The garage preview: the player's chosen hull, turret and paint standing on
// the backdrop map's spawn point while the camera circles it. A skin only —
// no physics, no weapon, no health bar — rebuilt when the loadout changes.
import * as pc from 'playcanvas';
import { loadTankSkin } from '../../../../engine/tank/TankSkin';
import { resolvePart } from '../../../../engine/tank/TankAssets';
import { TankConst } from '../../../../engine/tank/TankConst';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type MenuBackdropService from './MenuBackdropService';

export interface PreviewLoadout {
  hull: string;
  turret: string;
  paint?: string;
  modification: string;
}

/** GameTank's team colour for a tank without a team (the garage). */
const GARAGE_PAINT = '#7a8a5a';
/** SuspensionParams.nominalRayLength: how far the hull floats above the tracks' contact. */
const NOMINAL_RAY_LENGTH = 25;
/** Rapid taps through the strips rebuild once the thumb settles. */
const REBUILD_DEBOUNCE_MS = 250;

export class GaragePreviewService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly menuBackdropService = inject<MenuBackdropService>(TYPES.menuBackdropService);

  private entity: pc.Entity | null = null;
  private shown: string | null = null;
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Builds (or rebuilds) the preview for `loadout`; a no-op when it is already shown. */
  public show = (loadout: PreviewLoadout): void => {
    const key = `${loadout.hull}|${loadout.turret}|${loadout.paint ?? ''}|${loadout.modification}`;
    if (this.shown === key && this.entity != null) {
      return;
    }
    if (this.timer != null) {
      clearTimeout(this.timer);
    }
    const token = ++this.token;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.build(loadout, key, token);
    }, this.entity == null ? 0 : REBUILD_DEBOUNCE_MS);
  };

  public hide = (): void => {
    this.token++;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.entity?.destroy();
    this.entity = null;
    this.shown = null;
  };

  private async build(loadout: PreviewLoadout, key: string, token: number): Promise<void> {
    const assets = this.assetCatalogService.tankAssets;
    let entity: pc.Entity;
    let lift = 0;
    try {
      const skin = await loadTankSkin(this.engineService.app, {
        hull: resolvePart(assets.hulls, 'hull', loadout.hull, loadout.modification),
        turret: resolvePart(assets.turrets, 'turret', loadout.turret, loadout.modification),
        paintColor: GARAGE_PAINT,
        ...(loadout.paint != null ? { paintImage: assets.paints.get(loadout.paint)?.image } : {}),
      });
      if (token !== this.token) {
        return;
      }
      entity = skin.buildEntity();
      // The skin's pivot is the body centre; the hull bottom hangs
      // 0.5*height + nominal ray - RAY_OFFSET below it (TankSkin skinCenterOffset),
      // so lifting the pivot by that much parks the tracks on the ground.
      lift = 0.5 * skin.hullSize.z + NOMINAL_RAY_LENGTH - TankConst.RAY_OFFSET;
    } catch (error) {
      this.loggerService.warn('garage preview failed', loadout, error);
      return;
    }
    // Wait for the backdrop if it is still loading: it owns the root the tank
    // stands in, and the spawn point is only known once its map is parsed.
    const root = await this.waitForRoot(token);
    if (root == null) {
      entity.destroy();
      return;
    }
    const at = this.menuBackdropService.focusPoint;
    entity.setLocalPosition(at.x, at.y, at.z + lift);
    entity.setLocalEulerAngles(0, 0, (at.yaw * 180) / Math.PI);
    this.entity?.destroy();
    this.entity = entity;
    this.shown = key;
    root.addChild(entity);
  }

  private async waitForRoot(token: number): Promise<pc.Entity | null> {
    for (let i = 0; i < 600; i++) {
      if (token !== this.token) {
        return null;
      }
      const root = this.menuBackdropService.sceneRoot;
      if (root != null && this.menuBackdropService.visible) {
        return root;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }
}

export default GaragePreviewService;
