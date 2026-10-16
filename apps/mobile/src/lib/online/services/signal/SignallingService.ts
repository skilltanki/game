// The signalling socket to the room's Durable Object (apps/server): join,
// the peer roster events, the offer/answer/ice relay, host changes, leave.
// Holds ONE socket at a time. A drop that was not our own `leave` is
// retried with the rejoin token (exponential backoff, a few attempts); the
// session above decides what a reconnect means for the mesh.
import type { ClientMessage, JoinMessage, ServerMessage, WelcomeMessage } from '../../../../model/online/protocol';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

/** How long a join may wait for its welcome. */
const JOIN_TIMEOUT_MS = 10000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_ATTEMPTS = 5;
/** Application-level keepalive (the DO answers 'ping' with 'pong' without waking). */
const PING_INTERVAL_MS = 25000;

export type SignalListener = (message: ServerMessage) => void;

export interface SignalCloseInfo {
  code: number;
  reason: string;
  /** True when the service will try to come back with the token. */
  reconnecting: boolean;
}

export class SignallingService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private socket: WebSocket | null = null;
  private roomId: string | null = null;
  private join: Omit<JoinMessage, 't'> | null = null;
  private token: string | null = null;
  private listeners = new Set<SignalListener>();
  private closeListeners = new Set<(info: SignalCloseInfo) => void>();
  private reconnectListeners = new Set<(welcome: WelcomeMessage) => void>();
  private leaving = false;
  private attempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Opens the socket and joins; resolves with the welcome, rejects with the server's error code. */
  public connect = async (roomId: string, join: Omit<JoinMessage, 't'>): Promise<WelcomeMessage> => {
    this.close();
    this.roomId = roomId;
    this.join = join;
    this.token = join.token ?? null;
    this.leaving = false;
    this.attempts = 0;
    const welcome = await this.open();
    this.token = welcome.token;
    return welcome;
  };

  public send = (message: ClientMessage): boolean => {
    const socket = this.socket;
    if (socket == null || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  };

  public onMessage = (listener: SignalListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public onClose = (listener: (info: SignalCloseInfo) => void): (() => void) => {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  };

  /** The socket came back with the token: a fresh welcome (peers may have changed). */
  public onReconnected = (listener: (welcome: WelcomeMessage) => void): (() => void) => {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  };

  /** Says goodbye (the seat is freed on the server) and closes; no reconnect. True when the goodbye went out (a dead socket keeps the seat). */
  public leave = (): boolean => {
    this.leaving = true;
    const sent = this.send({ t: 'leave' });
    this.close();
    return sent;
  };

  /** Drops the socket without a leave (the seat stays for the rejoin TTL). */
  public close = (): void => {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket != null) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close(1000, 'bye');
      } catch {
        // Already closed.
      }
    }
  };

  // --- internals ------------------------------------------------------------------

  private open(): Promise<WelcomeMessage> {
    return new Promise<WelcomeMessage>((resolve, reject) => {
      const roomId = this.roomId!;
      const url = new URL(`/ws/room/${roomId}`, location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url.href);
      this.socket = socket;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('join timed out'));
          this.close();
        }
      }, JOIN_TIMEOUT_MS);
      socket.onopen = () => {
        const join: JoinMessage = { t: 'join', ...this.join!, token: this.token ?? undefined };
        socket.send(JSON.stringify(join));
      };
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (!settled) {
          if (message.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            this.attempts = 0;
            this.startPing();
            resolve(message);
            return;
          }
          if (message.t === 'error') {
            settled = true;
            clearTimeout(timer);
            reject(new Error(message.code));
            return;
          }
        }
        for (const listener of [...this.listeners]) {
          try {
            listener(message);
          } catch (error) {
            this.loggerService.error('signal listener failed', error);
          }
        }
      };
      socket.onerror = () => {
        // The close that follows carries the code; nothing to do here.
      };
      socket.onclose = (event) => {
        // A socket this service already replaced (a reconnect in flight) has nothing to say.
        if (this.socket !== socket) return;
        this.stopPing();
        this.socket = null;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(event.reason || `socket closed (${event.code})`));
          return;
        }
        this.onDropped(event.code, event.reason);
      };
    });
  }

  /** The server closed on us: come back with the token unless we left or were replaced. */
  private onDropped(code: number, reason: string): void {
    const fatal = this.leaving || code === 1000 || code === 4000 || code === 4001 || this.token == null;
    const reconnecting = !fatal && this.attempts < RECONNECT_ATTEMPTS;
    this.loggerService.warn('signalling dropped', code, reason, reconnecting ? 'reconnecting' : 'giving up');
    for (const listener of [...this.closeListeners]) listener({ code, reason, reconnecting });
    if (!reconnecting) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open()
        .then((welcome) => {
          this.token = welcome.token;
          for (const listener of [...this.reconnectListeners]) listener(welcome);
        })
        .catch((error: unknown) => {
          this.loggerService.warn('rejoin failed', error);
          // A refused token (the seat was pruned) is final; a timeout retries.
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'bad_token' || message === 'finished' || message === 'room_not_found') {
            for (const listener of [...this.closeListeners]) listener({ code: 4002, reason: message, reconnecting: false });
            return;
          }
          this.onDropped(1006, message);
        });
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const socket = this.socket;
      if (socket != null && socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export default SignallingService;
