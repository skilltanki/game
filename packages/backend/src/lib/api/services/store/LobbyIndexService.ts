// The lobby index in Redis: one hash (`<prefix>:lobby`), one field per room
// with its listing as JSON — a single HGETALL serves the browse screen. The
// rules are the Worker's LobbyCatalogService: a listing nobody refreshed for
// listingStaleMs is dropped, so is a PLAYING room whose clock has run out
// (playingSince + durationMs + a grace) when its host never said
// `finished`; an empty or finished room is out of the browse list but stays
// readable by id until the sweep forgets it.
import type { RoomListing } from '../../../../model/protocol';
import { readParams } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type RedisService from '../base/RedisService';

/** A battle with no `durationMs` of its own runs this long (the client's BATTLE_DURATION_MS). */
const DEFAULT_DURATION_MS = 10 * 60 * 1000;
/** How long after the clock ran out a playing room is still believed (the host's `finished` on its way, a last respawn). */
const EXPIRY_GRACE_MS = 30 * 1000;

/** The battle's clock has run out and nobody said `finished`. */
export function battleExpired(listing: RoomListing, now: number): boolean {
  if (listing.phase !== 'playing' || listing.playingSince == null) return false;
  return now - listing.playingSince > (listing.durationMs ?? DEFAULT_DURATION_MS) + EXPIRY_GRACE_MS;
}

export class LobbyIndexService {
  private readonly redisService = inject<RedisService>(TYPES.redisService);

  private get key(): string {
    return this.redisService.key('lobby');
  }

  private async all(): Promise<RoomListing[]> {
    const raw = await this.redisService.getRedis().hgetall(this.key);
    return Object.values(raw).map((json) => JSON.parse(json) as RoomListing);
  }

  /** The browse list: fresh, non-empty, not finished, not run out of clock, newest first; `mode` narrows it. */
  public list = async (mode: string | null, now: number): Promise<RoomListing[]> => {
    const { listingStaleMs } = readParams();
    return (await this.all())
      .filter((r) => now - r.updatedAt < listingStaleMs)
      .filter((r) => r.players > 0 && r.phase !== 'finished' && !battleExpired(r, now))
      .filter((r) => mode == null || r.mode === mode)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  public get = async (id: string, now: number): Promise<RoomListing | null> => {
    const raw = await this.redisService.getRedis().hget(this.key, id);
    if (raw == null) return null;
    const listing = JSON.parse(raw) as RoomListing;
    if (now - listing.updatedAt >= readParams().listingStaleMs) return null;
    // A battle that ran out of clock reads as finished (the room itself may still be winding down).
    return battleExpired(listing, now) ? { ...listing, phase: 'finished' } : listing;
  };

  /** Every room id on record (the sweeper walks them). */
  public ids = async (): Promise<string[]> => this.redisService.getRedis().hkeys(this.key);

  public upsert = async (listing: RoomListing): Promise<void> => {
    await this.redisService.getRedis().hset(this.key, listing.id, JSON.stringify(listing));
  };

  public remove = async (id: string): Promise<void> => {
    await this.redisService.getRedis().hdel(this.key, id);
  };

  /** Forgets the stale and the run-out listings for good; returns their ids. */
  public sweep = async (now: number): Promise<string[]> => {
    const { listingStaleMs } = readParams();
    const gone = (await this.all()).filter((r) => now - r.updatedAt >= listingStaleMs || battleExpired(r, now)).map((r) => r.id);
    if (gone.length > 0) await this.redisService.getRedis().hdel(this.key, ...gone);
    return gone;
  };
}

export default LobbyIndexService;
