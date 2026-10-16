// The lobby index as the routes and the room objects see it: ONE Durable
// Object (LobbyObject, name "lobby") holds every listing, so a room that
// changed in one data centre is in the next list from any other at once —
// strongly consistent, unlike the KV index it replaced (eventually
// consistent, up to a minute between regions). This service is the client
// side: it finds the object and calls its RPC methods.
import type { Env } from '../../../../env';
import type { RoomListing } from '../../../../model/protocol';

/** There is one lobby: one object, one name. */
const LOBBY_NAME = 'lobby';

export class LobbyIndexService {
  private stub(env: Env): DurableObjectStub<import('../../../../durable/LobbyObject').LobbyObject> {
    return env.LOBBY_INDEX.get(env.LOBBY_INDEX.idFromName(LOBBY_NAME));
  }

  public list = async (env: Env, mode: string | null): Promise<RoomListing[]> => this.stub(env).list(mode);

  public get = async (env: Env, id: string): Promise<RoomListing | null> => this.stub(env).get(id);

  public upsert = async (env: Env, listing: RoomListing): Promise<void> => {
    await this.stub(env).upsert(listing);
  };

  public remove = async (env: Env, id: string): Promise<void> => {
    await this.stub(env).remove(id);
  };
}

export default LobbyIndexService;
