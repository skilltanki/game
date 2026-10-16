// Which backend processes are alive, in Redis: every process writes a key
// with a short TTL (`<prefix>:proc:<id>`) a few times per TTL. The socket
// table of a room names the process behind each socket; when that key is
// gone the process died with its sockets and never sent a close — the
// sweeper then lets the seats go the way a closed socket would.
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type RedisService from '../base/RedisService';

/** The key lives this long without a heartbeat; the sweeper trusts a process only while it is there. */
const PRESENCE_TTL_S = 10;
const HEARTBEAT_EVERY_MS = 3000;

export class ProcessPresenceService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly redisService = inject<RedisService>(TYPES.redisService);

  /** This process, for the socket table. */
  public readonly id = crypto.randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;

  private key(processId: string): string {
    return this.redisService.key('proc', processId);
  }

  /** The first heartbeat at once, then every HEARTBEAT_EVERY_MS. */
  public start = async (): Promise<void> => {
    if (this.timer != null) return;
    await this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_EVERY_MS);
    this.loggerService.log('processPresenceService', 'heartbeat', { id: this.id, ttlS: PRESENCE_TTL_S });
  };

  public stop = (): void => {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  };

  /** A shutdown: the key goes now, so another process's sweeper does not wait out the TTL for whatever seats are left here. */
  public drop = async (): Promise<void> => {
    this.stop();
    try {
      await this.redisService.getRedis().del(this.key(this.id));
    } catch (error) {
      this.loggerService.error('processPresenceService', 'drop failed', error);
    }
  };

  /** True while the process's heartbeat key is in Redis. */
  public alive = async (processId: string): Promise<boolean> => (await this.redisService.getRedis().exists(this.key(processId))) === 1;

  private async beat(): Promise<void> {
    try {
      await this.redisService.getRedis().set(this.key(this.id), String(process.pid), 'EX', PRESENCE_TTL_S);
    } catch (error) {
      this.loggerService.error('processPresenceService', 'heartbeat failed', error);
    }
  }
}

export default ProcessPresenceService;
