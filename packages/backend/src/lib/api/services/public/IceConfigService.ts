// The ICE servers the peers hand to RTCPeerConnection. On one LAN the host
// candidates connect the phones by themselves; STUN gives a public
// reflexive address for the internet case; TURN relays when both sides sit
// behind symmetric NATs (most mobile carriers).
//
// Out of the box: Google's and Cloudflare's public STUN. TURN comes from the
// project's Cloudflare Realtime TURN key (config/params.ts; CC_CF_TURN_KEY_ID
// / CC_CF_TURN_API_TOKEN override it, "none" turns it off): short-lived
// credentials minted over HTTPS and cached in Redis for half their life. Any
// other relay goes through CC_ICE_TURN_URL/USERNAME/CREDENTIAL.
import { CC_CF_TURN_API_TOKEN, CC_CF_TURN_KEY_ID, CC_CF_TURN_TTL_S, readParams } from '../../../../config/params';
import type { IceServer } from '../../../../model/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type RedisService from '../base/RedisService';

/** Cloudflare Realtime TURN: credentials for a key are minted here. */
const CF_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
/** How much of the credentials' life is spent in the cache (the rest is headroom for a long battle). */
const CACHE_FRACTION = 0.5;
const CF_FETCH_TIMEOUT_MS = 5000;

export class IceConfigService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly redisService = inject<RedisService>(TYPES.redisService);

  public servers = async (): Promise<IceServer[]> => {
    const { stunUrls, turn } = readParams();
    const servers: IceServer[] = [];
    if (stunUrls.length > 0) servers.push({ urls: stunUrls });
    if (turn != null) {
      servers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
    } else {
      const cloudflare = await this.cloudflareTurn();
      if (cloudflare != null) servers.push(...cloudflare);
    }
    return servers;
  };

  /** Short-lived Cloudflare TURN credentials, from Redis while they are fresh, else minted; null when the key is off or Cloudflare refused. */
  private async cloudflareTurn(): Promise<IceServer[] | null> {
    const keyId = CC_CF_TURN_KEY_ID;
    const token = CC_CF_TURN_API_TOKEN;
    if (keyId === 'none' || token === 'none') return null;
    const cacheKey = this.redisService.key('ice', 'cloudflare');
    const redis = this.redisService.getRedis();
    try {
      const cached = await redis.get(cacheKey);
      if (cached != null) {
        const servers = JSON.parse(cached) as IceServer[];
        if (servers.length > 0) return servers;
      }
    } catch (error) {
      this.loggerService.error('iceConfigService', 'Redis read failed', error);
    }
    const ttl = CC_CF_TURN_TTL_S;
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
        await redis.set(cacheKey, JSON.stringify(usable), 'EX', Math.max(60, Math.floor(ttl * CACHE_FRACTION)));
      } catch (error) {
        this.loggerService.error('iceConfigService', 'Redis write failed', error);
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
