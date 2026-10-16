// Graphics quality for weak phones: one preset drives the render resolution
// (the backing-store pixel ratio, the biggest fill-rate lever on a phone),
// texture filtering (anisotropy and the mip filter — the difference the eye
// sees at once: the ground and roads at a grazing angle are crisp on HIGH
// and smeared on LOW; applied to every resident texture the moment the
// preset changes, no restart), multisampling and the track dust. Picked in
// the menu, remembered in the profile; a first launch starts LOW (the
// owner's call: a phone that can do better is one tap away, a phone that
// cannot would otherwise stutter).
import * as pc from 'playcanvas';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';
import type StorageService from './StorageService';

export type QualityPreset = 'high' | 'medium' | 'low';

export const QUALITY_PRESETS: QualityPreset[] = ['high', 'medium', 'low'];

interface QualitySettings {
  /** Cap on the canvas backing store relative to CSS pixels. */
  pixelRatioCap: number;
  /** MSAA; set when the renderer is created, so a change applies on the next launch. */
  antialias: boolean;
  /** Dust puffs under the tracks (one particle per suspension ray per step). */
  dust: boolean;
  /** Anisotropic filtering samples (1 = off), capped by the device. */
  anisotropy: number;
  /** Mip filter: trilinear (FILTER_LINEAR_MIPMAP_LINEAR) or bilinear with nearest mip (FILTER_LINEAR_MIPMAP_NEAREST). */
  minFilter: number;
}

const SETTINGS: Record<QualityPreset, QualitySettings> = {
  high: { pixelRatioCap: 2, antialias: true, dust: true, anisotropy: 16, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR },
  medium: { pixelRatioCap: 1.5, antialias: true, dust: true, anisotropy: 4, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR },
  low: { pixelRatioCap: 1, antialias: false, dust: false, anisotropy: 1, minFilter: pc.FILTER_LINEAR_MIPMAP_NEAREST },
};

const DEFAULT_PRESET: QualityPreset = 'low';

export class GraphicsQualityService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);

  private device: (pc.GraphicsDevice & { maxPixelRatio?: number }) | null = null;
  private resize: (() => void) | null = null;
  private assets: pc.AssetRegistry | null = null;

  /** The remembered preset, or LOW when nothing was chosen yet. */
  public get preset(): QualityPreset {
    return this.storageService.getProfile().quality ?? DEFAULT_PRESET;
  }

  public get settings(): QualitySettings {
    return SETTINGS[this.preset];
  }

  /** The renderer registers itself once created; later changes resize it in place. Every texture the registry loads gets the preset's filtering. */
  public attach = (device: pc.GraphicsDevice, resize: () => void, assets: pc.AssetRegistry): void => {
    this.device = device;
    this.resize = resize;
    this.assets = assets;
    assets.on('load', (asset: pc.Asset) => {
      if (asset.type === 'texture' && asset.resource != null) {
        this.filterTexture(asset.resource as pc.Texture);
      }
    });
    this.applyToDevice();
  };

  /** Remembers `preset` and applies what can change at runtime (resolution, filtering of every resident texture, dust on the next battle). */
  public apply = (preset: QualityPreset): void => {
    this.storageService.saveProfile({ quality: preset });
    this.applyToDevice();
    this.applyToTextures();
    this.loggerService.log('graphics quality', preset, SETTINGS[preset]);
  };

  /** Filtering for a texture built outside the registry (tank skins). */
  public filterTexture = (texture: pc.Texture): void => {
    const device = this.device;
    const settings = this.settings;
    texture.anisotropy = Math.min(settings.anisotropy, device?.maxAnisotropy ?? 1);
    texture.minFilter = settings.minFilter;
  };

  private applyToTextures(): void {
    const assets = this.assets;
    if (assets == null) return;
    let count = 0;
    for (const asset of assets.list()) {
      if (asset.type === 'texture' && asset.resource != null) {
        this.filterTexture(asset.resource as pc.Texture);
        count++;
      }
    }
    this.loggerService.log(`graphics quality: filtering re-applied to ${count} textures`);
  }

  private applyToDevice(): void {
    if (this.device == null || this.device.maxPixelRatio == null) {
      return;
    }
    const cap = this.settings.pixelRatioCap;
    const next = Math.min(cap, window.devicePixelRatio || 1);
    if (this.device.maxPixelRatio !== next) {
      this.device.maxPixelRatio = next;
      this.resize?.();
    }
  }
}

export default GraphicsQualityService;
