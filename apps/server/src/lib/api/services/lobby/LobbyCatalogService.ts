// The lobby catalogue INSIDE the LobbyObject: the listings in the object's
// storage (`room:<id>`, one key per room) and the rules of the browse list.
// Pure over the Map the object holds; the object passes its storage in.
// A listing nobody refreshed for listingStaleMs (an orphaned room that never
// said goodbye) is dropped; so is a PLAYING room whose battle clock has run
// out (playingSince + durationMs, plus a grace for the final whistle to
// arrive) when its host never reported `finished` — the lazy pop on read, so
// a battle that lost its host still leaves the list on time. An empty or
// finished room is kept out of the browse list but stays readable by id
// until it is swept.
import type { RoomListing } from '../../../../model/protocol';

const PREFIX = 'room:';
/** A battle with no `durationMs` of its own runs this long (the client's BATTLE_DURATION_MS). */
const DEFAULT_DURATION_MS = 10 * 60 * 1000;
/** How long after the clock ran out a playing room is still believed (the host's `finished` on its way, a last respawn). */
const EXPIRY_GRACE_MS = 30 * 1000;

/** The battle's clock has run out and nobody said `finished`. */
export function battleExpired(listing: RoomListing, now: number): boolean {
  if (listing.phase !== 'playing' || listing.playingSince == null) return false;
  return now - listing.playingSince > (listing.durationMs ?? DEFAULT_DURATION_MS) + EXPIRY_GRACE_MS;
}

export class LobbyCatalogService {
  /** Every listing in storage, on wake. */
  public load = async (storage: DurableObjectStorage): Promise<Map<string, RoomListing>> => {
    const catalog = new Map<string, RoomListing>();
    for (const [key, listing] of await storage.list<RoomListing>({ prefix: PREFIX })) {
      catalog.set(key.slice(PREFIX.length), listing);
    }
    return catalog;
  };

  /** The browse list: fresh, non-empty, not finished, not run out of clock, newest first; `mode` narrows it. */
  public list = (catalog: Map<string, RoomListing>, mode: string | null, now: number, listingStaleMs: number): RoomListing[] =>
    [...catalog.values()]
      .filter((r) => now - r.updatedAt < listingStaleMs)
      .filter((r) => r.players > 0 && r.phase !== 'finished' && !battleExpired(r, now))
      .filter((r) => mode == null || r.mode === mode)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  public get = (catalog: Map<string, RoomListing>, id: string, now: number, listingStaleMs: number): RoomListing | null => {
    const listing = catalog.get(id) ?? null;
    if (listing == null || now - listing.updatedAt >= listingStaleMs) return null;
    // A battle that ran out of clock reads as finished (the room's own object may still be winding down).
    return battleExpired(listing, now) ? { ...listing, phase: 'finished' } : listing;
  };

  public upsert = async (storage: DurableObjectStorage, catalog: Map<string, RoomListing>, listing: RoomListing): Promise<void> => {
    catalog.set(listing.id, listing);
    await storage.put(PREFIX + listing.id, listing);
  };

  public remove = async (storage: DurableObjectStorage, catalog: Map<string, RoomListing>, id: string): Promise<void> => {
    catalog.delete(id);
    await storage.delete(PREFIX + id);
  };

  /** Forgets the stale and the run-out listings for good (they are already invisible); returns their ids. */
  public sweep = async (storage: DurableObjectStorage, catalog: Map<string, RoomListing>, now: number, listingStaleMs: number): Promise<string[]> => {
    const gone: string[] = [];
    for (const [id, listing] of catalog) {
      if (now - listing.updatedAt >= listingStaleMs || battleExpired(listing, now)) gone.push(id);
    }
    for (const id of gone) {
      catalog.delete(id);
      await storage.delete(PREFIX + id);
    }
    return gone;
  };
}

export default LobbyCatalogService;
