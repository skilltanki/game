// One WebRTC link to one peer: the RTCPeerConnection, its two DataChannels
// and the "perfect negotiation" dance. Only the IMPOLITE side opens with an
// offer (the polite one answers): both sides creating the negotiated
// channels used to fire two offers at once, and Chromium left the rolled-back
// side's ICE stuck at "gathering" with no candidates often enough that a
// three-peer room failed to link. The collision handling stays for the rare
// renegotiation. The signalling messages go out through the callback the
// mesh gives it, and come back in through signal().
//
// Channels are NEGOTIATED (same id on both ends), so neither side waits for
// an `ondatachannel`: both create them and both know when they open.
import type { IceServer, SignalKind } from '../../model/online/protocol';

export type LinkState = 'connecting' | 'open' | 'closed';

export interface PeerLinkHooks {
  signal: (kind: SignalKind, payload: unknown) => void;
  message: (text: string, reliable: boolean) => void;
  state: (state: LinkState) => void;
  log: (...args: unknown[]) => void;
}

const RELIABLE_ID = 0;
const FAST_ID = 1;

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private readonly reliable: RTCDataChannel;
  private readonly fast: RTCDataChannel;
  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;
  private lastState: LinkState = 'connecting';
  /** ICE candidates that arrived before the remote description. */
  private readonly pendingIce: RTCIceCandidateInit[] = [];
  readonly createdAt = performance.now();

  constructor(
    readonly peerId: string,
    /** The polite side rolls back on an offer collision; the other wins. */
    readonly polite: boolean,
    iceServers: IceServer[],
    private readonly hooks: PeerLinkHooks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
    this.reliable = this.pc.createDataChannel('reliable', { negotiated: true, id: RELIABLE_ID, ordered: true });
    this.fast = this.pc.createDataChannel('fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    for (const channel of [this.reliable, this.fast]) {
      channel.onopen = () => this.syncState();
      channel.onclose = () => this.syncState();
      channel.onmessage = (e) => {
        if (typeof e.data === 'string') hooks.message(e.data, channel === this.reliable);
      };
    }
    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = (e) => {
      if (e.candidate != null) hooks.signal('ice', e.candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => {
      hooks.log('link', peerId, this.pc.connectionState);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.close();
      } else {
        this.syncState();
      }
    };
  }

  get state(): LinkState {
    return this.lastState;
  }

  get open(): boolean {
    return this.reliable.readyState === 'open' && this.fast.readyState === 'open';
  }

  /** Sends on the reliable or the fast channel; false when that channel is not open. */
  send(text: string, reliable: boolean): boolean {
    const channel = reliable ? this.reliable : this.fast;
    if (channel.readyState !== 'open') return false;
    try {
      channel.send(text);
      return true;
    } catch (error) {
      this.hooks.log('send failed', this.peerId, error);
      return false;
    }
  }

  /** A relayed signal from this peer (perfect negotiation, MDN's pattern). */
  async signal(kind: SignalKind, payload: unknown): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    try {
      if (kind === 'ice') {
        const candidate = payload as RTCIceCandidateInit;
        if (pc.remoteDescription == null) {
          this.pendingIce.push(candidate);
          return;
        }
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          if (!this.ignoreOffer) throw error;
        }
        return;
      }
      const description = payload as RTCSessionDescriptionInit;
      const offerCollision = kind === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) {
        this.hooks.log('offer collision, ignored (impolite)', this.peerId);
        return;
      }
      await pc.setRemoteDescription(description);
      for (const candidate of this.pendingIce.splice(0)) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // A candidate from a rolled-back offer: harmless.
        }
      }
      if (kind === 'offer') {
        await pc.setLocalDescription();
        this.hooks.signal('answer', pc.localDescription!.toJSON());
      }
    } catch (error) {
      this.hooks.log('signal failed', this.peerId, kind, error);
    }
  }

  /** Milliseconds since the link was created. */
  get ageMs(): number {
    return performance.now() - this.createdAt;
  }

  /** The ICE transport gave up or never started: try the candidates again. */
  restartIce(): void {
    if (this.closed) return;
    try {
      this.pc.restartIce();
    } catch {
      // Not supported: the mesh rebuilds the link instead.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.reliable.close();
      this.fast.close();
      this.pc.close();
    } catch {
      // Already gone.
    }
    this.setState('closed');
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    // The polite side waits for the impolite side's offer (see the header).
    if (this.polite && this.pc.remoteDescription == null) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.hooks.signal('offer', this.pc.localDescription!.toJSON());
    } catch (error) {
      this.hooks.log('offer failed', this.peerId, error);
    } finally {
      this.makingOffer = false;
    }
  }

  private syncState(): void {
    if (this.closed) return;
    this.setState(this.open ? 'open' : 'connecting');
  }

  private setState(state: LinkState): void {
    if (this.lastState === state) return;
    this.lastState = state;
    this.hooks.state(state);
  }
}
