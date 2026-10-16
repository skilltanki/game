// Worker bindings and vars (declared in wrangler.jsonc here for dev and at
// the repo root for production). Routes and the Durable Objects are the only
// code that holds an Env; the di-kit services receive it as an argument.
import type { LobbyObject } from './durable/LobbyObject';

export interface Env {
  /** One Durable Object per room: peers, signalling, host election. */
  ROOM: DurableObjectNamespace;
  /** The lobby index: ONE Durable Object (name "lobby") with every room's listing (strongly consistent). */
  LOBBY_INDEX: DurableObjectNamespace<LobbyObject>;
  /** Small caches (the minted TURN credentials); the room listings left KV for LOBBY_INDEX (see migrate/). */
  CACHE: KVNamespace;
  /**
   * The game assets: the R2 bucket `npm run upload-assets` fills from the
   * repo's assets/ (dev: workerd's local bucket, `--local`). Served at
   * /assets/* by the SAME route in dev and prod.
   */
  ASSETS: R2Bucket;
  /** Workers Static Assets with the PWA shell (production only; Vite serves it in dev). */
  SITE?: Fetcher;
  /** "1" in the dev config only: enables PUT /__dev/assets/* so `upload-assets --local` can seed the local bucket. */
  CC_DEV_SEED?: string;
  /** Comma-separated STUN URLs for the peers' RTCPeerConnection (default: Google + Cloudflare). */
  CC_ICE_STUN_URLS?: string;
  /** A relay of your own (comma-separated TURN URLs, static credentials); unset = Cloudflare TURN below, or none. */
  CC_ICE_TURN_URL?: string;
  CC_ICE_TURN_USERNAME?: string;
  CC_ICE_TURN_CREDENTIAL?: string;
  /** Cloudflare Realtime TURN key (dashboard → Realtime → TURN): the id as a var, the token as a secret. */
  CC_CF_TURN_KEY_ID?: string;
  CC_CF_TURN_API_TOKEN?: string;
  /** Life of the minted TURN credentials, seconds (default 86400; cached in KV for half of it). */
  CC_CF_TURN_TTL_S?: string;
  /** An empty room deletes itself after this long. */
  CC_EMPTY_GRACE_MS?: string;
  /** A disconnected peer may rejoin with its token for this long. */
  CC_REJOIN_TTL_MS?: string;
  /** A listing nobody refreshed for this long is dropped from the lobby. */
  CC_LISTING_STALE_MS?: string;
}
