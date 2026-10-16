// Texture lifetime on a phone (the owner's measurement: textures, not the bots
// or the fill rate, are what loads a low-end device).
//
// PlayCanvas keeps every loaded texture in its asset registry for the life of
// the page, so each map browsed in the menu stayed resident. Scenes retain()
// their texture URLs on load and release() them on teardown; the last release
// unloads the asset (destroys the GPU texture) and drops it from the registry.
// A URL shared by two live scenes (the backdrop and a battle on the same map)
// is unloaded once both go. The unload waits RELEASE_GRACE_MS: the menu
// backdrop goes just before the battle on the same map loads, and a texture
// retained again within the grace is simply kept (no second decode).
//
// Shrinking textures to the preset was tried here and dropped: the owner
// would rather have a laggy HIGH that looks better than a fast one that does
// not (the presets now differ in filtering, see GraphicsQualityService).
import type * as pc from 'playcanvas';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

/** A released URL stays resident this long in case the next scene wants it. */
const RELEASE_GRACE_MS = 5000;

export interface TextureBudgetStats {
  /** Textures unloaded by the last release of their URL. */
  unloaded: number;
  /** URLs currently retained by at least one scene. */
  retained: number;
  /** URLs released and waiting out the grace period. */
  pending: number;
}

export class TextureBudgetService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private app: pc.AppBase | null = null;
  private readonly refs = new Map<string, number>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private unloaded = 0;

  public get statistics(): TextureBudgetStats {
    return { unloaded: this.unloaded, retained: this.refs.size, pending: this.pending.size };
  }

  /** Current texture memory in megabytes as the graphics device counts it (for logs and the dev console). */
  public get vramMb(): number {
    const device = this.app?.graphicsDevice as (pc.GraphicsDevice & { _vram?: { tex?: number } }) | undefined;
    return Math.round(((device?._vram?.tex ?? 0) / 1048576) * 10) / 10;
  }

  public attach = (app: pc.AppBase): void => {
    this.app = app;
  };

  /** Marks `urls` as used by a scene (a URL may be retained by several scenes at once). */
  public retain = (urls: Iterable<string>): void => {
    for (const url of urls) {
      const timer = this.pending.get(url);
      if (timer != null) {
        clearTimeout(timer);
        this.pending.delete(url);
      }
      this.refs.set(url, (this.refs.get(url) ?? 0) + 1);
    }
  };

  /** The scene is gone: drop its hold on `urls`; a URL nobody holds any more is unloaded after the grace period. */
  public release = (urls: Iterable<string>): void => {
    for (const url of urls) {
      const count = (this.refs.get(url) ?? 0) - 1;
      if (count > 0) {
        this.refs.set(url, count);
        continue;
      }
      this.refs.delete(url);
      if (this.pending.has(url)) continue;
      this.pending.set(
        url,
        setTimeout(() => {
          this.pending.delete(url);
          this.unload(url);
        }, RELEASE_GRACE_MS),
      );
    }
  };

  private unload(url: string): void {
    const app = this.app;
    if (app == null || this.refs.has(url)) return;
    const asset = app.assets.getByUrl(url);
    if (asset == null) return;
    asset.unload();
    app.assets.remove(asset);
    this.unloaded++;
    if (this.pending.size === 0) {
      this.loggerService.log(`textures: ${this.unloaded} unloaded so far, ${this.refs.size} retained, ${this.vramMb} MB on the GPU`);
    }
  }
}

export default TextureBudgetService;
