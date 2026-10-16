#!/usr/bin/env node
// Ships the repo's assets/ (git-lfs) into the backend's MinIO bucket, the
// counterpart of the root `npm run upload-assets` for R2. Idempotent: an
// object whose md5 (the bucket's ETag) matches the file is skipped.
//
//   node scripts/upload-assets.mjs                 # CC_MINIO_* from the environment / .env defaults
//   node scripts/upload-assets.mjs --dry-run
//
// Env: CC_MINIO_ENDPOINT (127.0.0.1), CC_MINIO_PORT (9000), CC_MINIO_USE_SSL (0),
//      CC_MINIO_ACCESSKEY / CC_MINIO_SECRETKEY (minioadmin), CC_MINIO_BUCKET (skilltanki-mobile-assets).
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'minio';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..', '..');
const assets = join(root, 'assets');
const DRY = process.argv.includes('--dry-run');
const CONCURRENCY = 8;

const env = (name, fallback) => (process.env[name] != null && process.env[name].trim() !== '' ? process.env[name].trim() : fallback);
const BUCKET = env('CC_MINIO_BUCKET', 'skilltanki-mobile-assets');
const client = new Client({
  endPoint: env('CC_MINIO_ENDPOINT', '127.0.0.1'),
  port: Number(env('CC_MINIO_PORT', '9000')),
  useSSL: env('CC_MINIO_USE_SSL', '0') === '1',
  accessKey: env('CC_MINIO_ACCESSKEY', 'minioadmin'),
  secretKey: env('CC_MINIO_SECRETKEY', 'minioadmin'),
});

const TYPES = { json: 'application/json', xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', '3ds': 'application/octet-stream' };
const typeOf = (key) => TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && !entry.name.startsWith('.')) out.push({ full, key: relative(assets, full).split(sep).join('/') });
  }
  return out;
};

const isLfsPointer = (full) => {
  const head = readFileSync(full, { encoding: 'utf8', flag: 'r' }).slice(0, 64);
  return head.startsWith('version https://git-lfs.github.com/spec');
};

const files = walk(assets);
console.log(`${files.length} files under assets/ -> bucket ${BUCKET}`);
if (!(await client.bucketExists(BUCKET))) {
  if (DRY) console.log('would create bucket', BUCKET);
  else await client.makeBucket(BUCKET);
}

// What is there already, by md5.
const existing = new Map();
await new Promise((resolve, reject) => {
  const stream = client.listObjectsV2(BUCKET, '', true);
  stream.on('data', (obj) => existing.set(obj.name, (obj.etag ?? '').replace(/"/g, '')));
  stream.on('end', resolve);
  stream.on('error', reject);
});

let uploaded = 0;
let skipped = 0;
let failed = 0;
const queue = [...files];
const started = Date.now();
const worker = async () => {
  for (;;) {
    const item = queue.shift();
    if (item == null) return;
    if (statSync(item.full).size < 200 && isLfsPointer(item.full)) {
      console.error('LFS pointer, not content (run `git lfs pull`):', item.key);
      failed += 1;
      continue;
    }
    const md5 = await new Promise((resolve, reject) => {
      const hash = createHash('md5');
      createReadStream(item.full).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
    });
    if (existing.get(item.key) === md5) {
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log('would put', item.key);
      uploaded += 1;
      continue;
    }
    try {
      await client.fPutObject(BUCKET, item.key, item.full, { 'Content-Type': typeOf(item.key) });
      uploaded += 1;
      if (uploaded % 100 === 0) console.log(`uploaded ${uploaded} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    } catch (error) {
      failed += 1;
      console.error('failed', item.key, error instanceof Error ? error.message : error);
    }
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`${DRY ? 'dry run' : 'done'}: ${uploaded} ${DRY ? 'to upload' : 'uploaded'}, ${skipped} already current${failed > 0 ? `, ${failed} FAILED` : ''} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed > 0 ? 1 : 0);
