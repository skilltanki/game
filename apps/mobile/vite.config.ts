import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
// CommonJS package: Vite bundles this config as ESM, where only the default
// import resolves (a named `obfuscate` import fails at config load).
import JavaScriptObfuscator from 'javascript-obfuscator';

// Obfuscation of the production bundle, applied to each emitted chunk AFTER
// terser (the `enforce: 'post'` + renderChunk order below) — the same plugin
// and settings as the desktop client (packages/game/vite.config.ts), copied
// (CLAUDE.md rule 10). Settings are the upstream "low" preset, which its
// README is alone in marking "High performance / relatively normal level" —
// the three transforms that actually cost frames are explicitly OFF:
//   controlFlowFlattening — up to 1.5x slower by upstream's own measurement,
//     and it defeats V8's JIT on exactly the hot update/render paths;
//   deadCodeInjection     — inflates the bundle and dilutes the hot code;
//   splitStrings          — turns literals into concat chains.
// A study of obfuscated WebGL mini-games measured 60 FPS collapsing to 1 FPS
// with the aggressive presets; this game steps physics at 33 ms on a PHONE
// and cannot afford per-frame overhead, so string literals are hidden
// WITHOUT runtime decoding (stringArray on, stringArrayEncoding empty — no
// rc4/base64 pass per access). debugProtection stays off: it freezes the
// browser whenever DevTools is open, which would hang the Playwright checks.
function obfuscator(): Plugin {
  return {
    name: 'obfuscator',
    apply: 'build',
    enforce: 'post',
    renderChunk(code) {
      const result = JavaScriptObfuscator.obfuscate(code, {
        // --- "low" preset ---
        compact: true,
        simplify: true,
        stringArray: true,
        stringArrayThreshold: 0.75,
        selfDefending: true,
        // --- the FPS killers, kept off deliberately (see note above) ---
        controlFlowFlattening: false,
        deadCodeInjection: false,
        splitStrings: false,
        stringArrayEncoding: [],
        debugProtection: false,
        // Names only; keeps the output unreadable without touching semantics.
        identifierNamesGenerator: 'mangled',
        renameGlobals: false,
      });
      return { code: result.getObfuscatedCode(), map: null };
    },
  };
}

/**
 * Dev only: `POST /__bench` appends one JSON line to `.bench/events.jsonl`
 * (gitignored). The bench page posts its heartbeat and final report there
 * (src/bench/BenchMode.ts), so a run can be watched with `tail -f` and a
 * monitor instead of polling the browser.
 */
function benchLogPlugin(): Plugin {
  const dir = fileURLToPath(new URL('./.bench', import.meta.url));
  const file = `${dir}/events.jsonl`;
  return {
    name: 'skilltanki-bench-log',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(dir, { recursive: true });
      server.middlewares.use('/__bench', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          appendFileSync(file, body.replace(/\n/g, ' ') + '\n');
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

/**
 * The game takes its assets from /assets/ on its own origin (see
 * src/config/params.ts). In development everything the API worker owns —
 * /assets, /api and the signalling socket /ws — is proxied to it: run
 * `npm run dev:server` (wrangler dev on :8787) next to `npm run dev:mobile`.
 */
// CC_API_PROXY points the dev server at another backend (packages/backend on :30050).
const DEV_API = process.env.CC_API_PROXY ?? 'http://localhost:8787';

export default defineConfig({
  base: '/',
  server: {
    proxy: {
      '/assets': { target: DEV_API, changeOrigin: true },
      '/api': { target: DEV_API, changeOrigin: true },
      '/ws': { target: DEV_API.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // Vite's own chunks go to app/, not assets/: /assets/ is the game data
    // tree on the same origin in production (scripts/build.mjs).
    assetsDir: 'app',
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
    // terser over the default esbuild minifier: slower build, smaller and
    // better-mangled output (the obfuscation plugin above runs on top).
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          playcanvas: ['playcanvas'],
        },
        // Hash-only names. Rollup's default `[name]-[hash]` leaks the module
        // map through the URLs alone (playcanvas, index…), which hands back
        // structure the obfuscator just removed from the code. Nothing
        // references these names — Vite writes the tags into index.html at
        // build time and the service worker precaches by glob — so they can
        // be opaque.
        entryFileNames: 'app/[hash].js',
        chunkFileNames: 'app/[hash].js',
        assetFileNames: 'app/[hash].[ext]',
      },
    },
  },
  plugins: [
    benchLogPlugin(),
    obfuscator(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'logo.png'],
      manifest: {
        name: 'SkillTanki',
        short_name: 'SkillTanki',
        description: 'Classic 2010 tank arcade. No sign-up, no pay-to-win, skill only.',
        theme_color: '#0c0e08',
        background_color: '#0c0e08',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell only; the game assets are cached as they are loaded (runtimeCaching).
        globPatterns: ['index.html', 'manifest.webmanifest', 'app/*.{js,css}', 'icons/*.png', 'logo.png'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Game assets (/assets/ on our own origin): immutable, so
            // cache-first for a month. Matched by path: the API and the
            // signalling socket share the origin and must never be cached.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'skilltanki-remote-assets-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 4000, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
