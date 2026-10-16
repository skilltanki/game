// Byte-accurate download progress.
//
// A loading screen needs two numbers: how much is coming, and how much has
// arrived. Neither is available by default here, so this module supplies both:
//
//  - the TOTAL comes from public/assets.json, written by sync-assets.mjs at
//    build time. Asking the server instead would mean a HEAD request per file
//    — ~75 round trips before the first byte of a map — and the answer is
//    already known when the files are copied.
//  - the RECEIVED count comes from two places, because assets arrive by two
//    routes: PlayCanvas's own loader (textures, audio) fires a 'progress'
//    event carrying (loaded, total), and everything fetched by hand (map XML,
//    .3ds meshes, tank skins) is read through `trackedFetch` below.
//
// Progress is deliberately clamped to the total and never drives completion:
// a stale manifest must make the bar slightly wrong, never hang it. What ends
// a load is the load's own promise settling.

import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';

export interface AssetGroup {
  bytes: number;
  files: string[];
}

export interface AssetManifest {
  /** Published URL -> byte size. */
  files: Record<string, number>;
  /** Named bundles ("boot", "map:island_old_summer", "hull:Hunter/M0"). */
  groups: Record<string, AssetGroup>;
}

export type ProgressListener = (received: number, total: number) => void;

export class AssetProgress {
  private manifest: AssetManifest | null = null;
  private total = 0;
  private received = 0;
  /** Bytes already counted per URL, so a re-request cannot double-count. */
  private readonly counted = new Map<string, number>();
  private listener: ProgressListener | null = null;

  async loadManifest(url = assetUrl('/assets.json')): Promise<AssetManifest | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.manifest = (await response.json()) as AssetManifest;
      return this.manifest;
    } catch (e) {
      // Without it the bar has no denominator, but the game must still run:
      // callers fall back to an indeterminate screen.
      console.warn('assets.json unavailable — progress totals disabled', e);
      return null;
    }
  }

  onProgress(listener: ProgressListener | null): void {
    this.listener = listener;
  }

  /** Size of one named group, 0 when the manifest is missing or stale. */
  groupBytes(...names: string[]): number {
    let sum = 0;
    for (const name of names) {
      sum += this.manifest?.groups[name]?.bytes ?? 0;
    }
    return sum;
  }

  groupFiles(name: string): string[] {
    return this.manifest?.groups[name]?.files ?? [];
  }

  fileBytes(url: string): number {
    return this.manifest?.files[url] ?? 0;
  }

  /** Starts a new measurement. `total` is the expected download in bytes. */
  begin(total: number): void {
    this.total = total;
    this.received = 0;
    this.counted.clear();
    this.emit();
  }

  /** Widens the total mid-flight (a battle adds its map once it is known). */
  addToTotal(bytes: number): void {
    this.total += bytes;
    this.emit();
  }

  /**
   * Credits bytes for one URL.
   *
   * `loaded` is cumulative for that URL, not a delta — both PlayCanvas's
   * progress event and the stream reader below report running totals — so the
   * difference against the last value is what gets added.
   */
  report(url: string, loaded: number): void {
    const previous = this.counted.get(url) ?? 0;
    if (loaded <= previous) {
      return;
    }
    this.counted.set(url, loaded);
    this.received += loaded - previous;
    this.emit();
  }

  /** Credits a file's full manifest size, for loaders that report no bytes. */
  complete(url: string): void {
    const size = this.fileBytes(url);
    if (size > 0) {
      this.report(url, size);
    }
  }

  private emit(): void {
    // The manifest can be stale; never show more received than expected.
    this.listener?.(Math.min(this.received, this.total), this.total);
  }

  /**
   * Hooks PlayCanvas's asset registry once, instrumenting every texture and
   * sound the engine loads — `loadFromUrl` fires 'add' before it starts the
   * download, so a listener here sees them all without touching the ten call
   * sites that use it.
   *
   * The engine's progress comes from XHR, i.e. WIRE bytes. That matches the
   * manifest only because the assets it loads (jpg/png/mp3) are already
   * compressed and must stay out of any gzip configuration.
   */
  attachTo(app: pc.AppBase): void {
    app.assets.on('add', (asset: pc.Asset) => {
      const url = asset.getFileUrl();
      if (url == null) {
        return;
      }
      const key = normalise(url);
      asset.on('progress', (loaded: number) => this.report(key, loaded));
      // Not every path reports bytes: PlayCanvas falls back to a plain
      // `new Image()` where createImageBitmap is unavailable, and that is
      // silent. Crediting the manifest size on load keeps the bar moving.
      asset.on('load', () => this.complete(key));
      asset.on('error', () => this.complete(key));
    });
  }

  /**
   * fetch() that reports bytes as they arrive.
   *
   * Reading `response.body` counts DECODED bytes, which is what the manifest
   * stores — so a gzipped map XML credits its full 4 MB rather than the 180 KB
   * that crossed the wire. The bar runs optimistic rather than stalling.
   */
  async trackedFetch(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const key = normalise(url);
    if (response.body == null) {
      // No streaming support: credit the whole file once it is here.
      const buffer = await response.arrayBuffer();
      this.complete(key);
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      loaded += value.byteLength;
      this.report(key, loaded);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  }
}

/** Absolute URLs reach us from PlayCanvas; manifest keys are site paths. */
function normalise(url: string): string {
  if (url.startsWith('/')) {
    return url;
  }
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

/** The one instance the game uses. */
export const assetProgress = new AssetProgress();
