// The live rooms in Redis: one JSON document per room (`<prefix>:room:<id>`),
// read and written under the room's lock so two processes never interleave
// a join and a leave; next to it the socket table (`:sockets`, peerId → the
// socketId that currently carries the seat and the process holding it, so a
// close that arrives after a replacement is told apart and the sweeper can
// see a seat whose process died) and the lock key. A document expires on its own
// twice the listing-stale time after its last write — a room that nobody
// touches cannot outlive its lobby entry.
import { ApiError } from '../../../../model/errors';
import { fromJson, toJson, type RoomState, type RoomStateJson } from '../../../../model/room';
import { readParams } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type RedisService from '../base/RedisService';
import type IdService from '../base/IdService';

/** A lock is held this long at most (a crashed holder frees the room by then). */
const LOCK_TTL_MS = 5000;
/** A waiter tries this often for this long before giving up. */
const LOCK_RETRY_MS = 20;
const LOCK_WAIT_MS = 5000;

const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const HDEL_IF_SCRIPT = 'if redis.call("hget", KEYS[1], ARGV[1]) == ARGV[2] then return redis.call("hdel", KEYS[1], ARGV[1]) else return 0 end';

/** The socket table's value: `<socketId>@<processId>`. */
export interface SocketRecord {
  socketId: string;
  processId: string;
}

function packRecord(record: SocketRecord): string {
  return `${record.socketId}@${record.processId}`;
}

function unpackRecord(raw: string | null): SocketRecord | null {
  if (raw == null) return null;
  const at = raw.indexOf('@');
  return at < 0 ? { socketId: raw, processId: '' } : { socketId: raw.slice(0, at), processId: raw.slice(at + 1) };
}

export class RoomStoreService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly redisService = inject<RedisService>(TYPES.redisService);
  private readonly idService = inject<IdService>(TYPES.idService);

  private key(id: string): string {
    return this.redisService.key('room', id);
  }

  public load = async (id: string): Promise<RoomState | null> => {
    const raw = await this.redisService.getRedis().get(this.key(id));
    if (raw == null) return null;
    return fromJson(JSON.parse(raw) as RoomStateJson);
  };

  /** The room must exist (the socket's room, a listing from the host). */
  public require = async (id: string): Promise<RoomState> => {
    const state = await this.load(id);
    if (state == null) throw new ApiError('room_not_found');
    return state;
  };

  public save = async (state: RoomState): Promise<void> => {
    const id = state.config?.id;
    if (id == null) throw new Error('room has no config');
    const ttlSeconds = Math.ceil((readParams().listingStaleMs * 2) / 1000);
    await this.redisService.getRedis().set(this.key(id), JSON.stringify(toJson(state)), 'EX', ttlSeconds);
  };

  public delete = async (id: string): Promise<void> => {
    await this.redisService.getRedis().del(this.key(id), `${this.key(id)}:sockets`);
  };

  /** Runs `fn` with the room's lock held; a room busy for LOCK_WAIT_MS is an error (the caller answers 500). */
  public withLock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const redis = this.redisService.getRedis();
    const lockKey = `${this.key(id)}:lock`;
    const token = this.idService.token();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const got = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
      if (got === 'OK') break;
      if (Date.now() > deadline) throw new Error(`room ${id} is locked`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    try {
      return await fn();
    } finally {
      try {
        await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      } catch (error) {
        this.loggerService.error('roomStoreService', 'lock release failed', error);
      }
    }
  };

  // --- the socket table ---------------------------------------------------------

  /** The socket (and the process) that carries `peerId`'s seat now (a join replaces the previous one). */
  public setSocket = async (id: string, peerId: string, record: SocketRecord): Promise<void> => {
    await this.redisService.getRedis().hset(`${this.key(id)}:sockets`, peerId, packRecord(record));
  };

  public socketOf = async (id: string, peerId: string): Promise<string | null> => {
    return unpackRecord(await this.redisService.getRedis().hget(`${this.key(id)}:sockets`, peerId))?.socketId ?? null;
  };

  /** Every seat's socket and process (the sweeper's view). */
  public sockets = async (id: string): Promise<Map<string, SocketRecord>> => {
    const raw = await this.redisService.getRedis().hgetall(`${this.key(id)}:sockets`);
    return new Map(Object.entries(raw).map(([peerId, value]) => [peerId, unpackRecord(value)!]));
  };

  /** Forgets the socket — only while it is still the one on record (a replaced socket's close must not clear its successor). */
  public clearSocket = async (id: string, peerId: string, socketId: string): Promise<boolean> => {
    const sockets = `${this.key(id)}:sockets`;
    const current = unpackRecord(await this.redisService.getRedis().hget(sockets, peerId));
    if (current == null || current.socketId !== socketId) return false;
    const result = await this.redisService.getRedis().eval(HDEL_IF_SCRIPT, 1, sockets, peerId, packRecord(current));
    return result === 1;
  };
}

export default RoomStoreService;
