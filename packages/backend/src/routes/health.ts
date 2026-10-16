import { app } from '../config/app';
import { api } from '../lib/api';

app.get('/health_check', (c) =>
  c.json({ status: 'ok', service: 'skilltanki-backend', now: Date.now(), port: api.bootstrapService.port, pid: process.pid, uptime: Math.round(process.uptime()) }),
);
