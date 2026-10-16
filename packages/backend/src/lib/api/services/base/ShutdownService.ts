// An orderly stop on SIGTERM / SIGINT (a deploy, pm2 restart, Ctrl-C): the
// sockets held here close with 1001 "server restart" — their close handlers
// run the normal departure (the seat stays for the rejoin TTL, `peerLeft`
// goes out) and the clients come back with their tokens to another process
// or to the respawned one — then the presence key goes at once (no 10 s TTL
// for the sweeper to wait on), the sweeper stops, the server stops accepting,
// the stores disconnect, and the process exits. The supervisor's SIGTERM
// stops its children instead and does not respawn them.
import mongoose from 'mongoose';
import { singleshot } from 'functools-kit';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';
import type BootstrapService from './BootstrapService';
import type RedisService from './RedisService';
import type ProcessPresenceService from '../realtime/ProcessPresenceService';
import type SocketRegistryService from '../realtime/SocketRegistryService';
import type RoomSessionService from '../realtime/RoomSessionService';
import type RoomSweepService from '../realtime/RoomSweepService';

/** The departures of the closed sockets get this long to reach Redis before the process goes. */
const DRAIN_MS = 2000;
/** Bun's server.stop(true) may not return while a socket is still being torn down: it gets this long. */
const SERVER_STOP_MS = 1000;
/** Whatever hangs, the process is gone by then. */
const HARD_EXIT_MS = 8000;

export interface StoppableServer {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}

export class ShutdownService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly bootstrapService = inject<BootstrapService>(TYPES.bootstrapService);
  private readonly redisService = inject<RedisService>(TYPES.redisService);
  private readonly processPresenceService = inject<ProcessPresenceService>(TYPES.processPresenceService);
  private readonly socketRegistryService = inject<SocketRegistryService>(TYPES.socketRegistryService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);
  private readonly roomSweepService = inject<RoomSweepService>(TYPES.roomSweepService);

  private server: StoppableServer | null = null;

  /** The server to stop (set by main/hono.ts once Bun.serve returned). */
  public setServer = (server: StoppableServer | null): void => {
    this.server = server;
  };

  /** Installs the signal handlers; idempotent. */
  public listen = singleshot((): void => {
    const onSignal = (signal: string): void => void this.shutdown(signal);
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
  });

  public shutdown = singleshot(async (signal: string): Promise<void> => {
    const hard = setTimeout(() => {
      console.error('[backend] shutdown: hard exit');
      process.exit(1);
    }, HARD_EXIT_MS);
    try {
      if (this.bootstrapService.isSupervisor) {
        this.loggerService.log('shutdownService', `${signal}: stopping the children`);
        this.bootstrapService.stopChildren();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
      const entries = this.socketRegistryService.entries();
      this.loggerService.log('shutdownService', `${signal}: closing ${entries.length} socket(s)`);
      this.roomSweepService.stop();
      // The departures are recorded HERE, not left to the close handlers (Bun may deliver those late): every peer is
      // announced as left at once, then its socket closes 1001 and the client comes back with its token.
      const departures = entries.map(async ({ roomId, peerId, socket }) => {
        try {
          await this.roomSessionService.gone(roomId, peerId, socket.socketId);
        } finally {
          try {
            socket.close(1001, 'server restart');
          } catch {
            // already gone
          }
        }
      });
      await Promise.race([Promise.allSettled(departures), new Promise((resolve) => setTimeout(resolve, DRAIN_MS))]);
      this.loggerService.log('shutdownService', `departures recorded; ${this.socketRegistryService.total()} socket(s) left`);
      await this.processPresenceService.drop();
      this.loggerService.log('shutdownService', 'presence dropped');
      try {
        await Promise.race([Promise.resolve(this.server?.stop(true)), new Promise((resolve) => setTimeout(resolve, SERVER_STOP_MS))]);
      } catch {
        // already stopped
      }
      this.loggerService.log('shutdownService', 'server stopped');
      await Promise.allSettled([this.redisService.quit(), mongoose.connection.readyState === 1 ? mongoose.disconnect() : Promise.resolve()]);
      this.loggerService.log('shutdownService', 'stopped');
    } finally {
      clearTimeout(hard);
      process.exit(0);
    }
  });
}

export default ShutdownService;
