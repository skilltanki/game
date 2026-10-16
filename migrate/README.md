# migrate/

One-off data migrations of the production backend (apps/server), one script
per change, named by date. Each script says when to run it (before or after
`npm run deploy`), what it needs (`wrangler login`) and is idempotent.

| Script | What it moves |
| --- | --- |
| `2026-10-15-lobby-index-kv-to-do.mjs` | the lobby index from KV (`room:<id>` keys, listing in metadata) into the `LobbyObject` Durable Object (binding `LOBBY_INDEX`): republishes every fresh room through `POST /api/rooms/:id/republish`, then deletes the KV keys. Run after the deploy that carries Durable Object migration `v2`. `--dry-run` shows the plan. |

Durable Object class migrations themselves (`new_sqlite_classes` and the
like) live in `wrangler.jsonc` under `migrations` and are applied by
`wrangler deploy`; the scripts here move the data that the code change
left behind.
