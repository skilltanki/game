# skilltanki-api — the backend (Cloudflare Worker)

Lobby + WebRTC signalling for SkillTanki, plus the static tree the PWA and
its game data are served from. Hono routes, di-kit services, one Durable
Object per room. The battle itself never crosses this server: the players
hold a WebRTC mesh and the host peer is the authority (see *Realtime*).

```
src/
  index.ts              worker entry: Hono app + the RoomObject export
  env.ts                bindings and vars (wrangler.jsonc here = dev; repo root = production)
  config/params.ts      CC_* parameters read from the Env, room limits
  config/app.ts         the Hono app, CORS on /api/*, error → { status, code }
  model/protocol.ts     the wire contract (copy it into a client; no cross-package imports)
  model/room.ts         RoomState / PeerRecord / socket attachment
  model/errors.ts       ApiError (code → HTTP status)
  lib/api/              di-kit: core/{di,types,provide}.ts, index.ts facade `api`
    services/base       LoggerService, ClockService, IdService
    services/validation RoomRequestValidationService, SignalMessageValidationService
    services/lobby      LobbyIndexService (the client of the LobbyObject: list/get/upsert/remove over RPC),
                        LobbyCatalogService (inside the object: the listings in its storage, the browse rules)
    services/room       RoomStoreService (DO storage), RoomMembershipService (join/leave/host),
                        RoomSnapshotService (welcome/listing), SignalRelayService, RoomLifecycleService
    services/public     RoomApiService, IceConfigService, AssetRouteService (R2 → /assets/*)
  durable/RoomObject.ts the room's Durable Object: state + hibernating sockets, every rule in a service
  durable/LobbyObject.ts the lobby index: ONE Durable Object (name "lobby") with every listing — strongly
                        consistent across regions (it replaced the KV index; see ../../migrate/)
  routes/               health, rooms, ice, signal, assets — register on `app` when imported
scripts/test-signal.mjs two fake peers through the whole flow (needs `npm run dev`)
scripts/upload-assets.mjs the repo's assets/ into an R2 bucket (S3 API, md5-skip; --dry-run, --local)
```

Rules: a service is stateless (a Worker isolate comes and goes; a Durable
Object owns its state) — it gets the `Env`, the storage or the `RoomState`
as arguments. Services inject each other with `inject<T>(TYPES.x)` fields
and expose arrow-function methods. Routes and the DO are the only code that
holds `env`/`ctx`.

## HTTP

| Route | |
| --- | --- |
| `GET /health_check` | `{ status, service, now }` |
| `GET /api/rooms?mode=dm` | open rooms with players, newest first (`{ rooms: RoomListing[] }`) |
| `POST /api/rooms` | `CreateRoomRequest` → `{ id }` (201); mode dm/tdm/ctf/assault, 2–12 players |
| `GET /api/rooms/:id` | one listing, 404 when gone |
| `GET /api/ice` | `{ iceServers }` for `RTCPeerConnection` |
| `GET /ws/room/:id` | the signalling socket (Upgrade) |
| `GET /assets/*` | the game data from the R2 bucket (ETag / 304, immutable caching) — the same route in dev and prod |

Errors: `{ status: 'error', code }` — `bad_request` 400, `room_not_found` 404,
`room_full` 409, `bad_password` / `bad_token` / `not_host` 403, `finished` 410.

## Realtime

1. A player creates a room (`POST /api/rooms`) and everyone opens
   `wss://<host>/ws/room/<id>` and sends `join`.
2. The server answers `welcome` (your `peerId`, a rejoin `token`, the `hostId`
   and `hostEpoch`, the peers already there, the ICE servers, the room config)
   and tells the others `peerJoined`.
3. Peers exchange `signal { to, kind: offer|answer|ice, payload }` through the
   server; the relay stamps `from` from the socket, never from the message.
   Each pair ends up with its own `RTCDataChannel` (full mesh, ≤ 12 peers — 6 v 6) and
   the battle traffic (tank commands, snapshots) never touches the server.
4. The host — the connected peer with the lowest `joinSeq` — is the authority
   for damage, deaths, flags and the clock, and refreshes the lobby listing
   with `listing { phase }`. When the host's socket goes, the next peer is
   promoted and `hostChanged { hostId, hostEpoch }` goes out; peers ignore
   authority messages that carry an older epoch.
5. A dropped socket keeps its seat for `CC_REJOIN_TTL_MS`: `join` with the
   token resumes the same `peerId` (`peerJoined { rejoined: true }` tells the
   others to renegotiate), even while the old socket still reads as connected
   (a reloaded page, a dead radio: the token's bearer is the player, the old
   socket is closed `4001 replaced`). The client keeps the token in
   localStorage, so a page reload comes back to the same seat — mid-battle,
   to the tank a bot drove meanwhile. `leave` gives the seat up. An empty room deletes
   itself after `CC_EMPTY_GRACE_MS` (a Durable Object alarm).
6. LAN: the browsers' host ICE candidates connect phones on one Wi-Fi without
   internet (mDNS `.local` candidates; needs multicast allowed). STUN from
   `CC_ICE_STUN_URLS` (default Google) gives the public route; set
   `CC_ICE_TURN_URL/USERNAME/CREDENTIAL` for a relay.

The client's counterpart is `apps/mobile/src/lib/online` (its own di-kit
module: `SignallingService` for this socket, `MeshService` for the DataChannels,
`RoomSessionService` for the seats, `AuthorityService` / `ReplicaService` for
the host-peer rules); it holds a copy of `src/model/protocol.ts`.

TURN: peers behind symmetric NATs (most mobile carriers) cannot reach each
other with STUN alone. Teams: in `tdm` / `ctf` / `assault` a joiner that asks
for a side gets it; one that does not (the mobile client) lands on the emptier
side and switches in the lobby; `welcome.me` tells it where it sat.
`welcome.iceServers` always carries Google's and
Cloudflare's public STUN. There is no public TURN left to default to (the
Open Relay Project resolves to 192.0.2.1, freestun/freeturn are gone —
checked 2026-10-15), so the relay comes from the same Cloudflare account the
worker runs in: Realtime TURN, free up to 1 TB/month. The project's own key
(`skilltanki-mobile`) is baked into `src/config/params.ts`, so a fresh
checkout relays with nothing to set; rotate it in the dashboard (Realtime →
TURN) if it leaks, or override it: `"CC_CF_TURN_KEY_ID"` in the root
`wrangler.jsonc` plus `wrangler secret put CC_CF_TURN_API_TOKEN` (`none`
turns the relay off).

`IceConfigService` mints short-lived credentials
(`POST rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers`,
TTL `CC_CF_TURN_TTL_S`, default a day) and caches them in the CACHE KV for
half their life; `/api/ice` and every `welcome` carry
`turn:turn.cloudflare.com:3478` with them. Any other relay (coturn, Twilio
NTS): `CC_ICE_TURN_URL` (comma-separated) + `CC_ICE_TURN_USERNAME` as vars
and `wrangler secret put CC_ICE_TURN_CREDENTIAL`; that overrides the
Cloudflare path.

## Dev

```
npm run upload-assets -- --local   # once: seed workerd's local R2 bucket from assets/ (~4 min)
npm run dev:server                 # wrangler dev on :8787 — /assets/* from the local bucket
npm run dev:mobile                 # the PWA on :5173 — Vite proxies /assets, /api and /ws to :8787
npm run test:signal                # two fake peers through create → join → signal → host migration → purge
```
Two terminal tabs: `dev:server` first, then `dev:mobile`. Dependencies come
from the root `npm install` (wrangler is a root devDependency). No Cloudflare
account is needed for local work; to read the real bucket instead, add
`"remote": true` to the R2 binding in `apps/server/wrangler.jsonc`
(`wrangler login` first). Dev and prod run the very same asset route.

## Build and deploy (repo root)

`npm run build` → `scripts/build.mjs`: builds the PWA shell into
`build/public` (a few MB) and dry-runs the worker as a compile check.
`npm run deploy` builds and runs `wrangler deploy` with the repo-root
`wrangler.jsonc` (main = `apps/server/src/index.ts`, static = `build/public`,
R2 = `skilltanki-mobile-assets`). The assets are never in a deploy: publish them
with `npm run upload-assets` (see below) — once, then only what changed.
This folder's own `wrangler.jsonc` is the dev config only.

## Assets into R2

The worker serves `/assets/*` from the R2 bucket; the repo's `assets/` tree
(git-lfs) is the source and this script publishes it:

```
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… npm run upload-assets   # at the root
npm run upload-assets -- --dry-run     # what would change (no credentials: lists everything)
npm run upload-assets -- --local       # workerd's local R2 state
```

Keys are paths relative to `assets/`; objects whose size and md5 already
match are skipped, so a re-run after a change uploads only the change.
`R2_BUCKET` overrides the bucket (default `skilltanki-mobile-assets`). Without S3
keys, `npm run upload-assets -- --wrangler` goes through the wrangler login
instead (one `wrangler r2 object put --remote` per file, four at a time, about
ten minutes for the whole tree; a manifest in `.r2-upload/` makes re-runs
upload only what changed).
