// The ICE servers the peers hand to RTCPeerConnection. On one LAN the host
// candidates connect the phones by themselves; STUN gives a public
// reflexive address for the internet case; TURN relays when both sides sit
// behind symmetric NATs (most mobile carriers).
//
// Out of the box: Google's and Cloudflare's public STUN. TURN needs
// credentials and no public relay survives without an account (the Open
// Relay Project resolves to 192.0.2.1 today), so the relay comes from the
// SAME Cloudflare account the worker runs in: a Realtime TURN key
// (dashboard: Realtime → TURN) — the project's own key is baked into
// config/params.ts, `CC_CF_TURN_KEY_ID` / `CC_CF_TURN_API_TOKEN` override it
// — and this service asks Cloudflare for short-lived credentials, cached in
// KV for most of their life. Any other relay goes through
// CC_ICE_TURN_URL/USERNAME/CREDENTIAL.
import type { Env } from '../../../../env';
import { CC_DEFAULT_CF_TURN_API_TOKEN, CC_DEFAULT_CF_TURN_KEY_ID, readParams } from '../../../../config/params';
import type { IceServer } from '../../../../model/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

/** Cloudflare Realtime TURN: credentials for a key are minted here. */
const CF_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
/** KV key for the cached credentials (the CACHE namespace). */
const CACHE_KEY = 'ice:cloudflare';
/** How much of the credentials' life is spent in the cache (the rest is headroom for a long battle). */
const CACHE_FRACTION = 0.5;
const CF_FETCH_TIMEOUT_MS = 5000;

export class IceConfigService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  public servers = async (env: Env): Promise<IceServer[]> => {
    const { stunUrls, turn } = readParams(env);
    const servers: IceServer[] = [];
    if (stunUrls.length > 0) servers.push({ urls: stunUrls });
    if (turn != null) {
      servers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
    } else {
      const cloudflare = await this.cloudflareTurn(env);
      if (cloudflare != null) servers.push(...cloudflare);
    }
    return servers;
  };

  /** Short-lived Cloudflare TURN credentials, from KV while they are fresh, else minted; null when the key is not configured or Cloudflare refused. */
  private async cloudflareTurn(env: Env): Promise<IceServer[] | null> {
    const keyId = env.CC_CF_TURN_KEY_ID?.trim() || CC_DEFAULT_CF_TURN_KEY_ID;
    const token = env.CC_CF_TURN_API_TOKEN?.trim() || CC_DEFAULT_CF_TURN_API_TOKEN;
    if (keyId === 'none' || token === 'none') return null;
    try {
      const cached = await env.CACHE.get<IceServer[]>(CACHE_KEY, 'json');
      if (cached != null && cached.length > 0) return cached;
    } catch (error) {
      this.loggerService.error('iceConfigService', 'KV read failed', error);
    }
    const ttl = Math.max(600, Number(env.CC_CF_TURN_TTL_S) || 86400);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${CF_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.loggerService.warn('iceConfigService', 'Cloudflare TURN refused', { status: response.status, body: (await response.text()).slice(0, 200) });
        return null;
      }
      const body = (await response.json()) as { iceServers?: IceServer | IceServer[] };
      const servers = body.iceServers == null ? [] : Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
      const usable = servers.filter((s) => s.urls != null && s.username != null && s.credential != null);
      if (usable.length === 0) {
        this.loggerService.warn('iceConfigService', 'Cloudflare TURN answered without credentials');
        return null;
      }
      try {
        await env.CACHE.put(CACHE_KEY, JSON.stringify(usable), { expirationTtl: Math.max(60, Math.floor(ttl * CACHE_FRACTION)) });
      } catch (error) {
        this.loggerService.error('iceConfigService', 'KV write failed', error);
      }
      this.loggerService.log('iceConfigService', 'Cloudflare TURN credentials minted', { ttl });
      return usable;
    } catch (error) {
      this.loggerService.error('iceConfigService', 'Cloudflare TURN unreachable', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default IceConfigService;
