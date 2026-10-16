// Asset URL resolution, installed into the engine BEFORE any engine module
// is imported (several of them call assetUrl() at import time).
//
// One source: /assets/ on the page's own origin (CC_REMOTE_ASSET_BASE) — the
// API worker serves the repo's assets/ tree there; in development the Vite
// proxy forwards it to `npm run dev:server`. Nothing is copied into
// public/; the service worker caches what the player has loaded.
//
// This module is deliberately engine-free apart from the resolver setter,
// which has no import-time side effects.
import { setAssetUrlResolver } from '../engine/tank/TankAssets';
import { CC_REMOTE_ASSET_BASE } from './params';

export function remoteUrl(path: string): string {
  return new URL(normalise(path).replace(/^\//, ''), CC_REMOTE_ASSET_BASE).href;
}

/** The one resolver: absolute URLs pass through, everything else lives under /assets/. */
export function resolveAssetUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }
  return remoteUrl(path);
}

function normalise(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/** Binds the engine's assetUrl() to the resolver above. */
export function installAssetResolver(): void {
  setAssetUrlResolver(resolveAssetUrl);
}
