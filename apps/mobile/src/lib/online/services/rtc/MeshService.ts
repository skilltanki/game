// The full mesh: one PeerLink per other peer, the signalling relay behind
// them, and a single send/broadcast/onMessage surface for everything above.
// Who is polite in a negotiation is decided by the peer ids (the lower id
// yields), so both ends agree without talking.
import { PeerLink, type LinkState } from '../../../../classes/online/PeerLink';
import type { IceServer, SignalKind } from '../../../../model/online/protocol';
import type { PeerWire } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

export type MeshMessageListener = (from: string, message: PeerWire) => void;
export type MeshLinkListener = (peerId: string, state: LinkState) => void;

/** A link that has not opened this long after it was made is rebuilt by its impolite side. */
const LINK_TIMEOUT_MS = 8000;
/** The polite side rebuilds on its own after this long without an offer that worked. */
const POLITE_LINK_TIMEOUT_MS = 20000;
/** The watchdog's period. */
const WATCH_EVERY_MS = 2000;

export class MeshService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private localId: string | null = null;
  private iceServers: IceServer[] = [];
  private relay: ((to: string, kind: SignalKind, payload: unknown) => void) | null = null;
  private readonly links = new Map<string, PeerLink>();
  /** performance.now() when each link last became open (gone when it closes). */
  private readonly openedAt = new Map<string, number>();
  private readonly messageListeners = new Set<MeshMessageListener>();
  private readonly linkListeners = new Set<MeshLinkListener>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Links rebuilt by the watchdog, for the report. */
  public rebuilt = 0;
  /** Counters for the owner's report (messages and bytes, by channel). */
  public readonly stats = { sent: 0, received: 0, bytesOut: 0, bytesIn: 0 };

  /** Arms the mesh for a room; `relay` sends a signal to a peer through the server. */
  public start = (localId: string, iceServers: IceServer[], relay: (to: string, kind: SignalKind, payload: unknown) => void): void => {
    this.stop();
    this.localId = localId;
    this.iceServers = iceServers;
    this.relay = relay;
    this.stats.sent = this.stats.received = this.stats.bytesOut = this.stats.bytesIn = 0;
    this.rebuilt = 0;
    this.watchdog = setInterval(this.watch, WATCH_EVERY_MS);
  };

  /** A link stuck short of open (ICE never started, or failed) is rebuilt; the impolite side first, the polite one later. */
  private watch = (): void => {
    for (const [peerId, link] of this.links) {
      if (link.open || link.state === 'closed') continue;
      const timeout = link.polite ? POLITE_LINK_TIMEOUT_MS : LINK_TIMEOUT_MS;
      if (link.ageMs < timeout) continue;
      this.rebuilt++;
      this.loggerService.warn('link stuck, rebuilding', peerId, link.pc.iceConnectionState, link.pc.iceGatheringState, Math.round(link.ageMs), 'ms');
      this.connect(peerId);
    }
  };

  /** Opens (or re-opens) the link to a peer. Both sides call this; negotiation sorts itself out. */
  public connect = (peerId: string): void => {
    if (this.localId == null || this.relay == null || peerId === this.localId) return;
    this.links.get(peerId)?.close();
    const polite = this.localId < peerId;
    const link = new PeerLink(peerId, polite, this.iceServers, {
      signal: (kind, payload) => this.relay?.(peerId, kind, payload),
      message: (text) => this.onText(peerId, text),
      state: (state) => {
        if (state === 'open') this.openedAt.set(peerId, performance.now());
        else this.openedAt.delete(peerId);
        for (const listener of [...this.linkListeners]) listener(peerId, state);
      },
      log: (...args) => this.loggerService.log(...args),
    });
    this.links.set(peerId, link);
    this.loggerService.log('link opened', peerId, polite ? 'polite' : 'impolite');
  };

  public disconnect = (peerId: string): void => {
    const link = this.links.get(peerId);
    if (link != null) {
      this.links.delete(peerId);
      this.openedAt.delete(peerId);
      link.close();
    }
  };

  /** How long the link to `peerId` has been open (ms); 0 when it is not. */
  public openForMs = (peerId: string): number => {
    const since = this.openedAt.get(peerId);
    return since != null && this.isOpen(peerId) ? performance.now() - since : 0;
  };

  /** A signal relayed by the server from `from`. */
  public handleSignal = (from: string, kind: SignalKind, payload: unknown): void => {
    let link = this.links.get(from);
    if (link == null) {
      // An offer from a peer we have not linked yet (its peerJoined may be in flight).
      this.connect(from);
      link = this.links.get(from);
    } else if (kind === 'offer' && !link.open && link.state === 'closed') {
      this.connect(from);
      link = this.links.get(from);
    } else if (kind === 'offer' && !link.open && link.pc.remoteDescription != null && link.ageMs > LINK_TIMEOUT_MS / 2) {
      // The other side gave up on the old link and starts over: so do we.
      this.loggerService.warn('fresh offer on a stuck link, rebuilding', from);
      this.connect(from);
      link = this.links.get(from);
    }
    void link?.signal(kind, payload);
  };

  public peers = (): string[] => [...this.links.keys()];

  public isOpen = (peerId: string): boolean => this.links.get(peerId)?.open ?? false;

  public send = (peerId: string, message: PeerWire, reliable = true): boolean => {
    const link = this.links.get(peerId);
    if (link == null) return false;
    const text = JSON.stringify(message);
    const ok = link.send(text, reliable);
    if (ok) {
      this.stats.sent++;
      this.stats.bytesOut += text.length;
    }
    return ok;
  };

  public broadcast = (message: PeerWire, reliable = true): number => {
    const text = JSON.stringify(message);
    let delivered = 0;
    for (const link of this.links.values()) {
      if (link.send(text, reliable)) {
        delivered++;
        this.stats.sent++;
        this.stats.bytesOut += text.length;
      }
    }
    return delivered;
  };

  public onMessage = (listener: MeshMessageListener): (() => void) => {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  };

  public onLink = (listener: MeshLinkListener): (() => void) => {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  };

  public stop = (): void => {
    if (this.watchdog != null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.openedAt.clear();
    this.localId = null;
    this.relay = null;
  };

  private onText(from: string, text: string): void {
    let message: PeerWire;
    try {
      message = JSON.parse(text) as PeerWire;
    } catch {
      return;
    }
    if (message == null || typeof message !== 'object' || typeof message.t !== 'string') return;
    this.stats.received++;
    this.stats.bytesIn += text.length;
    for (const listener of [...this.messageListeners]) {
      try {
        listener(from, message);
      } catch (error) {
        this.loggerService.error('mesh listener failed', error);
      }
    }
  }
}

export default MeshService;
