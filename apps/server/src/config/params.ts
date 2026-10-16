// Runtime parameters: wrangler `vars` (Env) with defaults. A Worker has no
// process.env; everything is read from the Env the request or the Durable
// Object was given, through this one function.
import type { Env } from '../env';

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
 * default to — the Open Relay Project resolves to 192.0.2.1, freestun and
 * freeturn are gone — so the relay is minted from the worker's own
 * Cloudflare account (IceConfigService) or set through CC_ICE_TURN_*.
 */
export const CC_DEFAULT_STUN_URLS = 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478';

/**
 * The project's own Cloudflare Realtime TURN key ("skilltanki-mobile"), baked
 * in so a fresh checkout relays out of the box (the owner's call). The vars
 * CC_CF_TURN_KEY_ID / CC_CF_TURN_API_TOKEN override it; the token can be
 * rotated in the dashboard (Realtime → TURN) if it ever leaks.
 */
export const CC_DEFAULT_CF_TURN_KEY_ID = 'b65a3a1f03350937bf70efc45d0f7f20';
export const CC_DEFAULT_CF_TURN_API_TOKEN = 'f467e31684e573ba0f9156971a954299af5395011ac13bdfab9a3b541cc2ce4d';

const number = (raw: string | undefined, fallback: number): number => {
  const value = raw != null ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const csv = (raw: string | undefined, fallback: string): string[] =>
  (raw != null && raw.trim() !== '' ? raw : fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export function readParams(env: Env): Params {
  // Your own relay: one or more TURN URLs with a static user name and credential.
  const turnUrls = csv(env.CC_ICE_TURN_URL, '');
  return {
    stunUrls: csv(env.CC_ICE_STUN_URLS, CC_DEFAULT_STUN_URLS),
    turn: turnUrls.length > 0 ? { urls: turnUrls, username: env.CC_ICE_TURN_USERNAME ?? '', credential: env.CC_ICE_TURN_CREDENTIAL ?? '' } : null,
    emptyGraceMs: number(env.CC_EMPTY_GRACE_MS, 60_000),
    rejoinTtlMs: number(env.CC_REJOIN_TTL_MS, 60_000),
    listingStaleMs: number(env.CC_LISTING_STALE_MS, 600_000),
  };
}
