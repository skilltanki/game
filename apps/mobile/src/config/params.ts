// Build-time parameters of the mobile client. Everything that differs
// between dev, PWA and the future Capacitor build is read here and nowhere
// else (mirrors the config/params.ts convention of the backend libs).

/**
 * Where the long tail of game assets lives: /assets/ on the page's own
 * origin, always. In production that is the API worker (apps/server), which
 * serves the repo's assets/ tree next to the PWA shell; in development the
 * Vite dev server proxies /assets to `npm run dev:server` (wrangler dev on
 * :8787). Must end with '/'.
 */
export const CC_REMOTE_ASSET_BASE: string = new URL('/assets/', location.origin).href;

/**
 * Bump to retire every cached asset on the next launch: the /assets/ keys
 * are not content-hashed, so a changed file under the same key would
 * otherwise stay stale in the service worker cache for a month.
 */
export const CC_ASSET_CACHE_VERSION = 1;

/** Physics step of the engine (TankPhysicsScene.PHYSICS_STEP_IN_MS). */
export const CC_PHYSICS_STEP_MS = 33;

/** Default loadout for a first launch. */
export const CC_DEFAULT_HULL = 'Hunter';
export const CC_DEFAULT_TURRET = 'Smoky';
export const CC_DEFAULT_MAP = 'island_old_summer';
/**
 * Bots in a single-player battle: five by default (the field feels like a
 * free-for-all without getting crowded; the owner's call), up to as many
 * tanks as a full room holds (CC_ROOM_MAX_PLAYERS − 1 = 11 bots + the player).
 */
export const CC_DEFAULT_BOTS = 5;
export const CC_MAX_BOTS = 11;

/** Rooms (the backend's CC_ROOM_LIMITS: 2–8 players, 15–600 s, password ≤ 32). */
export const CC_ROOM_MIN_PLAYERS = 2;
/** Full mesh ceiling (apps/server CC_ROOM_LIMITS.maxPlayers): 6 v 6. */
export const CC_ROOM_MAX_PLAYERS = 12;
/**
 * Bots a room's host ADDS by default: none — people fill a room, extra bots
 * are opt-in per room. This is only the seat count at START; a player who
 * leaves mid-battle is always handed to the host's bot brain
 * (NetBattleService.onPeerLeft → takeOverBot), whatever this says.
 */
export const CC_DEFAULT_ROOM_BOTS = 0;
/** Bots a room may add on top of its players: they are spread over the players' machines, one brain each at most ~2 per phone with a full room. */
export const CC_ROOM_MAX_BOTS = 12;
/** Battle lengths the create form offers, minutes. */
export const CC_ROOM_DURATIONS_MIN: number[] = [5, 10, 15, 20];
export const CC_ROOM_NAME_MAX = 24;
export const CC_ROOM_PASSWORD_MAX = 32;

/** localStorage keys. */
export const CC_STORAGE_PREFIX = 'skilltanki.mobile.';

/** Logging to the console (dev builds only by default). */
export const CC_ENABLE_LOGS: boolean = import.meta.env.DEV;

/**
 * Ad placements. Ads are modal interstitials only; nothing is shown until an
 * AdProvider other than the no-op one is provided (services/base/AdService.ts).
 */
export const CC_AD_PLACEMENTS = {
  /** After the battle result, on CONTINUE. */
  resultInterstitial: 'result-interstitial',
  /** Before a battle starts (menu -> loading). */
  battleStartInterstitial: 'battle-start-interstitial',
} as const;

/** The project's Telegram channel (the original client's "backup link" button). */
export const CC_TELEGRAM_URL = 'https://t.me/+xuT2WgGTsssxYjUy';
