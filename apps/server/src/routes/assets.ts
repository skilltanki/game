// /assets/* — the game data from the R2 bucket, the same way in dev and prod.
// PUT /__dev/assets/* exists only when CC_DEV_SEED is set (apps/server/wrangler.jsonc,
// never the production config): `npm run upload-assets -- --local` seeds workerd's
// local bucket through it instead of 1334 serial `wrangler r2 object put` calls.
import { app } from '../config/app';
import { api } from '../lib/api';

app.on(['GET', 'HEAD'], '/assets/*', (c) => api.assetRouteService.serve(c.env, c.req.raw));

app.put('/__dev/assets/*', (c) => {
  if (c.env.CC_DEV_SEED !== '1') {
    return c.json({ status: 'error', code: 'not_found' }, 404);
  }
  const key = decodeURIComponent(c.req.path.slice('/__dev/assets/'.length));
  return api.assetRouteService.store(c.env, key, c.req.raw);
});
