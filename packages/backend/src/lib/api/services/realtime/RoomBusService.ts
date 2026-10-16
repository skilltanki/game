// The bus between the processes: Redis pub/sub on one channel. A room event
// (a message for a peer or for the room) or a close order goes out as JSON;
// every process — this one included — receives it and hands it to the
// sockets it holds (SocketRegistryService). Replaces airport-monorepo's
// IPC broadcast: it works the same with one process, a bootstrap of
// several, or several machines on one Redis.
import { singleshot } from 'functools-kit';
import type { ServerMessage } from '../../../../model/protocol';
import type { RoomBusMessage } from '../../../../contract/RoomEvent.contract';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type RedisService from '../base/RedisService';
import type SocketRegistryService from './SocketRegistryService';

export class RoomBusService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly redisService = inject<RedisService>(TYPES.redisService);
  private readonly socketRegistryService = inject<SocketRegistryService>(TYPES.socketRegistryService);

  private get channel(): string {
    return this.redisService.key('bus');
  }

  /** Subscribes this process; called once when the server starts. */
  public start = singleshot(async (): Promise<void> => {
    const subscriber = this.redisService.getSubscriber();
    subscriber.on('message', (_channel: string, raw: string) => {
      let message: RoomBusMessage;
      try {
        message = JSON.parse(raw) as RoomBusMessage;
      } catch {
        return;
      }
      this.deliver(message);
    });
    await subscriber.subscribe(this.channel);
    this.loggerService.log('roomBusService', 'subscribed', { channel: this.channel });
  });

  public send = (roomId: string, to: string, message: ServerMessage): void => {
    this.publish({ topic: 'room-event', data: { roomId, to, except: null, message } });
  };

  public broadcast = (roomId: string, except: string | null, message: ServerMessage): void => {
    this.publish({ topic: 'room-event', data: { roomId, to: null, except, message } });
  };

  /** Every socket of the peer but the one that just took the seat closes, wherever it is held. */
  public closePeer = (roomId: string, peerId: string, exceptSocketId: string | null, code: number, reason: string): void => {
    this.publish({ topic: 'room-close', data: { roomId, peerId, exceptSocketId, code, reason } });
  };

  private publish(message: RoomBusMessage): void {
    this.redisService
      .getRedis()
      .publish(this.channel, JSON.stringify(message))
      .catch((error: unknown) => this.loggerService.error('roomBusService', 'publish failed', error));
  }

  private deliver(message: RoomBusMessage): void {
    if (message.topic === 'room-event') {
      const { roomId, to, except, message: payload } = message.data;
      const text = JSON.stringify(payload);
      if (to != null) this.socketRegistryService.send(roomId, to, text);
      else this.socketRegistryService.broadcast(roomId, except, text);
    } else if (message.topic === 'room-close') {
      const { roomId, peerId, exceptSocketId, code, reason } = message.data;
      this.socketRegistryService.closePeer(roomId, peerId, exceptSocketId, code, reason);
    }
  }
}

export default RoomBusService;
