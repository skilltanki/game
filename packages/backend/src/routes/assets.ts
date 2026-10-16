// /assets/* — the game data from the MinIO bucket, the same path the client
// uses against every backend. PUT /__dev/assets/* seeds the bucket in
// development (`npm run upload-assets` from the repo root with
// CC_ASSETS_TARGET pointing here); it answers only when CC_DEV_SEED is set.
import { app } from '../config/app';
import { api } from '../lib/api';

app.on(['GET', 'HEAD'], '/assets/*', (c) => api.assetRouteService.serve(c.req.raw));

app.put('/__dev/assets/*', (c) => {
  if (process.env.CC_DEV_SEED !== '1') {
    return c.json({ status: 'error', code: 'not_found' }, 404);
  }
  const key = decodeURIComponent(c.req.path.slice('/__dev/assets/'.length));
  return api.assetRouteService.store(key, c.req.raw);
});
