#!/usr/bin/env node
// Migration: the lobby index moves from KV into the LobbyObject Durable
// Object (apps/server/src/durable/LobbyObject.ts, binding LOBBY_INDEX).
//
// What it does, in order:
//   1. reads every `room:<id>` key of the old KV index (the listing is in the
//      key's metadata) — the namespace that is now bound as CACHE;
//   2. for every listing still fresh (updatedAt within --stale-ms, default
//      CC_LISTING_STALE_MS = 600000) asks the deployed worker to republish the
//      room: POST /api/rooms/<id>/republish — the room's own Durable Object
//      writes its CURRENT listing into LobbyObject (a room that is gone is 404
//      and skipped);
//   3. deletes the `room:*` keys from KV (`ice:cloudflare` and anything else
//      stays). Pass --keep-kv to leave them.
//
// Run AFTER `npm run deploy` (the deploy applies the v2 Durable Object
// migration in wrangler.jsonc). Needs `wrangler login` (the KV reads and
// deletes go through wrangler). Idempotent: a second run finds no keys.
//
//   node migrate/2026-10-15-lobby-index-kv-to-do.mjs [--base https://mobile.skilltanki.workers.dev]
//        [--namespace-id 332f566313d1471080f16d208883829b] [--stale-ms 600000] [--dry-run] [--keep-kv]
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};
const BASE = flag('--base', 'https://mobile.skilltanki.workers.dev').replace(/\/$/, '');
const NAMESPACE_ID = flag('--namespace-id', '332f566313d1471080f16d208883829b');
const STALE_MS = Number(flag('--stale-ms', '600000'));
const DRY = args.includes('--dry-run');
const KEEP_KV = args.includes('--keep-kv');
const PREFIX = 'room:';

const wrangler = (...cli) =>
  execFileSync('npx', ['wrangler', ...cli], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

console.log(`lobby index: KV ${NAMESPACE_ID} -> LobbyObject at ${BASE}${DRY ? ' (dry run)' : ''}`);

// 1. the old index
const raw = wrangler('kv', 'key', 'list', '--namespace-id', NAMESPACE_ID, '--prefix', PREFIX, '--remote');
const keys = JSON.parse(raw.slice(raw.indexOf('[')));
console.log(`${keys.length} listing(s) in KV`);
const now = Date.now();

// 2. republish the fresh ones through their own room objects
let republished = 0;
let gone = 0;
let stale = 0;
for (const key of keys) {
  const id = key.name.slice(PREFIX.length);
  const listing = key.metadata ?? null;
  if (listing == null || now - Number(listing.updatedAt) >= STALE_MS) {
    stale += 1;
    continue;
  }
  if (DRY) {
    console.log('would republish', id, listing.host, listing.phase);
    republished += 1;
    continue;
  }
  const response = await fetch(`${BASE}/api/rooms/${id}/republish`, { method: 'POST' });
  if (response.status === 404) {
    gone += 1;
    console.log('room is gone', id);
    continue;
  }
  if (!response.ok) {
    console.error('republish failed', id, response.status, await response.text());
    process.exit(1);
  }
  republished += 1;
  console.log('republished', id, listing.host, listing.phase);
}

// 3. the KV keys are history
let deleted = 0;
if (!KEEP_KV) {
  for (const key of keys) {
    if (DRY) {
      console.log('would delete', key.name);
      deleted += 1;
      continue;
    }
    wrangler('kv', 'key', 'delete', '--namespace-id', NAMESPACE_ID, '--remote', key.name);
    deleted += 1;
  }
}

console.log(`${DRY ? 'dry run' : 'done'}: ${republished} republished, ${gone} gone, ${stale} stale, ${deleted} KV key(s) ${DRY ? 'to delete' : 'deleted'}`);
