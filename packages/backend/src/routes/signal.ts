// The signalling socket of a room (Bun WebSocket through Hono's
// upgradeWebSocket, as airport-monorepo's notify.ts): the first frame must
// be `join`; after it the socket speaks for its peer until it closes. Every
// rule is RoomSessionService's; here is only the socket's life — a UUID that
// tells it apart from any other socket of the same peer (a reconnect
// replaces the old socket, possibly on another process), the handlers and
// the error answers (an ApiError goes back as an `error` message; a refused
// join also closes the socket with 4000).
import { app, upgradeWebSocket } from '../config/app';
import { api } from '../lib/api';
import { ApiError } from '../model/errors';
import type { RoomSocket } from '../model/room';

const ROOM_ID = /^[0-9a-f-]{36}$/;

app.get(
  '/ws/room/:id',
  async (c, next) => {
    if (!ROOM_ID.test(c.req.param('id'))) {
      return c.json({ status: 'error', code: 'bad_request' }, 400);
    }
    if (c.req.header('Upgrade') !== 'websocket') {
      return c.json({ status: 'error', code: 'bad_request', message: 'expected websocket' }, 426);
    }
    await next();
  },
  upgradeWebSocket((c) => {
    const roomId = c.req.param('id') ?? '';
    const socketId = crypto.randomUUID();
    let peerId: string | null = null;
    let socket: RoomSocket | null = null;
    let busy: Promise<void> = Promise.resolve();
    api.loggerService.log('signal', 'socket opened', { roomId, socketId });
    return {
      onOpen(_event, ws) {
        socket = {
          socketId,
          send: (text) => ws.send(text),
          close: (code, reason) => ws.close(code, reason),
        };
      },
      onMessage(event, ws) {
        const raw = typeof event.data === 'string' ? event.data : '';
        // Frames are handled one after another: a `signal` must not overtake the `join` before it.
        busy = busy.then(async () => {
          const msg = api.signalMessageValidationService.parse(raw);
          if (msg == null) return;
          const self = socket ?? { socketId, send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) };
          try {
            if (msg.t === 'join') {
              if (peerId != null) throw new ApiError('bad_request', 'already joined');
              peerId = await api.roomSessionService.join(roomId, msg, self);
              return;
            }
            if (peerId == null) throw new ApiError('bad_request', 'join first');
            await api.roomSessionService.message(roomId, peerId, msg, self);
          } catch (error) {
            if (ApiError.is(error)) {
              ws.send(JSON.stringify({ t: 'error', code: error.code, message: error.message }));
              if (msg.t === 'join') ws.close(4000, error.code);
              return;
            }
            api.loggerService.error('signal', 'message failed', error);
            ws.send(JSON.stringify({ t: 'error', code: 'internal' }));
          }
        });
      },
      onClose() {
        const id = peerId;
        if (id == null) return;
        busy = busy.then(() => api.roomSessionService.gone(roomId, id, socketId)).catch((error: unknown) => api.loggerService.error('signal', 'close failed', error));
      },
      onError(event) {
        api.loggerService.warn('signal', 'socket error', { roomId, socketId, peerId, event: String((event as { message?: string }).message ?? event.type) });
      },
    };
  }),
);
