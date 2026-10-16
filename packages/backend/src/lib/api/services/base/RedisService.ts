// The Redis connection: one client for commands, one more for pub/sub (a
// subscribed ioredis connection accepts nothing else). Lazy: the first
// request waits for `ready` (15 s, then the wait is cleared so the next
// request tries again); a ping every 30 s keeps idle connections alive.
import Redis from 'ioredis';
import { singleshot, sleep } from 'functools-kit';
import { CC_REDIS_HOST, CC_REDIS_PASSWORD, CC_REDIS_PORT, CC_REDIS_PREFIX, CC_REDIS_USER } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

const CONNECTION_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 30_000;
const TIMEOUT = Symbol('timeout');

export class RedisService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  /** The command client (created on first use). */
  public getRedis = singleshot((): Redis => {
    const redis = this.create();
    setInterval(() => void redis.ping().catch(() => {}), PING_INTERVAL_MS);
    return redis;
  });

  /** A second connection for SUBSCRIBE (RoomBusService). */
  public getSubscriber = singleshot((): Redis => this.create());

  /** Resolves once the command client is ready; throws (and forgets) after the timeout. */
  public waitForInit = singleshot(async (): Promise<Redis> => {
    const redis = this.getRedis();
    if (redis.status === 'ready') return redis;
    const ready = new Promise<Redis>((resolve, reject) => {
      redis.once('ready', () => resolve(redis));
      redis.once('error', (error) => reject(error));
    });
    const result = await Promise.race([ready, sleep(CONNECTION_TIMEOUT_MS).then(() => TIMEOUT)]);
    if (result === TIMEOUT) {
      this.waitForInit.clear();
      throw new Error('Redis connection timeout');
    }
    this.loggerService.log('redisService', 'connected', { host: CC_REDIS_HOST, port: CC_REDIS_PORT });
    return result as Redis;
  });

  /** A shutdown: both connections say goodbye (pending commands are flushed first). */
  public quit = async (): Promise<void> => {
    await Promise.allSettled([this.getRedis().quit(), this.getSubscriber().quit()]);
  };

  /** Every key of this backend under one prefix. */
  public key = (...parts: string[]): string => [CC_REDIS_PREFIX, ...parts].join(':');

  private create(): Redis {
    const redis = new Redis({
      host: CC_REDIS_HOST,
      port: CC_REDIS_PORT,
      username: CC_REDIS_PASSWORD !== '' ? CC_REDIS_USER : undefined,
      password: CC_REDIS_PASSWORD !== '' ? CC_REDIS_PASSWORD : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    redis.on('error', (error) => this.loggerService.error('redisService', 'connection error', error));
    return redis;
  }
}

export default RedisService;
