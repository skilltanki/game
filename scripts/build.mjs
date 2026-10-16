// Root build: assembles build/public — the PWA shell the production worker's
// Static Assets binding serves (repo-root wrangler.jsonc). A few MB.
//
//   build/
//     public/                    index.html, app/ (Vite chunks), icons/, logo.png, sw.js, …
//     worker/                    a dry-run bundle of apps/server — a compile check, not what ships
//
// The game assets are NOT part of a deploy: they live in the R2 bucket
// (`npm run upload-assets`, once, md5-skip afterwards) and the worker serves
// them at /assets/* from there, in dev and prod alike. The worker itself is
// compiled by `wrangler deploy` from apps/server/src at deploy time.
//
// Flags: --skip-build (reuse apps/mobile/dist), --no-worker (skip the dry run).
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'build');
const publicDir = join(out, 'public');
const workerDir = join(out, 'worker');
const mobile = join(root, 'apps', 'mobile');

const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build');
const withWorker = !args.has('--no-worker');

/** npm run <script> -w <workspace>, output straight through to this terminal. */
function run(script, workspace, env = {}) {
  console.log(`\n▶ ${workspace}: npm run ${script}`);
  execFileSync('npm', ['run', script, '--workspace', workspace], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

/** 1. The PWA shell. */
export function buildPackages() {
  run('build', 'skilltanki-mobile');
}

/** 2. Lay the static tree out under build/public. */
export function assembleStatic() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  const dist = join(mobile, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('apps/mobile/dist missing — run without --skip-build, or: npm run build:mobile');
  }
  if (existsSync(join(dist, 'assets'))) {
    throw new Error('apps/mobile/dist/assets exists: Vite chunks must go to app/ (build.assetsDir), /assets/ is the game data');
  }
  cpSync(dist, publicDir, { recursive: true });
}

/** 3. Compile check: a dry-run deploy with the production config (root wrangler.jsonc) bundles the worker into build/worker. */
export function bundleWorker() {
  console.log('\n▶ wrangler deploy --dry-run (root wrangler.jsonc)');
  // wrangler is a root devDependency: the binary sits in the root node_modules/.bin.
  const wrangler = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  execFileSync(wrangler, ['deploy', '--dry-run', '--outdir', workerDir], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

/** 4. Workers Static Assets refuses files over 25 MiB and more than 20 000 files — fail here, not at upload. */
export function verify() {
  let count = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        count += 1;
        bytes += st.size;
        if (st.size > 25 * 1024 * 1024) {
          throw new Error(`${full} is ${(st.size / 1048576).toFixed(1)} MiB — over the 25 MiB Static Assets limit`);
        }
      }
    }
  };
  walk(publicDir);
  if (count > 20_000) {
    throw new Error(`${count} static files — over the 20 000 Static Assets limit`);
  }
  const workerFiles = withWorker && existsSync(workerDir) ? readdirSync(workerDir).length : 0;
  console.log(
    `\n✅ build/ ready: ${count} static files, ${(bytes / 1048576).toFixed(1)} MB` +
      (withWorker ? `, worker bundle (${workerFiles} files)` : ', no worker (--no-worker)'),
  );
  console.log('   deploy with: npm run deploy');
}

if (!skipBuild) {
  buildPackages();
}
assembleStatic();
if (withWorker) {
  bundleWorker();
}
verify();
