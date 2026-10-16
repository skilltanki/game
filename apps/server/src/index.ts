// The worker's entry: the Hono app (routes register themselves on import)
// and the Durable Object classes wrangler binds as ROOM and LOBBY_INDEX.
import { app } from './config/app';
import './routes/health';
import './routes/rooms';
import './routes/ice';
import './routes/signal';
import './routes/assets';
import type { Env } from './env';

export { RoomObject } from './durable/RoomObject';
export { LobbyObject } from './durable/LobbyObject';

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
