// The room the local player sits in, from CREATE / JOIN to the battle and
// out again: the seats (from welcome / peerJoined / peerLeft), who is host
// (welcome / hostChanged, with the epoch), the ready flags and team picks
// exchanged over the mesh, and the host's START. The mesh is built while
// everyone is still in the lobby, so the battle starts with the links up.
//
// Only this service talks to the signalling socket; the battle netcode
// (NetBattleService) listens to the mesh and to the events emitted here.
import type { BattleModeId, BotDifficulty, TeamSide } from '../../../../model/BattleConfig';
import type { LobbyPeer, LobbyRoom, RoomDraft } from '../../../../model/Lobby';
import type { OnlineStart, SessionPhase } from '../../../../model/online/OnlineEvents';
import type { JoinMessage, PeerInfo, RoomConfig, ServerMessage, TeamName, WelcomeMessage } from '../../../../model/online/protocol';
import type { OnlineSeat, PeerWire, StartMessage } from '../../../../model/online/wire';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type LobbyApiService from '../lobby/LobbyApiService';
import type SignallingService from '../signal/SignallingService';
import type RejoinStoreService from '../signal/RejoinStoreService';
import type MeshService from '../rtc/MeshService';
import type OnlineEventService from './OnlineEventService';

/** Who the local player is when it sits down. */
export interface JoinIdentity {
  name: string;
  hull: string;
  turret: string;
  paint?: string;
  team?: TeamSide;
}

interface Seat {
  info: PeerInfo;
  ready: boolean;
  linked: boolean;
}

export class RoomSessionService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly lobbyApiService = inject<LobbyApiService>(TYPES.lobbyApiService);
  private readonly signallingService = inject<SignallingService>(TYPES.signallingService);
  private readonly rejoinStoreService = inject<RejoinStoreService>(TYPES.rejoinStoreService);
  private readonly meshService = inject<MeshService>(TYPES.meshService);
  private readonly onlineEventService = inject<OnlineEventService>(TYPES.onlineEventService);

  private _phase: SessionPhase = 'idle';
  private config: RoomConfig | null = null;
  private roomName = '';
  private _localPeerId: string | null = null;
  private _hostId: string | null = null;
  private _hostEpoch = 0;
  private me: JoinIdentity | null = null;
  private readonly seats = new Map<string, Seat>();
  private _ready = false;
  private _start: OnlineStart | null = null;
  private readonly subscriptions: (() => void)[] = [];

  // --- state ---------------------------------------------------------------------

  public get phase(): SessionPhase {
    return this._phase;
  }

  public get localPeerId(): string | null {
    return this._localPeerId;
  }

  public get hostId(): string | null {
    return this._hostId;
  }

  public get hostEpoch(): number {
    return this._hostEpoch;
  }

  public get isHost(): boolean {
    return this._localPeerId != null && this._localPeerId === this._hostId;
  }

  public get ready(): boolean {
    return this._ready;
  }

  /** The start the host announced (null while in the lobby). */
  public get started(): OnlineStart | null {
    return this._start;
  }

  /** The room as the lobby screen draws it (null when not in one). */
  public room = (): LobbyRoom | null => {
    const config = this.config;
    if (config == null || this._localPeerId == null) return null;
    const peers: LobbyPeer[] = [];
    if (this.me != null) {
      peers.push({
        peerId: this._localPeerId,
        name: this.me.name,
        hull: this.me.hull,
        turret: this.me.turret,
        team: this.me.team ?? null,
        isHost: this.isHost,
        isLocal: true,
        ready: this._ready,
        linked: true,
      });
    }
    for (const seat of this.seats.values()) {
      if (!seat.info.connected) continue;
      peers.push({
        peerId: seat.info.peerId,
        name: seat.info.name,
        hull: seat.info.hull,
        turret: seat.info.turret,
        team: seat.info.team,
        isHost: seat.info.peerId === this._hostId,
        isLocal: false,
        ready: seat.ready,
        linked: seat.linked,
      });
    }
    // Host first, then join order.
    peers.sort((a, b) => Number(b.isHost) - Number(a.isHost) || this.joinSeqOf(a.peerId) - this.joinSeqOf(b.peerId));
    return {
      id: config.id,
      name: this.roomName,
      mode: config.mode,
      mapId: config.mapId,
      mapName: config.mapName,
      maxPlayers: config.maxPlayers,
      durationMin: config.durationMs != null ? Math.round(config.durationMs / 60000) : 0,
      locked: config.locked,
      peers,
    };
  };

  /** Everyone seated and linked, local included, in the order the battle lists them. */
  public seatsForStart = (): OnlineSeat[] => {
    const seats: OnlineSeat[] = [];
    if (this.me != null && this._localPeerId != null) {
      seats.push({ peerId: this._localPeerId, name: this.me.name, hull: this.me.hull, turret: this.me.turret, paint: this.me.paint ?? null, team: this.me.team ?? null });
    }
    for (const seat of this.seats.values()) {
      if (!seat.info.connected) continue;
      seats.push({ peerId: seat.info.peerId, name: seat.info.name, hull: seat.info.hull, turret: seat.info.turret, paint: seat.info.paint, team: seat.info.team });
    }
    return seats;
  };

  // --- create / join / leave --------------------------------------------------------

  /** Creates the room on the backend and sits down in it as the first peer (the host). */
  public create = async (draft: RoomDraft, mapName: string, me: JoinIdentity): Promise<void> => {
    const roomId = await this.lobbyApiService.create({
      // Explore is a solo drive; the form never offers it, the type still carries it.
      mode: draft.mode === 'explore' ? 'dm' : draft.mode,
      mapId: draft.mapId,
      mapName,
      host: me.name,
      maxPlayers: draft.maxPlayers,
      durationMs: draft.durationMin * 60000,
      password: draft.password.length > 0 ? draft.password : undefined,
    });
    await this.join(roomId, draft.password, me, draft.name);
  };

  /**
   * Joins an existing room. Rejects with the server's code (room_full,
   * bad_password, …). A room this browser sat in before (the ticket in
   * localStorage: a reloaded page) is rejoined with the token — the same
   * seat, the same peerId, mid-battle the tank a bot drove meanwhile; a
   * refused ticket (the rejoin window closed) means a fresh seat.
   */
  public join = async (roomId: string, password: string, me: JoinIdentity, roomName?: string): Promise<void> => {
    this.leave('rejoin');
    this.me = me;
    this.setPhase('connecting');
    const joinMessage: Omit<JoinMessage, 't'> = {
      name: me.name,
      hull: me.hull,
      turret: me.turret,
      paint: me.paint,
      team: me.team,
      password: password.length > 0 ? password : undefined,
    };
    let welcome: WelcomeMessage;
    try {
      welcome = await this.connectWith(roomId, joinMessage, this.rejoinStoreService.recall(roomId)?.token ?? null);
    } catch (error) {
      this.setPhase('idle');
      this.me = null;
      throw error;
    }
    this.adopt(welcome);
    this.rejoinStoreService.remember({ roomId, peerId: welcome.peerId, token: welcome.token });
    this.roomName = roomName ?? `${welcome.room.host}'s room`;
    this.subscriptions.push(
      this.signallingService.onMessage(this.onSignal),
      this.signallingService.onClose((info) => {
        if (!info.reconnecting) this.leave(info.reason || `socket ${info.code}`);
      }),
      this.signallingService.onReconnected(this.onReconnected),
      this.meshService.onMessage(this.onPeerMessage),
      this.meshService.onLink((peerId, state) => {
        const seat = this.seats.get(peerId);
        if (seat != null) {
          seat.linked = state === 'open';
          this.emitRoom();
        }
      }),
    );
    this.meshService.start(welcome.peerId, welcome.iceServers, (to, kind, payload) => {
      this.signallingService.send({ t: 'signal', to, kind, payload });
    });
    for (const seat of this.seats.values()) {
      if (seat.info.connected) this.meshService.connect(seat.info.peerId);
    }
    this.setPhase('lobby');
    this.loggerService.log('joined room', roomId, 'as', welcome.peerId, this.isHost ? '(host)' : '', this.seats.size, 'others');
  };

  /** Leaves the room: the seat is freed, the links close, the screen goes back to the list. */
  public leave = (reason = 'left'): void => {
    const wasIn = this._phase !== 'idle';
    const roomId = this.config?.id ?? null;
    for (const off of this.subscriptions) off();
    this.subscriptions.length = 0;
    this.meshService.stop();
    // The seat is given up only when the goodbye went out; after a lost socket the ticket stays for the comeback.
    if (this.signallingService.leave() && roomId != null) this.rejoinStoreService.forget(roomId);
    this.seats.clear();
    this.config = null;
    this._localPeerId = null;
    this._hostId = null;
    this._hostEpoch = 0;
    this._ready = false;
    this._start = null;
    this.me = null;
    this.setPhase('idle');
    if (wasIn) {
      this.loggerService.log('left room', reason);
      this.onlineEventService.emit('left', { reason });
    }
  };

  // --- the lobby -----------------------------------------------------------------------

  public setReady = (on: boolean): void => {
    if (this._ready === on) return;
    this._ready = on;
    this.meshService.broadcast({ t: 'ready', on });
    this.emitRoom();
  };

  /** Any side, any time: friends sort their own teams (the room only seats a newcomer on the emptier side). */
  public canPickTeam = (team: TeamSide): boolean => this.me != null && (team === 'red' || team === 'blue');

  /** Seated players per side, for the lobby's hint. */
  public sides = (): { red: number; blue: number } => {
    const sides = { red: 0, blue: 0 };
    if (this.me?.team != null) sides[this.me.team]++;
    for (const seat of this.seats.values()) {
      if (seat.info.connected && seat.info.team != null) sides[seat.info.team]++;
    }
    return sides;
  };

  public setTeam = (team: TeamSide): void => {
    if (this.me == null || !this.canPickTeam(team)) return;
    this.me.team = team;
    this.meshService.broadcast({ t: 'team', team });
    this.emitRoom();
  };

  /** A player seated after the start (a late joiner) joins the table, so its tank can go to a bot and be dealt like any other. */
  public addSeat = (seat: OnlineSeat): void => {
    const start = this._start;
    if (start == null || start.seats.some((s) => s.peerId === seat.peerId)) return;
    start.seats.push({ ...seat });
  };

  /** A started battle's seat changes hands: a tank goes to a bot brain on `owner`'s machine, a bot moves owner, or a returning player takes its tank back. */
  public setSeatBot = (peerId: string, bot: boolean, owner?: string | null): void => {
    const seat = this._start?.seats.find((s) => s.peerId === peerId);
    if (seat == null) return;
    seat.bot = bot;
    if (!bot) delete seat.owner;
    else if (owner != null) seat.owner = owner;
  };

  /** May `from` speak (commands, poses, hit claims) for actor `id`? Its own tank, or a bot it drives. */
  public speaksFor = (from: string, id: string): boolean => {
    if (id === from) return true;
    const seat = this._start?.seats.find((s) => s.peerId === id);
    return seat?.bot === true && seat.owner === from;
  };

  /** The bots each connected player drives, for spreading them evenly. */
  public botLoad = (): Map<string, number> => {
    const load = new Map<string, number>();
    if (this._localPeerId != null) load.set(this._localPeerId, 0);
    for (const seat of this.seats.values()) {
      if (seat.info.connected) load.set(seat.info.peerId, 0);
    }
    for (const seat of this._start?.seats ?? []) {
      if (seat.bot === true && seat.owner != null && load.has(seat.owner)) load.set(seat.owner, (load.get(seat.owner) ?? 0) + 1);
    }
    return load;
  };

  /** The connected player with the fewest bots (ties: the host, then join order); null when nobody is connected. */
  public pickOwner = (exclude: string | null = null): string | null => {
    let best: string | null = null;
    let bestLoad = Infinity;
    for (const [peerId, count] of this.botLoad()) {
      if (peerId === exclude) continue;
      if (count < bestLoad || (count === bestLoad && best !== null && this.joinSeqOf(peerId) < this.joinSeqOf(best))) {
        best = peerId;
        bestLoad = count;
      }
    }
    return best;
  };

  /** True while the peer holds an open socket to the room (a leaver's seat lingers for the rejoin window). */
  public isConnected = (peerId: string): boolean => peerId === this._localPeerId || (this.seats.get(peerId)?.info.connected ?? false);

  /** The host starts the battle for everyone seated, plus the bots (`bot: true` seats), their brains spread evenly over the players' machines. */
  public start = (bots: OnlineSeat[] = [], botDifficulty: BotDifficulty = 'normal'): OnlineStart | null => {
    const config = this.config;
    if (!this.isHost || config == null) return null;
    // Round-robin by load over the connected players, the host first: 3 players + 4 bots = 2 / 1 / 1.
    const load = this.botLoad();
    const owners = [...load.keys()].sort((a, b) => this.joinSeqOf(a) - this.joinSeqOf(b));
    const spread = bots.map((b, i) => ({ ...b, bot: true, owner: owners.length > 0 ? owners[i % owners.length] : this._localPeerId ?? undefined }));
    const message: StartMessage = {
      t: 'start',
      mode: config.mode,
      mapId: config.mapId,
      seed: Math.floor(Math.random() * 0x7fffffff),
      durationMs: config.durationMs,
      seats: [...this.seatsForStart(), ...spread],
      botDifficulty,
    };
    this.meshService.broadcast(message);
    this.signallingService.send({ t: 'listing', phase: 'playing' });
    return this.beginBattle(message);
  };

  /** The host tells the server the battle is over (the room is listed as open again). */
  public reportPhase = (phase: 'open' | 'playing' | 'finished'): void => {
    if (this.isHost) this.signallingService.send({ t: 'listing', phase });
  };

  // --- signalling ------------------------------------------------------------------

  /** Connects with the ticket's token when there is one; a refused token falls back to a fresh join (and drops the ticket). */
  private async connectWith(roomId: string, join: Omit<JoinMessage, 't'>, token: string | null): Promise<WelcomeMessage> {
    if (token == null) return this.signallingService.connect(roomId, join);
    try {
      const welcome = await this.signallingService.connect(roomId, { ...join, token });
      this.loggerService.log('back on the seat', welcome.peerId, 'in', roomId);
      return welcome;
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code !== 'bad_token') throw error;
      this.loggerService.log('rejoin ticket refused, taking a fresh seat', roomId);
      this.rejoinStoreService.forget(roomId);
      return this.signallingService.connect(roomId, join);
    }
  }

  private adopt(welcome: WelcomeMessage): void {
    this.config = welcome.room;
    this._localPeerId = welcome.peerId;
    // The room balances the sides: the seat it gave us is the one we sit on.
    if (this.me != null && welcome.me?.team != null) this.me.team = welcome.me.team;
    this._hostId = welcome.hostId;
    this._hostEpoch = welcome.hostEpoch;
    this.seats.clear();
    for (const peer of welcome.peers) {
      this.seats.set(peer.peerId, { info: peer, ready: false, linked: false });
    }
  }

  private onSignal = (message: ServerMessage): void => {
    switch (message.t) {
      case 'peerJoined': {
        const existing = this.seats.get(message.peer.peerId);
        this.seats.set(message.peer.peerId, { info: message.peer, ready: existing?.ready ?? false, linked: false });
        // A returning peer's old connection is gone: a fresh link either way.
        this.meshService.connect(message.peer.peerId);
        this.emitRoom();
        break;
      }
      case 'peerLeft': {
        const seat = this.seats.get(message.peerId);
        if (seat != null) {
          seat.info = { ...seat.info, connected: false };
          seat.linked = false;
          seat.ready = false;
        }
        this.meshService.disconnect(message.peerId);
        this.emitRoom();
        if (this._phase === 'battle') {
          this.onlineEventService.emit('peer', { peerId: message.peerId, joined: false, seat: null });
        }
        break;
      }
      case 'hostChanged':
        this._hostId = message.hostId;
        this._hostEpoch = message.hostEpoch;
        this.loggerService.log('host changed', message.hostId, 'epoch', message.hostEpoch);
        this.onlineEventService.emit('host', { hostId: message.hostId, hostEpoch: message.hostEpoch });
        this.emitRoom();
        break;
      case 'signal':
        this.meshService.handleSignal(message.from, message.kind, message.payload);
        break;
      case 'error':
        this.loggerService.warn('signalling error', message.code, message.message);
        this.onlineEventService.emit('error', { code: message.code, message: message.message ?? message.code });
        break;
      default:
        break;
    }
  };

  /** Back on the socket with the token: the roster may have moved on; relink everyone. */
  private onReconnected = (welcome: WelcomeMessage): void => {
    const wasHost = this.isHost;
    this.adopt(welcome);
    if (this.config != null) this.rejoinStoreService.remember({ roomId: this.config.id, peerId: welcome.peerId, token: welcome.token });
    this.meshService.stop();
    this.meshService.start(welcome.peerId, welcome.iceServers, (to, kind, payload) => {
      this.signallingService.send({ t: 'signal', to, kind, payload });
    });
    for (const seat of this.seats.values()) {
      if (seat.info.connected) this.meshService.connect(seat.info.peerId);
    }
    if (wasHost !== this.isHost) {
      this.onlineEventService.emit('host', { hostId: this._hostId ?? welcome.peerId, hostEpoch: this._hostEpoch });
    }
    this.emitRoom();
  };

  // --- the mesh ----------------------------------------------------------------------

  private onPeerMessage = (from: string, message: PeerWire): void => {
    const seat = this.seats.get(from);
    switch (message.t) {
      case 'ready':
        if (seat != null) {
          seat.ready = message.on;
          this.emitRoom();
        }
        break;
      case 'team':
        if (seat != null) {
          seat.info = { ...seat.info, team: message.team };
          this.emitRoom();
        }
        break;
      case 'start':
        // Only the host may start; a late joiner gets the same message from it.
        if (from === this._hostId && this._phase !== 'battle') {
          this.beginBattle(message);
        } else if (from === this._hostId && this._phase === 'battle') {
          // A re-announcement (a host migration): keep the seats current.
          this._start = this.toStart(message);
        }
        break;
      default:
        break;
    }
  };

  private beginBattle(message: StartMessage): OnlineStart {
    const start = this.toStart(message);
    this._start = start;
    this._ready = false;
    this.setPhase('battle');
    this.onlineEventService.emit('start', start);
    return start;
  }

  private toStart(message: StartMessage): OnlineStart {
    return {
      roomId: this.config?.id ?? '',
      localPeerId: this._localPeerId ?? '',
      hostId: this._hostId ?? '',
      hostEpoch: this._hostEpoch,
      mode: message.mode as BattleModeId,
      mapId: message.mapId,
      seed: message.seed,
      durationMs: message.durationMs,
      seats: message.seats,
      botDifficulty: message.botDifficulty ?? 'normal',
    };
  }

  /** A peer that joined while the battle runs, as a seat (for the host's re-announce and the replicas). */
  public seatOf = (peerId: string): OnlineSeat | null => {
    const seat = this.seats.get(peerId);
    if (seat == null) return null;
    return { peerId, name: seat.info.name, hull: seat.info.hull, turret: seat.info.turret, paint: seat.info.paint, team: seat.info.team };
  };

  /** The local player's own team pick, as a wire team (null in deathmatch). */
  public localTeam = (): TeamName | null => this.me?.team ?? null;

  private joinSeqOf(peerId: string): number {
    // The host (the earliest seat alive) sorts first; our own seat's joinSeq is not in the welcome, so it goes by host-ness.
    if (peerId === this._localPeerId) return this.isHost ? -1 : Number.MAX_SAFE_INTEGER - 1;
    if (peerId === this._hostId) return -1;
    return this.seats.get(peerId)?.info.joinSeq ?? Number.MAX_SAFE_INTEGER;
  }

  private setPhase(phase: SessionPhase): void {
    this._phase = phase;
    this.emitRoom();
  }

  private emitRoom(): void {
    this.onlineEventService.emit('room', { room: this.room(), phase: this._phase });
  }
}

export default RoomSessionService;
