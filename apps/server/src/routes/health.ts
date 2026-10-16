import { app } from '../config/app';

app.get('/health_check', (c) => c.json({ status: 'ok', service: 'skilltanki-api', now: Date.now() }));
