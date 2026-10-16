# packages/backend — SkillTanki backend v3 (self-hosted)

The same lobby + WebRTC signalling + assets API as `apps/server` (the
Cloudflare Worker), on a stack you host yourself: **Bun + Hono** for HTTP
and WebSockets, **Redis** for the live rooms, the lobby index, the TURN
cache and the pub/sub between processes, **MongoDB** for the room journal,
**MinIO** for the game assets. The mobile client speaks one protocol to
both backends (`src/model/protocol.ts` is a copy of the Worker's).

```
npm run services -w skilltanki-backend     # docker compose: redis, mongo, minio (docker/docker-compose.yaml)
npm run upload-assets -w skilltanki-backend   # the repo's assets/ into the MinIO bucket (md5-skip)
npm run dev -w skilltanki-backend          # one process on :30050 (bun --watch), the sweeper inside
npm run start -w skilltanki-backend        # a supervisor + one process per port 30050,30051,30052
npm run test:signal -w skilltanki-backend  # two fake peers through the whole flow (needs CC_EMPTY_GRACE_MS=5000)
npm run typecheck -w skilltanki-backend
```

Configuration: `CC_*` variables, see `.env.example` (bun loads `.env`).
The PWA shell: build it (`npm run build:mobile`) and point
`CC_WWWROOT_PATH` at `apps/mobile/dist`; the API routes come first, the
shell answers everything else. To drive the mobile dev server at this
backend: `CC_API_PROXY=http://localhost:30050 npm run dev:mobile`.

## Layout

```
src/index.ts            main/bootstrap (the supervisor), main/hono (the server)
src/config/params.ts    CC_* with defaults; the room limits and ICE defaults of the Worker
src/config/app.ts       the Hono app: CORS, errors, wait-for-stores middleware, createBunWebSocket
src/model/protocol.ts   COPY of apps/server/src/model/protocol.ts (rule 10: no imports between packages)
src/model/errors.ts     COPY: ApiError (code → HTTP status)
src/model/room.ts       RoomState as it lives in Redis (JSON), RoomSocket (a socket's identity)
src/contract/           the pub/sub messages between processes (room-event, room-close)
src/schema/Room.schema.ts   mongoose: the room journal
src/lib/api/            di-kit: core/{di,types,provide}.ts, index.ts facade `api` (also globalThis.api)
  services/base         Logger (pinolog), Clock, Id, Bootstrap (args, ports, children), Redis, Mongoose, Minio
  services/validation   COPIES of the Worker's request / socket-frame validation
  services/room         COPIES of the Worker's pure rules: membership (join/leave/host election), snapshot, relay, lifecycle
  services/store        RoomStoreService (Redis JSON + lock + socket table), LobbyIndexService (Redis hash + the browse rules),
                        RoomRecordService (Mongo journal), AssetStorageService (MinIO)
  services/realtime     ProcessPresenceService (heartbeat: which processes live), SocketRegistryService (this process's sockets), RoomBusService (Redis pub/sub fan-out),
                        RoomSessionService (what the Durable Object did: create/join/message/gone), RoomSweepService (prune, purge, stale)
  services/public       RoomApiService, IceConfigService (TURN minted, cached in Redis), AssetRouteService
src/routes/             health, rooms, ice, signal (upgradeWebSocket), assets — register on `app` when imported
scripts/test-signal.mjs the Worker's end-to-end check, aimed at :30050
scripts/upload-assets.mjs   assets/ → MinIO
```

## How a room lives

- `POST /api/rooms` writes the state to Redis (`<prefix>:room:<id>`, JSON, expiring twice the listing-stale time after its last write), its listing to the lobby hash (`<prefix>:lobby`) and a document to Mongo (`rooms`).
- A socket on `/ws/room/:id` sends `join`; the handler takes the room's lock (`SET NX PX`), seats the peer (the Worker's `RoomMembershipService`), records which socket carries the seat (`:sockets` hash), answers `welcome`, and publishes `peerJoined` / `hostChanged` on the bus. Every process that holds a socket of that room delivers it.
- `signal` is relayed through the bus to the target peer, wherever its socket is. `listing` (the host) changes the phase and re-stamps `playingSince`. `leave` frees the seat.
- A closed socket keeps the seat for `CC_REJOIN_TTL_MS` (a reconnect with the token takes it back; the old socket, on any process, is closed `4001 replaced`). The sweeper (one process: `--firstPort`) prunes expired seats every 2 s, purges a room empty for `CC_EMPTY_GRACE_MS`, and drops stale or run-out listings.
- Several processes (`--bootstrap=…`) or several machines share one Redis: nothing is process-local but the sockets.

## Production front

`config/nginx.conf` at the repo root is the recommended reverse proxy: TLS and HTTP/2, the PWA shell served by nginx from `apps/mobile/dist`, `/api/` and `/ws/` (WebSocket upgrade, 120 s idle) and `/assets/` (cached on disk for 30 days) proxied to the three `--bootstrap` processes with `least_conn`. Any process may serve any player — the rooms and the signalling live in Redis — so no sticky sessions.

## Differences from the Worker

- The TURN credentials cache lives in Redis (`<prefix>:ice:cloudflare`) instead of KV.
- SIGTERM / SIGINT (a deploy, pm2 restart, Ctrl-C): the process closes its sockets with `1001 server restart` (the clients come back with their tokens — to another process behind the balancer, or to the respawned one), lets the departures reach Redis (up to 2 s), drops its presence key at once, stops the server and the stores, exits. The supervisor's SIGTERM stops its children without respawning them.
- A crashed process sends no close for its sockets. Every process heartbeats a Redis key (`<prefix>:proc:<id>`, 10 s TTL) and the socket table names the process behind each seat; the sweeper (every second) lets the seats of a dead process go (`peerLeft`, the host election) within the TTL plus one sweep. Run under the supervisor so a crashed process is respawned.
- `PUT /__dev/assets/*` needs `CC_DEV_SEED=1`; `scripts/upload-assets.mjs` talks to MinIO directly and needs no route.
