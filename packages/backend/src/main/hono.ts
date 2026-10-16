// The HTTP + WebSocket server of one process: the Hono app with every route
// registered (the imports), served by Bun with the WebSocket handler from
// config/app.ts. The stores connect lazily on the first request; the bus
// subscribes right away so a message for a socket here is never missed; the
// sweeper runs in the `--firstPort` process only.
import { serveStatic } from 'hono/bun';
import { app, websocket } from '../config/app';
import { CC_WWWROOT_PATH, CC_WWWROOT_PORT } from '../config/params';
import { api } from '../lib/api';
import '../routes/health';
import '../routes/rooms';
import '../routes/ice';
import '../routes/signal';
import '../routes/assets';

const main = async (): Promise<void> => {
  if (api.bootstrapService.isSupervisor) return;
  const port = api.bootstrapService.port ?? CC_WWWROOT_PORT;
  if (CC_WWWROOT_PATH !== '') {
    // The PWA shell after every API route: /, /index.html, /app/*.js, the icons…
    app.use('/*', serveStatic({ root: CC_WWWROOT_PATH }));
  }
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: '0.0.0.0',
    port,
    websocket,
    idleTimeout: 120,
    development: false,
  });
  console.log(`[backend] listening on http://localhost:${server.port}${api.bootstrapService.isFirst ? ' (sweeper here)' : ''}`);
  api.shutdownService.setServer(server);
  api.shutdownService.listen();
  try {
    await Promise.all([api.redisService.waitForInit(), api.mongooseService.waitForInit(), api.minioService.waitForInit()]);
    await api.roomBusService.start();
    await api.processPresenceService.start();
    if (api.bootstrapService.isFirst) api.roomSweepService.start();
  } catch (error) {
    // The stores come up later: the first request retries the connections (config/app.ts).
    api.loggerService.error('main', 'stores not ready yet; retrying on the first request', error);
    const retry = setInterval(() => {
      void Promise.all([api.redisService.waitForInit(), api.mongooseService.waitForInit(), api.minioService.waitForInit()])
        .then(async () => {
          clearInterval(retry);
          await api.roomBusService.start();
          await api.processPresenceService.start();
          if (api.bootstrapService.isFirst) api.roomSweepService.start();
        })
        .catch(() => {});
    }, 5000);
  }
};

void main();
