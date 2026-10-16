// Runtime parameters: CC_* environment variables with defaults (bun loads
// .env on start). Read once at module evaluation, exported as constants — the
// tad-core-signing convention; nothing reads process.env anywhere else.

const int = (raw: string | undefined, fallback: number): number => {
  const value = raw != null && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const text = (raw: string | undefined, fallback: string): string => (raw != null && raw.trim() !== '' ? raw.trim() : fallback);

const flag = (raw: string | undefined): boolean => raw === '1' || raw === 'true';

const csv = (raw: string | undefined, fallback: string): string[] =>
  (raw != null && raw.trim() !== '' ? raw : fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// --- the process -----------------------------------------------------------------------

export const CC_WWWROOT_PORT = int(process.env.CC_WWWROOT_PORT, 30050);
/** The PWA shell served at / (the mobile build); empty = API only. */
export const CC_WWWROOT_PATH = text(process.env.CC_WWWROOT_PATH, '');
export const CC_ENABLE_LOGS = flag(process.env.CC_ENABLE_LOGS);

// --- Redis ------------------------------------------------------------------------------

export const CC_REDIS_HOST = text(process.env.CC_REDIS_HOST, '127.0.0.1');
export const CC_REDIS_PORT = int(process.env.CC_REDIS_PORT, 6379);
export const CC_REDIS_USER = text(process.env.CC_REDIS_USER, 'default');
/** Empty: no AUTH (the compose file in docker/ runs Redis without a password). */
export const CC_REDIS_PASSWORD = text(process.env.CC_REDIS_PASSWORD, '');
/** Every Redis key of this backend starts with it (several backends may share one Redis). */
export const CC_REDIS_PREFIX = text(process.env.CC_REDIS_PREFIX, 'skilltanki');

// --- MongoDB ----------------------------------------------------------------------------

export const CC_MONGO_CONNECTION_STRING = text(process.env.CC_MONGO_CONNECTION_STRING, 'mongodb://127.0.0.1:27017/skilltanki-mobile?wtimeoutMS=15000');

// --- MinIO ------------------------------------------------------------------------------

export const CC_MINIO_ENDPOINT = text(process.env.CC_MINIO_ENDPOINT, '127.0.0.1');
export const CC_MINIO_PORT = int(process.env.CC_MINIO_PORT, 9000);
export const CC_MINIO_USE_SSL = flag(process.env.CC_MINIO_USE_SSL);
export const CC_MINIO_ACCESSKEY = text(process.env.CC_MINIO_ACCESSKEY, 'minioadmin');
export const CC_MINIO_SECRETKEY = text(process.env.CC_MINIO_SECRETKEY, 'minioadmin');
export const CC_MINIO_BUCKET = text(process.env.CC_MINIO_BUCKET, 'skilltanki-mobile-assets');

// --- rooms (the same rules as apps/server) ----------------------------------------------

export interface Params {
  stunUrls: string[];
  turn: { urls: string[]; username: string; credential: string } | null;
  emptyGraceMs: number;
  rejoinTtlMs: number;
  listingStaleMs: number;
}

/** Hard limits of a room (the old lobby's clamps, players capped by the mesh size). */
export const CC_ROOM_LIMITS = {
  minPlayers: 2,
  /**
   * Full mesh: every peer holds a DataChannel to every other and simulates
   * every other tank. 12 (6 v 6) is the ceiling that keeps a phone's 33 ms
   * step and its uplink (11 links × ~20 msg/s × ~150 B ≈ 33 KB/s) honest.
   */
  maxPlayers: 12,
  defaultPlayers: { dm: 12, tdm: 12, ctf: 12, assault: 12 } as Record<string, number>,
  minDurationMs: 15_000,
  maxDurationMs: 600_000,
  maxPasswordLength: 32,
  maxNameLength: 20,
  maxMapNameLength: 60,
};

/** A signalling payload (SDP or ICE candidate) larger than this is dropped. */
export const CC_MAX_SIGNAL_BYTES = 16 * 1024;

/**
 * Out-of-the-box ICE: Google's and Cloudflare's public STUN (both answer a
 * binding request as of 2026-10-15). There is no public TURN left to
 * default to, so the relay is minted from the project's Cloudflare Realtime
 * TURN key below (IceConfigService) or set through CC_ICE_TURN_*.
 */
export const CC_DEFAULT_STUN_URLS = 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478';

/**
 * The project's own Cloudflare Realtime TURN key ("skilltanki-mobile"), baked
 * in so a fresh checkout relays out of the box (the owner's call). The vars
 * CC_CF_TURN_KEY_ID / CC_CF_TURN_API_TOKEN override it ("none" turns it off).
 */
export const CC_DEFAULT_CF_TURN_KEY_ID = 'b65a3a1f03350937bf70efc45d0f7f20';
export const CC_DEFAULT_CF_TURN_API_TOKEN = 'f467e31684e573ba0f9156971a954299af5395011ac13bdfab9a3b541cc2ce4d';

export const CC_CF_TURN_KEY_ID = text(process.env.CC_CF_TURN_KEY_ID, CC_DEFAULT_CF_TURN_KEY_ID);
export const CC_CF_TURN_API_TOKEN = text(process.env.CC_CF_TURN_API_TOKEN, CC_DEFAULT_CF_TURN_API_TOKEN);
/** Life of the minted TURN credentials, seconds (cached in Redis for half of it). */
export const CC_CF_TURN_TTL_S = Math.max(600, int(process.env.CC_CF_TURN_TTL_S, 86400));

const turnUrls = csv(process.env.CC_ICE_TURN_URL, '');

export const PARAMS: Params = {
  stunUrls: csv(process.env.CC_ICE_STUN_URLS, CC_DEFAULT_STUN_URLS),
  turn: turnUrls.length > 0 ? { urls: turnUrls, username: process.env.CC_ICE_TURN_USERNAME ?? '', credential: process.env.CC_ICE_TURN_CREDENTIAL ?? '' } : null,
  emptyGraceMs: int(process.env.CC_EMPTY_GRACE_MS, 60_000),
  rejoinTtlMs: int(process.env.CC_REJOIN_TTL_MS, 120_000),
  listingStaleMs: int(process.env.CC_LISTING_STALE_MS, 600_000),
};

/** The same signature the Worker's services had: the rules read their numbers through one door. */
export function readParams(): Params {
  return PARAMS;
}
