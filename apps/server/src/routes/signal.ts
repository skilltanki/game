// The signalling socket of a room: the Upgrade request is handed to the
// room's Durable Object untouched (no middleware runs on /ws/*).
import { app } from '../config/app';

const ROOM_ID = /^[0-9a-f-]{36}$/;

app.get('/ws/room/:id', (c) => {
  const id = c.req.param('id');
  if (!ROOM_ID.test(id)) {
    return c.json({ status: 'error', code: 'bad_request' }, 400);
  }
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ status: 'error', code: 'bad_request', message: 'expected websocket' }, 426);
  }
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(id));
  return stub.fetch(new Request('https://room/ws', c.req.raw));
});
