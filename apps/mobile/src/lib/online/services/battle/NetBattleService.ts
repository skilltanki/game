// The netcode of one running battle, behind the BattleBridge: routes the
// mesh traffic to the stream (StateSyncService), the host's rules
// (AuthorityService) or the replica's (ReplicaService), follows host
// migrations, seats late joiners and clears the seats of peers that left.
// lib/tanki calls start/beforeStep/afterStep/stop around its battle loop and
// asks createSource() for each remote actor's ControlSource.
import type { BattleBridge } from '../../../../model/online/BattleBridge';
import type { ControlSource } from '../../../../model/ControlSource';
import type { OnlineSeat, PeerWire } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type MeshService from '../rtc/MeshService';
import type RoomSessionService from '../room/RoomSessionService';
import type OnlineEventService from '../room/OnlineEventService';
import type RemoteControlService from './RemoteControlService';
import type StateSyncService from './StateSyncService';
import type AuthorityService from './AuthorityService';
import type ReplicaService from './ReplicaService';
import type DamageRuleService from './DamageRuleService';

/** The host checks the players' streams this often (steps of 33 ms) and for this long a silence. */
const OWNER_WATCH_EVERY_STEPS = 30;
const OWNER_SILENCE_MS = 5000;
/** A player's link must have been open this long before bots are moved onto it (a flapping link is not a home). */
const REBALANCE_SETTLE_MS = 5000;

export class NetBattleService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly meshService = inject<MeshService>(TYPES.meshService);
  private readonly roomSessionService = inject<RoomSessionService>(TYPES.roomSessionService);
  private readonly onlineEventService = inject<OnlineEventService>(TYPES.onlineEventService);
  private readonly remoteControlService = inject<RemoteControlService>(TYPES.remoteControlService);
  private readonly stateSyncService = inject<StateSyncService>(TYPES.stateSyncService);
  private readonly authorityService = inject<AuthorityService>(TYPES.authorityService);
  private readonly replicaService = inject<ReplicaService>(TYPES.replicaService);
  private readonly damageRuleService = inject<DamageRuleService>(TYPES.damageRuleService);

  private bridge: BattleBridge | null = null;
  private nowMs = 0;
  private readonly subscriptions: (() => void)[] = [];
  /** Seating a late joiner is async (its tank loads); one at a time per peer. */
  private readonly seating = new Set<string>();

  public get running(): boolean {
    return this.bridge != null;
  }

  public get isHost(): boolean {
    return this.roomSessionService.isHost;
  }

  /** The ControlSource of the replica whose actor id is `peerId`. */
  public createSource = (peerId: string): ControlSource => this.remoteControlService.createSource(peerId);

  /** The battle is loaded and its actors spawned: the netcode takes over. */
  public start = (bridge: BattleBridge, nowMs: number): void => {
    this.stop();
    this.bridge = bridge;
    this.nowMs = nowMs;
    this.stateSyncService.start(bridge);
    this.takeRole(nowMs);
    this.subscriptions.push(
      this.meshService.onMessage(this.onMessage),
      this.meshService.onLink((peerId, state) => {
        if (state === 'open') void this.onLinkOpen(peerId);
      }),
      this.onlineEventService.on('host', () => this.takeRole(this.nowMs)),
      this.onlineEventService.on('peer', ({ peerId, joined }) => {
        if (!joined) this.onPeerLeft(peerId);
      }),
      // A seat changed hands (the host's word): take or release the bot brain accordingly.
      this.onlineEventService.on('seat', () => {
        if (this.bridge != null) void this.syncBots(this.bridge);
      }),
      // The signalling socket is gone for good: the room is over, so is the battle.
      this.onlineEventService.on('left', ({ reason }) => {
        if (this.bridge != null) {
          this.loggerService.warn('room lost during the battle', reason);
          this.bridge.finish('left');
        }
      }),
    );
    // Links that were already open when the battle started (the lobby built them).
    for (const peerId of this.meshService.peers()) {
      if (this.meshService.isOpen(peerId)) void this.onLinkOpen(peerId);
    }
    this.loggerService.log('net battle started', this.isHost ? 'host' : 'replica', 'peers', this.meshService.peers().length);
  };

  public beforeStep = (nowMs: number): void => {
    this.nowMs = nowMs;
    this.stateSyncService.beforeStep(nowMs);
  };

  public afterStep = (tick: number, nowMs: number): void => {
    this.nowMs = nowMs;
    this.stateSyncService.afterStep(tick);
    if (this.authorityService.active) {
      this.authorityService.step(nowMs);
      if (tick % OWNER_WATCH_EVERY_STEPS === 0) {
        this.watchOwners(nowMs);
        this.rebalance();
      }
    } else {
      this.replicaService.afterStep();
    }
  };

  /**
   * The host's watch over the streams: a player whose poses stopped for
   * OWNER_SILENCE_MS (its network died, its page is hidden; neither the
   * server nor the link has noticed) has its tank driven by a bot on the
   * least-loaded player's machine, as if it had left, and loses the bots it
   * drove the same way — nothing stands frozen until the signalling socket
   * times out. A stream that never started (a late joiner still loading its
   * battle) is not a silence. The stream coming back gives the seat back
   * (onMessage → reclaimSeat).
   */
  private watchOwners(nowMs: number): void {
    const bridge = this.bridge;
    const seats = this.roomSessionService.started?.seats ?? [];
    if (bridge == null) return;
    for (const seat of seats) {
      if (seat.peerId === bridge.localId || !bridge.has(seat.peerId)) continue;
      const age = this.stateSyncService.poseAgeMs(seat.peerId, nowMs);
      if (seat.bot === true) {
        if (seat.owner == null || seat.owner === bridge.localId || age <= OWNER_SILENCE_MS) continue;
        const owner = this.roomSessionService.pickOwner(seat.owner);
        if (owner == null) continue;
        this.loggerService.warn('bot owner silent, moving the bot', seat.peerId, seat.owner, '->', owner);
        this.roomSessionService.setSeatBot(seat.peerId, true, owner);
        this.authorityService.announceSeat(seat.peerId, true, owner);
      } else {
        if (!Number.isFinite(age) || age <= OWNER_SILENCE_MS) continue;
        const owner = this.roomSessionService.pickOwner(seat.peerId);
        if (owner == null) continue;
        this.loggerService.warn('player silent, its tank goes to a bot', seat.peerId, '->', owner);
        this.roomSessionService.setSeatBot(seat.peerId, true, owner);
        this.authorityService.announceSeat(seat.peerId, true, owner);
      }
      this.stateSyncService.forget(seat.peerId);
    }
    void this.syncBots(bridge);
  }

  /**
   * The host gives a seat a bot has been driving back to its player: the
   * player's link came back (a reconnect, a reloaded page) or its own stream
   * resumed (a radio that recovered, a page shown again). Whoever drove the
   * bot lets go (syncBots), everybody hears `seat {bot: false}`.
   */
  private async reclaimSeat(peerId: string, why: string): Promise<void> {
    const bridge = this.bridge;
    const seat = this.roomSessionService.started?.seats.find((s) => s.peerId === peerId);
    if (bridge == null || seat?.bot !== true || !this.roomSessionService.isConnected(peerId) || this.seating.has(peerId)) return;
    this.seating.add(peerId);
    try {
      this.roomSessionService.setSeatBot(peerId, false, null);
      this.authorityService.announceSeat(peerId, false, null);
      this.stateSyncService.forget(peerId);
      await this.syncBots(bridge);
      this.loggerService.log('player back on its seat', peerId, why);
    } finally {
      this.seating.delete(peerId);
    }
  }

  public stop = (): void => {
    if (this.bridge == null) return;
    for (const off of this.subscriptions) off();
    this.subscriptions.length = 0;
    this.authorityService.stop();
    this.replicaService.stop();
    this.stateSyncService.stop();
    this.remoteControlService.dispose();
    this.seating.clear();
    this.bridge = null;
    this.loggerService.log('net battle stopped', 'mesh', { ...this.meshService.stats });
  };

  /** The host's final whistle from outside the clock (the battle session ended the battle): the replicas and the lobby hear it. */
  public announceFinish = (reason: 'time' | 'left'): void => {
    if (this.authorityService.active) this.authorityService.finish(reason);
  };

  /** Traffic and rule counters for the owner's report. */
  public get stats(): { sent: number; received: number; bytesOut: number; bytesIn: number; lastCorrection: number; snaps: number; claims: { accepted: number; clamped: number; droppedRate: number; droppedRange: number } } {
    return { ...this.meshService.stats, lastCorrection: this.stateSyncService.lastCorrection, snaps: this.stateSyncService.snaps, claims: { ...this.damageRuleService.stats } };
  }

  // --- internals ------------------------------------------------------------------------

  private takeRole(nowMs: number): void {
    const bridge = this.bridge;
    if (bridge == null) return;
    if (this.isHost) {
      this.replicaService.stop();
      this.authorityService.start(bridge, nowMs);
    } else {
      this.authorityService.stop();
      this.replicaService.start(bridge);
    }
    void this.syncBots(bridge);
  }

  /**
   * The host's even spread, kept up as players come and go: when the busiest
   * owner drives two or more bots more than the freest SETTLED player (a link
   * open for REBALANCE_SETTLE_MS — a returning player, a late joiner), one
   * bot moves there. One move per second, so a bot freezes for a moment
   * once rather than ping-pongs.
   */
  private rebalance(): void {
    const bridge = this.bridge;
    const session = this.roomSessionService;
    const seats = session.started?.seats ?? [];
    if (bridge == null) return;
    const load = session.botLoad();
    const settled = [...load.keys()].filter((id) => id === bridge.localId || (bridge.has(id) && this.meshService.openForMs(id) >= REBALANCE_SETTLE_MS));
    if (settled.length < 2) return;
    let busiest: string | null = null;
    let freest: string | null = null;
    for (const id of settled) {
      const n = load.get(id) ?? 0;
      if (busiest == null || n > (load.get(busiest) ?? 0)) busiest = id;
      if (freest == null || n < (load.get(freest) ?? 0)) freest = id;
    }
    if (busiest == null || freest == null || (load.get(busiest) ?? 0) - (load.get(freest) ?? 0) < 2) return;
    const bot = seats.find((s) => s.bot === true && s.owner === busiest && bridge.has(s.peerId));
    if (bot == null) return;
    this.loggerService.log('rebalancing a bot', bot.peerId, busiest, '->', freest);
    session.setSeatBot(bot.peerId, true, freest);
    this.authorityService.announceSeat(bot.peerId, true, freest);
    this.stateSyncService.forget(bot.peerId);
    void this.syncBots(bridge);
  }

  /**
   * Brings this machine's bot brains in line with the seat table: every bot
   * seat says which peer drives it. The HOST also keeps the table honest —
   * a human seat whose player is gone becomes a bot's, a bot whose owner is
   * gone goes to the least-loaded player — and announces each change.
   */
  private async syncBots(bridge: BattleBridge): Promise<void> {
    const session = this.roomSessionService;
    const seats = session.started?.seats ?? [];
    for (const seat of seats) {
      if (!bridge.has(seat.peerId) || seat.peerId === bridge.localId) continue;
      if (this.isHost) {
        if (seat.bot !== true && !session.isConnected(seat.peerId)) {
          const owner = session.pickOwner();
          session.setSeatBot(seat.peerId, true, owner);
          this.authorityService.announceSeat(seat.peerId, true, owner);
        } else if (seat.bot === true && (seat.owner == null || !session.isConnected(seat.owner))) {
          const owner = session.pickOwner(seat.owner ?? null);
          session.setSeatBot(seat.peerId, true, owner);
          this.authorityService.announceSeat(seat.peerId, true, owner);
        }
      }
      if (seat.bot !== true) {
        // A player's seat this machine still drives as a bot (the player is back): let go.
        if (bridge.owns(seat.peerId)) {
          this.stateSyncService.forget(seat.peerId);
          await bridge.releaseBot(seat.peerId);
        }
        continue;
      }
      const mine = bridge.owns(seat.peerId);
      const shouldOwn = seat.owner === bridge.localId;
      if (shouldOwn && !mine) {
        this.stateSyncService.forget(seat.peerId);
        await bridge.takeOverBot(seat.peerId);
      } else if (!shouldOwn && mine) {
        this.stateSyncService.forget(seat.peerId);
        await bridge.releaseBot(seat.peerId);
      }
    }
  }

  private onMessage = (from: string, message: PeerWire): void => {
    if (this.bridge == null) return;
    switch (message.t) {
      case 'cmd':
      case 'pose':
        // A player's own stream for a seat a bot drives (its silence is over): the host hands the seat back first.
        if (this.isHost && from === message.id && this.bridge.has(from)) void this.reclaimSeat(from, 'stream');
        if (this.bridge.has(message.id) && !this.bridge.owns(message.id) && this.roomSessionService.speaksFor(from, message.id)) {
          this.stateSyncService.receive(message.id, message, this.nowMs);
        }
        break;
      case 'hit':
      case 'suicide':
      case 'hello':
        if (this.authorityService.active) this.authorityService.receive(from, message);
        break;
      case 'ready':
      case 'team':
      case 'start':
        break;
      default:
        if (this.replicaService.active) this.replicaService.receive(from, message);
        break;
    }
  };

  /**
   * A link came up during the battle. A known peer: the link was rebuilt
   * (a reconnect, a reloaded page) — the host gives the seat back if a bot
   * drives it, sends the `start` again (a reloaded page sits in the lobby
   * and needs it; a peer still in the battle just refreshes its seats) and
   * pushes its view; a replica asks the host for it. A new peer: it joined
   * late and gets a tank (and, from the host, the start and a spawn).
   */
  private async onLinkOpen(peerId: string): Promise<void> {
    const bridge = this.bridge;
    if (bridge == null || this.seating.has(peerId)) return;
    if (bridge.has(peerId)) {
      if (this.isHost) {
        await this.reclaimSeat(peerId, 'link');
        if (this.bridge !== bridge) return;
        const seat = this.roomSessionService.started?.seats.find((s) => s.peerId === peerId);
        if (seat != null) this.sendStartTo(peerId, seat);
      }
      if (this.authorityService.active) this.authorityService.resync(peerId);
      else if (peerId === this.roomSessionService.hostId) this.replicaService.resync();
      return;
    }
    const seat = this.roomSessionService.seatOf(peerId);
    if (seat == null) return;
    this.seating.add(peerId);
    try {
      // On EVERY machine the newcomer gets a seat in the table: without one the host's `seat {bot}` for it
      // would be ignored here, and its tank would stand still for good once it left (the owner's bug).
      this.roomSessionService.addSeat(seat);
      if (this.isHost) {
        this.sendStartTo(peerId, seat);
      }
      await bridge.addRemote(seat);
      if (this.bridge !== bridge) return;
      if (this.authorityService.active) {
        this.authorityService.spawnNewcomer(peerId, this.nowMs);
      }
      this.onlineEventService.emit('peer', { peerId, joined: true, seat });
      this.loggerService.log('seated late joiner', peerId);
    } catch (error) {
      this.loggerService.error('seating failed', peerId, error);
    } finally {
      this.seating.delete(peerId);
    }
  }

  /** The host re-announces the battle for a late joiner: the same `start` with the current seats. */
  private sendStartTo(peerId: string, newcomer: OnlineSeat): void {
    const started = this.roomSessionService.started;
    if (started == null) return;
    const seats = started.seats.some((s) => s.peerId === newcomer.peerId) ? started.seats : [...started.seats, newcomer];
    this.meshService.send(peerId, { t: 'start', mode: started.mode, mapId: started.mapId, seed: started.seed, durationMs: started.durationMs, seats, botDifficulty: started.botDifficulty }, true);
  }

  /**
   * A player left mid-battle: its tank stays and a bot brain takes the wheel
   * on the least-loaded player's machine; the bots the leaver drove move the
   * same way. The host does the dealing (a host that left is handled by the
   * new host's syncBots).
   */
  private onPeerLeft(peerId: string): void {
    const bridge = this.bridge;
    if (bridge == null) return;
    this.stateSyncService.forget(peerId);
    if (this.isHost) {
      void this.syncBots(bridge);
      this.loggerService.log('peer left the battle, its tank and its bots are dealt to the players', peerId);
    } else {
      this.loggerService.log('peer left the battle', peerId);
    }
  }
}

export default NetBattleService;
