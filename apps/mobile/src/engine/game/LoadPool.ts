// A gate on how many assets download at once.
//
// A map is a few hundred props: without a gate MapLoader asks for every mesh
// and texture in one burst, HTTP/2 opens them all, each stream gets a sliver
// of the link, and the decode/upload work lands in one lump when they finish
// — the loading bar stands still and then leaps. With LIMIT in flight the
// files finish one after another, the bytes are credited as they land
// (AssetProgress) and the main thread gets the parse of one file while the
// next downloads, so the bar moves the way the data does.
//
// Two routes carry assets (see AssetProgress) and both go through the pool:
//  - everything fetched by hand (`AssetProgress.trackedFetch`: map XML,
//    library.xml, .3ds, tank skins) calls `run()`;
//  - everything PlayCanvas loads itself (textures, sounds) goes through
//    `AssetRegistry.load`, which `installLoadPool` wraps at runtime. The
//    engine version is pinned (package.json), so patching its registry is
//    safe — the owner's call over touching the ten call sites that use
//    `loadFromUrl`. The wrapper mirrors the registry's own early exit
//    (`loading || loaded` without `force`) and flags a queued asset as
//    `loading` at once, so a second `loadFromUrl` for the same URL while it
//    waits joins the first load instead of queueing another.

import type * as pc from 'playcanvas';

/** Downloads in flight at once, both routes together. */
export const LOAD_LIMIT = 5;

export class LoadPool {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(public readonly limit: number) {}

  /** Runs `task` once a slot is free; the slot is released when its promise settles. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  /** For diagnostics (`globalThis.tanki` consoles): what is running and what waits. */
  get state(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }
}

/** The one pool the game uses. */
export const loadPool = new LoadPool(LOAD_LIMIT);

interface LoadOptions {
  force?: boolean;
}

type RegistryLoad = (asset: pc.Asset, options?: LoadOptions) => void;

/**
 * Puts the engine's own downloads through the pool: wraps
 * `app.assets.load` so each asset waits for a slot and frees it on its
 * `load` or `error`. Call once, right after the app is created.
 */
export function installLoadPool(app: pc.AppBase, pool: LoadPool = loadPool): void {
  const registry = app.assets;
  const original = (registry.load as RegistryLoad).bind(registry);
  const pooled: RegistryLoad = (asset, options) => {
    if ((asset.loading || asset.loaded) && !options?.force) {
      return;
    }
    // Claimed: a repeat request meanwhile takes the early exit above and waits on the asset's events.
    asset.loading = true;
    void pool.run(
      () =>
        new Promise<void>((done) => {
          const finish = (): void => {
            asset.off('load', finish);
            asset.off('error', finish);
            done();
          };
          asset.on('load', finish);
          asset.on('error', finish);
          // The registry sets `loading` itself and refuses an asset already flagged: hand it back clean.
          asset.loading = false;
          original(asset, options);
          // No file to fetch (data-only assets): the registry opens them synchronously and `load` fired above.
          if (asset.loaded && !asset.loading) finish();
        }),
    );
  };
  registry.load = pooled as typeof registry.load;
}
