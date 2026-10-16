// The lobby index: ONE Durable Object (name "lobby") with every room's
// listing, read by the browse routes and written by the room objects
// (join / leave / phase / purge). Strongly consistent: a change is in the
// very next list from any region. Thin on purpose — the rules live in
// LobbyCatalogService; this class owns the Map, the storage and the RPC
// surface. The constructor runs on every wake, so the catalogue is reloaded
// from storage.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { readParams } from '../config/params';
import type { RoomListing } from '../model/protocol';
import { api } from '../lib/api';

export class LobbyObject extends DurableObject<Env> {
  private catalog = new Map<string, RoomListing>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.catalog = await api.lobbyCatalogService.load(ctx.storage);
    });
  }

  /** The browse list; the stale listings met on the way are forgotten for good. */
  async list(mode: string | null): Promise<RoomListing[]> {
    const now = api.clockService.now();
    const { listingStaleMs } = readParams(this.env);
    const gone = await api.lobbyCatalogService.sweep(this.ctx.storage, this.catalog, now, listingStaleMs);
    if (gone.length > 0) api.loggerService.log('lobbyObject', 'stale listings swept', { gone });
    return api.lobbyCatalogService.list(this.catalog, mode, now, listingStaleMs);
  }

  async get(id: string): Promise<RoomListing | null> {
    const { listingStaleMs } = readParams(this.env);
    return api.lobbyCatalogService.get(this.catalog, id, api.clockService.now(), listingStaleMs);
  }

  async upsert(listing: RoomListing): Promise<void> {
    await api.lobbyCatalogService.upsert(this.ctx.storage, this.catalog, listing);
  }

  async remove(id: string): Promise<void> {
    await api.lobbyCatalogService.remove(this.ctx.storage, this.catalog, id);
  }
}

export default LobbyObject;
