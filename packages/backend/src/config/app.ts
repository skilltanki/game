// The Hono app every route module registers on (side effect of importing
// the module, see main/hono.ts) and the Bun WebSocket helpers
// (createBunWebSocket: `upgradeWebSocket` for the routes, `websocket` for
// Bun.serve). CORS only on /api/*. Every request first waits for the
// stores (Redis, MongoDB, MinIO) to be ready — once per process. Errors: an
// ApiError becomes { status, code } with its HTTP status; anything else is
// logged and answered 500.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import { singleshot } from 'functools-kit';
import { ApiError } from '../model/errors';
import { api } from '../lib/api';

export const app = new Hono();

const waitForInit = singleshot(async () => {
  try {
    await Promise.all([api.redisService.waitForInit(), api.mongooseService.waitForInit(), api.minioService.waitForInit()]);
  } catch (error) {
    waitForInit.clear();
    throw error;
  }
});

app.use(async (_, next) => {
  await waitForInit();
  await next();
});

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86400 }));

app.onError((error, c) => {
  if (ApiError.is(error)) {
    return c.json({ status: 'error', code: error.code, message: error.message }, error.status as 400);
  }
  api.loggerService.error('app', `${c.req.method} ${c.req.path}`, error);
  return c.json({ status: 'error', code: 'internal' }, 500);
});

app.notFound((c) => c.json({ status: 'error', code: 'not_found' }, 404));

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

export { upgradeWebSocket, websocket };
