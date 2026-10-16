// The Hono app every route module registers on (side effect of importing
// the module, see index.ts). CORS only on /api/*: a 101 Upgrade response
// carrying a WebSocket is immutable and a header-mutating middleware on
// /ws/* would throw. Errors: an ApiError becomes { status, code } with its
// HTTP status; anything else is logged and answered 500.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../env';
import { ApiError } from '../model/errors';
import { api } from '../lib/api';

export const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86400 }));

app.onError((error, c) => {
  if (ApiError.is(error)) {
    return c.json({ status: 'error', code: error.code, message: error.message }, error.status as 400);
  }
  api.loggerService.error('app', `${c.req.method} ${c.req.path}`, error);
  return c.json({ status: 'error', code: 'internal' }, 500);
});

app.notFound((c) => c.json({ status: 'error', code: 'not_found' }, 404));
