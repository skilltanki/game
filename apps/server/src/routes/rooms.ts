// Lobby REST: list, create, get, republish (the room writes its listing to
// the lobby index again — migrate/ uses it). The Durable Objects do the rest.
import { app } from '../config/app';
import { api } from '../lib/api';

app.get('/api/rooms', async (c) => {
  const rooms = await api.roomApiService.list(c.env, c.req.query('mode') ?? null);
  return c.json({ status: 'ok', rooms });
});

app.post('/api/rooms', async (c) => {
  const body = await c.req.json().catch(() => null);
  const { id } = await api.roomApiService.create(c.env, body);
  return c.json({ status: 'ok', id }, 201);
});

app.get('/api/rooms/:id', async (c) => {
  const room = await api.roomApiService.get(c.env, c.req.param('id'));
  return c.json({ status: 'ok', room });
});

app.post('/api/rooms/:id/republish', async (c) => {
  const room = await api.roomApiService.republish(c.env, c.req.param('id'));
  return c.json({ status: 'ok', room });
});
