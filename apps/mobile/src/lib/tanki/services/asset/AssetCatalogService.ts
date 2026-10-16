// The manifests: maps.json, hulls.json, turrets.json, paints.json and the
// byte-size manifest assets.json. Loaded once, kept for the app's lifetime.
import { loadMapRegistry, type MapRegistry, type MapRegistryEntry } from '../../../../engine/logic/bootstrap';
import { loadTankAssetRegistry, type TankAssetRegistry } from '../../../../engine/tank/TankAssets';
import { HULL_SPECS } from '../../../../engine/tank/HullSpecs';
import { WEAPON_SPECS } from '../../../../engine/weapon/WeaponSpecs';
import { assetProgress } from '../../../../engine/game/AssetProgress';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

export interface CatalogPart {
  id: string;
  thumbnail?: string;
}

export interface CatalogPaint {
  id: string;
  preview?: string;
}

export class AssetCatalogService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private _maps: MapRegistry | null = null;
  private _tankAssets: TankAssetRegistry | null = null;
  private loading: Promise<void> | null = null;

  public load = (): Promise<void> => {
    this.loading ??= (async () => {
      const [maps, tankAssets] = await Promise.all([
        loadMapRegistry(),
        loadTankAssetRegistry(),
        assetProgress.loadManifest(),
      ]);
      this._maps = maps;
      this._tankAssets = tankAssets;
      this.loggerService.log('catalog loaded', {
        maps: maps.maps.length,
        hulls: tankAssets.hulls.size,
        turrets: tankAssets.turrets.size,
        paints: tankAssets.paints.size,
      });
    })();
    return this.loading;
  };

  public get maps(): MapRegistryEntry[] {
    return this.registry.maps;
  }

  public get defaultMapId(): string {
    return this.registry.defaultMap;
  }

  public map = (id: string): MapRegistryEntry | null => this.registry.maps.find((m) => m.id === id) ?? null;

  /** Hulls the physics knows (HullSpecs) in manifest order. */
  public get hulls(): CatalogPart[] {
    return [...this.tankAssets.hulls.values()]
      .filter((h) => HULL_SPECS[h.id] != null)
      .map((h) => ({ id: h.id, thumbnail: h.thumbnail }));
  }

  /** Turrets with a weapon spec. */
  public get turrets(): CatalogPart[] {
    return [...this.tankAssets.turrets.values()]
      .filter((t) => WEAPON_SPECS[t.id] != null)
      .map((t) => ({ id: t.id, thumbnail: t.thumbnail }));
  }

  public get paints(): CatalogPaint[] {
    return [...this.tankAssets.paints.values()].map((p) => ({ id: p.id, preview: p.preview }));
  }

  public get tankAssets(): TankAssetRegistry {
    if (this._tankAssets == null) {
      throw new Error('AssetCatalogService.load() has not completed');
    }
    return this._tankAssets;
  }

  private get registry(): MapRegistry {
    if (this._maps == null) {
      throw new Error('AssetCatalogService.load() has not completed');
    }
    return this._maps;
  }
}

export default AssetCatalogService;
