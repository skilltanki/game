// The ICE servers for RTCPeerConnection (also sent in `welcome`).
import { app } from '../config/app';
import { api } from '../lib/api';

app.get('/api/ice', async (c) => c.json({ status: 'ok', iceServers: await api.iceConfigService.servers(c.env) }));
