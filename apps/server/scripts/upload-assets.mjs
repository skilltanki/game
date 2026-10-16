// Uploads the repo's assets/ (~180 MB, ~1330 files, git-lfs) into an R2
// bucket, key = path relative to assets/ (hulls.json, maps/summer/x.xml, …).
// Idempotent by construction: every run lists the bucket first and skips
// objects whose size + md5 already match, so a crashed run just continues
// and a re-run after a small change uploads only that change.
//
// Content-Type is set per extension at upload time: the edge compresses only
// compressible types (xml/json), binaries go out as they are.
//
//   npm run upload-assets                      # at the repo root (this file is copied there; keep the two in step)
//   npm run upload-assets                      # the real bucket over the S3 API (keys below)
//   npm run upload-assets -- --wrangler        # the real bucket through the wrangler login — no keys, slower (one CLI call per file)
//   npm run upload-assets -- --dry-run         # list what would change, no credentials needed
//   npm run upload-assets -- --local           # workerd's local R2 through the running dev worker (PUT /__dev/assets/*)
//   npm run upload-assets -- --local --url http://127.0.0.1:8790   # another local worker (e.g. `npm run start:build`)
//
// Credentials (R2's S3 API, an API token with Object Read & Write on the bucket):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  [, R2_BUCKET=skilltanki-mobile-assets]
//
// A checkout without `git lfs pull` holds 130-byte pointer files; the script
// refuses to upload those.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..');
const root = join(server, '..', '..');
const assetsRoot = join(root, 'assets');
const BUCKET = process.env.R2_BUCKET ?? 'skilltanki-mobile-assets';
const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const WRANGLER = args.includes('--wrangler');
const DRY = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const urlArg = args.find((a) => a.startsWith('--url='));
const LIMIT = limitArg != null ? Number(limitArg.split('=')[1]) : Infinity;
const CONCURRENCY = 8;
/** CLI spawns against the real bucket: a few at a time is what the API tolerates. */
const WRANGLER_CONCURRENCY = 4;

const TYPES = {
  json: 'application/json',
  xml: 'application/xml',
  js: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  '3ds': 'application/octet-stream',
};
const typeOf = (key) => TYPES[key.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream';
const isLfsPointer = (body) => body.length < 200 && body.subarray(0, 24).toString('utf8').startsWith('version https://git-lfs');

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (name !== '.DS_Store') {
      yield full;
    }
  }
}

if (!existsSync(assetsRoot)) {
  console.error(`${assetsRoot} does not exist`);
  process.exit(1);
}
const files = [];
for (const full of walk(assetsRoot)) {
  files.push({ full, key: relative(assetsRoot, full).split(/[\\/]/).join('/') });
  if (files.length >= LIMIT) break;
}
let bytes = 0;
for (const f of files) {
  const st = statSync(f.full);
  bytes += st.size;
  if (st.size < 200 && isLfsPointer(readFileSync(f.full))) {
    console.error(`${f.key} is a git-lfs pointer — run \`git lfs pull\` first`);
    process.exit(1);
  }
}
console.log(`${files.length} files, ${(bytes / 1048576).toFixed(1)} MB under ${assetsRoot} -> bucket ${BUCKET}`);

if (LOCAL) {
  // workerd's local bucket, through the running dev worker (PUT /__dev/assets/*,
  // enabled by CC_DEV_SEED in apps/server/wrangler.jsonc): parallel HTTP, no
  // CLI spawns, no lock fights over .wrangler/state.
  const base = (urlArg?.slice('--url='.length) ?? process.env.CC_DEV_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  const health = await fetch(`${base}/health_check`).catch(() => null);
  if (health == null || !health.ok) {
    console.error(`${base} is not answering — start \`npm run dev:server\` first`);
    process.exit(1);
  }
  const queue = [...files];
  let done = 0;
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (item == null) return;
      if (DRY) {
        console.log('would put (local)', item.key);
        continue;
      }
      const response = await fetch(`${base}/__dev/assets/${item.key.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        headers: { 'content-type': typeOf(item.key) },
        body: readFileSync(item.full),
      }).catch((error) => ({ ok: false, status: 0, statusText: String(error) }));
      if (!response.ok) {
        failed += 1;
        console.error('failed', item.key, response.status, response.statusText);
        continue;
      }
      done += 1;
      if (done % 100 === 0 || done === files.length) console.log(`local put ${done}/${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done (local): ${done} stored${failed > 0 ? `, ${failed} FAILED` : ''} — the dev worker serves them at /assets/*`);
  process.exit(failed > 0 ? 1 : 0);
}

if (WRANGLER) {
  // The real bucket through the wrangler login (no S3 keys): one
  // `wrangler r2 object put --remote` per file, a few at a time. The bucket
  // cannot be listed this way, so a manifest next to the repo
  // (.r2-upload/<bucket>.json, gitignored) remembers what went up with which
  // md5 and a re-run uploads only what changed on this machine.
  const { spawn } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const manifestDir = join(root, '.r2-upload');
  const manifestPath = join(manifestDir, `${BUCKET}.json`);
  mkdirSync(manifestDir, { recursive: true });
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  const put = (item, type) =>
    new Promise((resolve) => {
      const child = spawn('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${item.key}`, '--remote', '--file', item.full, '--content-type', type], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.stdout.on('data', () => {});
      child.on('close', (code) => resolve(code === 0 ? null : err.trim().split('\n').slice(-2).join(' ')));
      child.on('error', (e) => resolve(String(e)));
    });
  const queue = [...files];
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const started = Date.now();
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (item == null) return;
      const body = readFileSync(item.full);
      const md5 = createHash('md5').update(body).digest('hex');
      if (manifest[item.key] === md5) {
        skipped += 1;
        continue;
      }
      if (DRY) {
        console.log('would put (wrangler)', item.key);
        uploaded += 1;
        continue;
      }
      const error = await put(item, typeOf(item.key));
      if (error != null) {
        failed += 1;
        console.error('failed', item.key, error);
        continue;
      }
      manifest[item.key] = md5;
      uploaded += 1;
      if (uploaded % 25 === 0) {
        save();
        console.log(`uploaded ${uploaded}/${files.length - skipped} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: WRANGLER_CONCURRENCY }, worker));
  save();
  console.log(`${DRY ? 'dry run' : 'done'} (wrangler): ${uploaded} ${DRY ? 'to upload' : 'uploaded'}, ${skipped} already current${failed > 0 ? `, ${failed} FAILED` : ''} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  process.exit(failed > 0 ? 1 : 0);
}

const { S3Client, ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!accountId || !accessKeyId || !secretAccessKey) {
  if (DRY) {
    console.log('dry run without credentials: every file would be uploaded (no bucket listing to compare against)');
    for (const f of files) console.log('would put', f.key, typeOf(f.key));
    process.exit(0);
  }
  console.error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (or use --local / --dry-run).');
  process.exit(1);
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// Existing objects: a single-part upload's ETag is the body's md5, so
// size + md5 equality is an honest "already uploaded" check.
const existing = new Map();
let token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
  for (const obj of page.Contents ?? []) {
    existing.set(obj.Key, { size: obj.Size, etag: (obj.ETag ?? '').replaceAll('"', '') });
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
console.log(`${existing.size} objects already in ${BUCKET}`);

let uploaded = 0;
let skipped = 0;
let failed = 0;
const queue = [...files];
const worker = async () => {
  for (;;) {
    const item = queue.shift();
    if (item == null) return;
    const body = readFileSync(item.full);
    const md5 = createHash('md5').update(body).digest('hex');
    const have = existing.get(item.key);
    if (have != null && have.size === body.length && have.etag === md5) {
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log('would put', item.key, `${(body.length / 1024).toFixed(0)} KB`);
      uploaded += 1;
      continue;
    }
    try {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: item.key, Body: body, ContentType: typeOf(item.key) }));
      uploaded += 1;
      if (uploaded % 50 === 0) console.log(`uploaded ${uploaded}…`);
    } catch (error) {
      failed += 1;
      console.error('failed', item.key, error?.message ?? error);
    }
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`${DRY ? 'dry run' : 'done'}: ${uploaded} ${DRY ? 'to upload' : 'uploaded'}, ${skipped} already current${failed > 0 ? `, ${failed} FAILED` : ''}`);
process.exit(failed > 0 ? 1 : 0);
