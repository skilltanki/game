// The multiplayer step of the start menu (the third step when MULTIPLAYER is
// picked on the MODE tab): the rooms list, the create-room form and the
// lobby, in the HUD language of the rest of the menu. Three views, one body:
//   ROOMS    — the open rooms OF THE MODE PICKED ON THE MODE TAB (the server
//              filters: `?mode=`), read every time the list
//              comes on screen, then every LIST_POLL_MS while it stays there
//              (silently: the cards redraw only when the listing changed), and
//              by the REFRESH chip; one request at a time (the chip is off
//              while it runs), nothing while the tab is hidden; a tap on a
//              room joins it (a locked one unfolds a password line first);
//              the round button is CREATE and opens the form.
//   NEW ROOM — two pages (a phone cannot hold both): the settings (name,
//              password, players, duration, bots, mode; the round button is
//              NEXT) and then the MAP page (the searchable strip; the round
//              button is CREATE and seats the player in the lobby).
//   LOBBY    — the room card, the seats (host and you badged, the empty ones
//              dim), the side chips in team modes; the round button is
//              START for the host and READY for a guest; LEAVE goes back.
// The keyboard walks every row (keyRows.ts); a tap acts at once.
//
// Everything here goes through lib/online: the listing and room creation
// (LobbyApiService), the seat (RoomSessionService: join over the signalling
// socket, the mesh to the other peers, ready / team, the host's START) and
// its events (OnlineEventService: redraw on every roster change, play when
// the host starts, back to the list when the room is gone).
import { BATTLE_MODES, type BattleModeId } from '../../../../engine/game/BattleMode';
import { CC_DEFAULT_ROOM_BOTS, CC_ROOM_DURATIONS_MIN, CC_ROOM_MAX_BOTS, CC_ROOM_MAX_PLAYERS, CC_ROOM_MIN_PLAYERS, CC_ROOM_NAME_MAX, CC_ROOM_PASSWORD_MAX } from '../../../../config/params';
import type { BattleConfig, BotDifficulty, TeamSide } from '../../../../model/BattleConfig';
import { MULTIPLAYER_MODES, type RoomDraft, type RoomListing } from '../../../../model/Lobby';
import type { OnlineStart } from '../../../../model/online/OnlineEvents';
import { clear, h, lazyImage, tappable, teamColor } from '../../../../ui/dom';
import type { KeyRow } from '../../../../ui/keyRows';
import { chips, counter, nextButton, scrollStripTo, textField } from '../../../../ui/widgets';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type StorageService from '../base/StorageService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type ModeRuleService from '../mode/ModeRuleService';
import { online } from '../../../online';
import type { JoinIdentity } from '../../../online/services/room/RoomSessionService';

type View = 'list' | 'create' | 'createMap' | 'lobby';

/** What the menu does with its round button while this step is up. */
export interface StepButton {
  label: string;
  /** Green (an action) rather than the grey NEXT. */
  primary: boolean;
  action: () => void;
  /** The keyboard row the arrows start on (default 0): the map page starts on the tiles, not on the back chip. */
  focusRow?: number;
}

/** What the step needs from the menu around it. */
export interface RoomsStepHost {
  /** The keyboard rows of the screen, in reading order; the step appends its own. */
  rows: KeyRow[];
  /** Draws the step again (a view switched, a list arrived). */
  refresh: () => void;
  /** Shows a map behind the menu. */
  showBackdrop: (mapId: string) => void;
  /** Starts a battle. */
  play: (config: BattleConfig) => void;
}

/** The rooms list asks the lobby again this often while it is on screen. */
const LIST_POLL_MS = 10000;
/** The REFRESH chip stays off this long after a load (a fast lobby answers in 10 ms; a hammered chip must not hammer it). */
const REFRESH_COOLDOWN_MS = 1000;

const MODE_SHORT: Record<BattleModeId, string> = { dm: 'DM', tdm: 'TDM', ctf: 'CTF', assault: 'ASSAULT', explore: 'EXPLORE' };
const LOCK_GLYPH = '🔒';
/** The seats a lobby lists even in an 8-player room, so the screen stays short. */
const LOBBY_SEATS_SHOWN = CC_ROOM_MAX_PLAYERS;
/** What the server's join refusals read as under the password line. */
const JOIN_ERRORS: Record<string, string> = {
  bad_password: 'Wrong password',
  room_full: 'The room is full',
  room_not_found: 'The room is gone',
  finished: 'The battle is over',
  bad_token: 'The seat was lost',
  'join timed out': 'No answer from the lobby',
};

export class RoomsMenuService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);

  private view: View = 'list';
  private listings: RoomListing[] | null = null;
  /** The mode the listings were fetched for; another mode on the MODE tab makes them stale. */
  private listingsMode: string | null = null;
  private listError: string | null = null;
  private loading = false;
  /** Bumped per fetch; a result from an older fetch is dropped. */
  private fetchToken = 0;
  /** True while the list is on screen (the open refresh happened, the poll runs). */
  private listOpen = false;
  private lastLoadedAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onVisible: (() => void) | null = null;
  /** The locked room whose password line is open. */
  private joiningId: string | null = null;
  private joinPassword = '';
  /** The server's refusal under the password line (or the create form). */
  private joinError: string | null = null;
  /** A join / create in flight: the buttons wait. */
  private busy = false;
  private draft: RoomDraft | null = null;
  /** The map search in the create form (kept across redraws of the form). */
  private mapQuery = '';
  /** Index of the map tiles' keyboard row on the map page (the arrows start there). */
  private mapRowIndex = 0;
  /** Session events, while the step is up (off again on reset or when the battle starts). */
  private readonly subscriptions: (() => void)[] = [];
  private host: RoomsStepHost | null = null;

  /** Every visit to the menu starts on the rooms list; a seat still held from before is given up. */
  public reset = (): void => {
    this.sleep();
    this.detach();
    this.view = 'list';
    this.joiningId = null;
    this.joinPassword = '';
    this.joinError = null;
    this.busy = false;
    this.draft = null;
    this.mapQuery = '';
    if (online.roomSessionService.phase !== 'idle') {
      online.roomSessionService.leave('menu reset');
    }
  };

  /** The list went off screen (another tab, the menu hidden): no polling until it is drawn again. */
  public sleep = (): void => {
    this.listOpen = false;
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.onVisible != null) {
      document.removeEventListener('visibilitychange', this.onVisible);
      this.onVisible = null;
    }
  };

  /** The step's name for the title chip. */
  public title = (): string => (this.view === 'create' ? 'NEW ROOM' : this.view === 'createMap' ? 'NEW ROOM · MAP' : this.view === 'lobby' ? 'LOBBY' : 'ROOMS');

  /** Draws the current view into `body` and says what the round button does. */
  public render = (body: HTMLElement, host: RoomsStepHost): StepButton => {
    this.attach(host);
    // The session is the truth: a lobby view without a seat falls back to the list.
    if (this.view === 'lobby' && online.roomSessionService.room() == null) {
      this.view = 'list';
    }
    if (this.view !== 'list') this.sleep();
    switch (this.view) {
      case 'create':
        return this.renderCreate(body, host);
      case 'createMap':
        return this.renderCreateMap(body, host);
      case 'lobby':
        return this.renderLobby(body, host);
      default:
        return this.renderList(body, host);
    }
  };

  // --- ROOMS ----------------------------------------------------------------

  private renderList(body: HTMLElement, host: RoomsStepHost): StepButton {
    const mode = this.listMode();
    if (this.listings != null && this.listingsMode !== mode) {
      // The MODE tab changed since: the cards on hand are another mode's.
      this.listings = null;
    }
    if (!this.listOpen) {
      // The list just came on screen: ask at once (loudly when there is nothing to show yet), then keep asking.
      // No redraw from inside this draw: the chips below already read `loading` (a redraw here appended a second table).
      this.listOpen = true;
      this.load(host, this.listings != null, true);
      this.pollTimer = setInterval(() => {
        if (this.listOpen && this.view === 'list' && this.host != null && document.visibilityState === 'visible') this.load(this.host, true);
      }, LIST_POLL_MS);
      this.onVisible = () => {
        if (document.visibilityState === 'visible' && this.listOpen && this.view === 'list' && this.host != null) this.load(this.host, true);
      };
      document.addEventListener('visibilitychange', this.onVisible);
    }
    const refresh = h('div', { class: `chip chip-btn ${this.loading ? 'is-off' : ''}`, text: this.loading ? 'LOADING…' : 'REFRESH' });
    tappable(refresh, () => this.refreshTapped(host));
    const create = h('div', { class: 'chip chip-btn is-selected', text: '+ NEW ROOM' });
    tappable(create, () => this.openCreate(host));
    host.rows.push({
      kind: 'pick',
      elements: [create, refresh],
      selected: () => 0,
      activate: (index) => (index === 0 ? this.openCreate(host) : this.refreshTapped(host)),
    });

    const list = h('div', { class: 'rooms' });
    const cards: HTMLElement[] = [];
    const rooms = (this.listings ?? []).filter((r) => r.phase !== 'finished' && r.mode === mode);
    for (const room of rooms) {
      const card = this.roomCard(room, host);
      list.appendChild(card);
      cards.push(card);
    }
    if (rooms.length > 0) {
      host.rows.push({
        kind: 'pick',
        elements: cards,
        selected: () => Math.max(0, rooms.findIndex((r) => r.id === this.joiningId)),
        activate: (index) => this.tapRoom(rooms[index], host),
      });
    } else if (this.loading) {
      list.appendChild(h('div', { class: 'hint rooms-hint', text: 'Looking for rooms…' }));
    } else if (this.listError != null) {
      list.appendChild(h('div', { class: 'hint rooms-hint error', text: `Lobby unreachable · ${this.listError}` }));
    } else {
      list.appendChild(h('div', { class: 'hint rooms-hint', text: `No open ${MODE_SHORT[mode]} rooms. Create the first one — the round button, or pick another mode on the MODE tab.` }));
    }
    if (this.joinError != null && this.joiningId == null) {
      list.prepend(h('div', { class: 'hint rooms-hint error', text: this.joinError }));
    }
    body.appendChild(
      // The head stays put; the list scrolls under it (theme.css .section-rooms).
      h('div', { class: 'section section-rooms' }, h('div', { class: 'section-head' }, h('div', { class: 'caption', text: `${MODE_SHORT[mode]} rooms · tap to join` }), h('div', { class: 'opt-row rooms-actions' }, create, refresh)), list),
    );
    return { label: 'CREATE', primary: true, action: () => this.openCreate(host) };
  }

  private roomCard(room: RoomListing, host: RoomsStepHost): HTMLElement {
    const full = room.players >= room.maxPlayers;
    const playing = room.phase === 'playing';
    const open = this.joiningId === room.id;
    const thumb = this.assetCatalogService.map(room.mapId)?.thumbnail;
    // Left to right: the map's thumbnail, the host's name over the map name,
    // then the mode badge, the lock, the seats taken and the state.
    const card = h(
      'div',
      // A running battle can still be joined (the seats fill mid-battle); only a full room is off.
      { class: `room ${open ? 'is-selected' : ''} ${full ? 'is-full' : ''}` },
      h(
        'div',
        { class: 'room-row' },
        h('div', { class: 'room-thumb' }, thumb != null ? lazyImage(thumb) : null),
        h(
          'div',
          { class: 'room-main' },
          h('div', { class: 'room-name', text: room.host.length > 0 ? `${room.host}'s room` : 'Room' }),
          h('div', { class: 'room-meta', text: room.mapName }),
        ),
        h(
          'div',
          { class: 'room-side' },
          h('span', { class: `room-mode is-${room.mode}`, text: MODE_SHORT[room.mode] ?? room.mode }),
          room.locked ? h('span', { class: 'room-lock', text: LOCK_GLYPH, attrs: { title: 'Password' } }) : null,
          h('span', { class: `room-count ${full ? 'is-full' : ''}` }, h('b', { text: String(room.players) }), h('span', { class: 'dim', text: `/${room.maxPlayers}` })),
          h('span', { class: `room-phase ${playing ? 'is-playing' : full ? 'is-full' : ''}`, text: playing ? 'IN BATTLE' : full ? 'FULL' : 'OPEN' }),
        ),
      ),
    );
    tappable(card, () => this.tapRoom(room, host));
    if (open && room.locked) {
      // The password line under a locked room: typed here, JOIN sends it.
      const input = h('input', { class: 'chip chip-input', attrs: { type: 'password', placeholder: 'Password', autocomplete: 'off', maxlength: String(CC_ROOM_PASSWORD_MAX) } });
      input.value = this.joinPassword;
      input.addEventListener('input', () => {
        this.joinPassword = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.join(room, host);
        } else if (e.key === 'Escape') {
          input.blur();
        }
      });
      // A tap inside the line must not count as a tap on the card.
      const line = h('div', { class: 'room-join', on: { pointerup: (e) => e.stopPropagation(), pointerdown: (e) => e.stopPropagation() } });
      const join = h('div', { class: `chip chip-btn is-selected ${this.busy ? 'is-off' : ''}`, text: this.busy ? 'JOINING…' : 'JOIN' });
      tappable(join, () => this.join(room, host));
      line.append(input, join);
      if (this.joinError != null) line.appendChild(h('span', { class: 'hint error', text: this.joinError }));
      card.appendChild(line);
      host.rows.push({ kind: 'pick', elements: [input, join], selected: () => 0, activate: (index) => (index === 0 ? input.focus() : this.join(room, host)) });
      requestAnimationFrame(() => input.focus());
    }
    return card;
  }

  /** A tap on a room: an open one is joined at once, a locked one unfolds its password line. */
  private tapRoom(room: RoomListing, host: RoomsStepHost): void {
    if (room.players >= room.maxPlayers || room.phase === 'finished' || this.busy) {
      return;
    }
    this.joinError = null;
    if (!room.locked) {
      this.join(room, host);
      return;
    }
    this.joiningId = this.joiningId === room.id ? null : room.id;
    this.joinPassword = '';
    host.refresh();
  }

  private join(room: RoomListing, host: RoomsStepHost): void {
    if (this.busy) return;
    this.busy = true;
    this.joinError = null;
    host.refresh();
    online.roomSessionService
      .join(room.id, this.joinPassword, this.identity(room.mode), room.host.length > 0 ? `${room.host}'s room` : 'Room')
      .then(() => {
        this.joiningId = null;
        this.joinPassword = '';
        this.view = 'lobby';
        host.showBackdrop(room.mapId);
      })
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : String(error);
        this.joinError = JOIN_ERRORS[code] ?? `Could not join (${code})`;
        this.joiningId = room.id;
        this.loggerService.warn('rooms: join failed', code);
      })
      .finally(() => {
        this.busy = false;
        host.refresh();
      });
  }

  /** Who sits down: the profile's call sign and loadout. No side is asked for: the room seats a newcomer on the emptier one, the lobby chips let friends sort themselves. */
  private identity(mode: BattleModeId): JoinIdentity {
    const profile = this.storageService.getProfile();
    void mode;
    return {
      name: profile.name.trim() || 'Player',
      hull: profile.hull,
      turret: profile.turret,
      paint: profile.paint,
    };
  }

  // --- the session's events -------------------------------------------------------

  private attach(host: RoomsStepHost): void {
    this.host = host;
    if (this.subscriptions.length > 0) return;
    const events = online.onlineEventService;
    this.subscriptions.push(
      events.on('room', () => {
        if (this.view === 'lobby') this.host?.refresh();
      }),
      events.on('start', (start) => this.play(start)),
      events.on('left', ({ reason }) => {
        if (this.view === 'lobby') {
          this.view = 'list';
          this.listings = null;
          this.joinError = reason === 'left' || reason === 'menu reset' ? null : `Left the room: ${reason}`;
          this.host?.refresh();
        }
      }),
      events.on('error', ({ code, message }) => {
        this.joinError = JOIN_ERRORS[code] ?? message;
        this.host?.refresh();
      }),
    );
  }

  private detach(): void {
    for (const off of this.subscriptions) off();
    this.subscriptions.length = 0;
    this.host = null;
  }

  /** The host pressed START (or we joined a running battle): into the battle with the room's seats. */
  private play(start: OnlineStart): void {
    const host = this.host;
    if (host == null) return;
    const profile = this.storageService.getProfile();
    const config: BattleConfig = {
      mode: start.mode,
      mapId: start.mapId,
      playerName: profile.name.trim() || 'Player',
      loadout: { hull: profile.hull, turret: profile.turret, paint: profile.paint, modification: profile.modification },
      // The side the room seated us on (balanced on join), not the profile's wish.
      team: online.roomSessionService.localTeam() ?? profile.team,
      bots: 0,
      botDifficulty: profile.botDifficulty,
      seed: start.seed,
      online: { roomId: start.roomId, localPeerId: start.localPeerId, hostId: start.hostId, hostEpoch: start.hostEpoch, durationMs: start.durationMs, seats: start.seats, botDifficulty: start.botDifficulty },
    };
    this.detach();
    this.view = 'list';
    host.play(config);
  }

  /** The mode picked on the MODE tab: the list shows its rooms only (a multiplayer mode; anything else falls back to DM). */
  private listMode(): BattleModeId {
    const mode = this.storageService.getProfile().mode;
    return MULTIPLAYER_MODES.includes(mode) ? mode : 'dm';
  }

  /** The REFRESH chip: a loud load, at most once a second (the poll goes on regardless). */
  private refreshTapped(host: RoomsStepHost): void {
    if (performance.now() - this.lastLoadedAt < REFRESH_COOLDOWN_MS) return;
    this.load(host);
  }

  /**
   * One request at a time: a tap while one runs is ignored here, and
   * LobbyApiService dedupes below that. A `silent` load (the poll, the
   * open of a list that already has cards) shows no LOADING state and
   * redraws only when the listing actually changed, so the cards never
   * flicker under the player's thumb.
   */
  private load(host: RoomsStepHost, silent = false, drawing = false): void {
    if (this.loading || online.lobbyApiService.busy) return;
    this.loading = true;
    const token = ++this.fetchToken;
    const before = listingKey(this.listings);
    const mode = this.listMode();
    if (!silent) {
      this.listError = null;
      // A loud load redraws for its LOADING state — unless a draw is already in progress (it reads the flag itself).
      if (!drawing) host.refresh();
    }
    online.lobbyApiService
      .list(mode)
      .then((rooms) => {
        if (token !== this.fetchToken) return;
        this.listings = rooms;
        this.listingsMode = mode;
        this.listError = null;
      })
      .catch((error: unknown) => {
        if (token !== this.fetchToken) return;
        // A failed poll keeps the cards it had; a failed loud load says so.
        if (!silent || this.listings == null) this.listings = [];
        this.listError = error instanceof Error ? error.message : String(error);
        this.loggerService.warn('rooms: list failed', error);
      })
      .finally(() => {
        if (token !== this.fetchToken) return;
        this.loading = false;
        this.lastLoadedAt = performance.now();
        if (this.view === 'list' && (!silent || listingKey(this.listings) !== before)) host.refresh();
      });
  }

  // --- NEW ROOM --------------------------------------------------------------

  private openCreate(host: RoomsStepHost): void {
    const profile = this.storageService.getProfile();
    const mode = MULTIPLAYER_MODES.includes(profile.mode) ? profile.mode : 'dm';
    this.draft = {
      name: profile.roomName ?? `${profile.name}'s room`,
      password: '',
      mode,
      mapId: this.usableMap(mode, profile.mapId),
      maxPlayers: profile.roomMaxPlayers ?? CC_ROOM_MAX_PLAYERS,
      durationMin: profile.roomDurationMin ?? CC_ROOM_DURATIONS_MIN[1],
    };
    this.view = 'create';
    host.showBackdrop(this.draft.mapId);
    host.refresh();
  }

  private renderCreate(body: HTMLElement, host: RoomsStepHost): StepButton {
    const draft = this.draft!;
    const profile = this.storageService.getProfile();
    const back = h('div', { class: 'chip chip-btn', text: '‹ ROOMS' });
    tappable(back, () => this.closeCreate(host));
    host.rows.push({ kind: 'pick', elements: [back], selected: () => 0, activate: () => this.closeCreate(host) });
    body.appendChild(h('div', { class: 'section-head' }, h('div', { class: 'caption', text: 'New room' }), back));

    const fields = h('div', { class: 'opts' });
    fields.appendChild(
      textField(host.rows, 'Room name', draft.name, (value) => {
        draft.name = value;
      }, { placeholder: 'Room name', maxLength: CC_ROOM_NAME_MAX, wide: true }),
    );
    fields.appendChild(
      textField(host.rows, 'Password · optional', draft.password, (value) => {
        draft.password = value;
      }, { placeholder: 'No password', maxLength: CC_ROOM_PASSWORD_MAX, type: 'password' }),
    );
    fields.appendChild(
      counter(host.rows, 'Players', draft.maxPlayers, CC_ROOM_MIN_PLAYERS, CC_ROOM_MAX_PLAYERS, (value) => {
        draft.maxPlayers = value;
      }),
    );
    fields.appendChild(
      chips(
        host.rows,
        'Duration',
        CC_ROOM_DURATIONS_MIN.map((min) => ({ id: String(min), label: `${min} MIN` })),
        String(draft.durationMin),
        (id) => {
          draft.durationMin = Number(id);
        },
      ),
    );
    // The host's bots for ITS rooms: off by default (the single-player count is a different setting).
    fields.appendChild(counter(host.rows, 'Bots', profile.roomBots ?? CC_DEFAULT_ROOM_BOTS, 0, CC_ROOM_MAX_BOTS, (value) => this.storageService.saveProfile({ roomBots: value })));
    fields.appendChild(
      chips<BotDifficulty>(
        host.rows,
        'Bots level',
        [
          { id: 'easy', label: 'EASY' },
          { id: 'normal', label: 'NORMAL' },
          { id: 'hard', label: 'HARD' },
        ],
        profile.botDifficulty,
        (id) => this.storageService.saveProfile({ botDifficulty: id }),
      ),
    );
    fields.appendChild(
      chips(
        host.rows,
        'Mode',
        MULTIPLAYER_MODES.map((id) => ({ id, label: MODE_SHORT[id] })),
        draft.mode,
        (id) => {
          draft.mode = id;
          this.storageService.saveProfile({ mode: id });
          // A flag mode narrows the maps: the pick moves to a flag map when it has to (the hint below follows).
          draft.mapId = this.usableMap(id, draft.mapId);
          host.showBackdrop(draft.mapId);
          host.refresh();
        },
      ),
    );
    body.appendChild(fields);
    if (this.joinError != null) body.appendChild(h('div', { class: 'hint error', text: this.joinError }));
    // The garage's rectangular NEXT under the fields (desktop only); the round NEXT in the corner stays for the thumb.
    nextButton(host.rows, body, () => this.openCreateMap(host));
    return { label: 'NEXT', primary: false, action: () => this.openCreateMap(host) };
  }

  private openCreateMap(host: RoomsStepHost): void {
    if (this.draft == null) return;
    this.view = 'createMap';
    host.showBackdrop(this.draft.mapId);
    host.refresh();
  }

  /** The second page of the form: the map, with the search; CREATE seats the host in the lobby. */
  private renderCreateMap(body: HTMLElement, host: RoomsStepHost): StepButton {
    const draft = this.draft!;
    const back = h('div', { class: 'chip chip-btn', text: '‹ SETTINGS' });
    const toSettings = (): void => {
      this.view = 'create';
      host.refresh();
    };
    tappable(back, toSettings);
    host.rows.push({ kind: 'pick', elements: [back], selected: () => 0, activate: toSettings });
    body.appendChild(h('div', { class: 'section-head' }, h('div', { class: 'caption', text: `${draft.name.trim() || 'New room'} · ${MODE_SHORT[draft.mode]} · ${draft.maxPlayers} players` }), back));
    body.appendChild(this.mapPicker(draft, host));
    if (this.joinError != null) body.appendChild(h('div', { class: 'hint error', text: this.joinError }));
    // The arrows land on the tiles at once (Left/Right walk the maps, Enter or Space picks); ‹ SETTINGS and the search are a row up.
    return { label: this.busy ? 'WAIT…' : 'CREATE', primary: !this.busy, action: () => this.create(host), focusRow: this.mapRowIndex };
  }

  /**
   * The map strip of the create form with a search chip in its head — the
   * single-player MAP step's picker (MenuService.renderMap), for the host:
   * typing filters the tiles by name without leaving the form, the chosen
   * tile stays chosen while it matches. The map is the last choice, so a
   * tap (or Enter / Space) on a tile speedruns like the single-player map:
   * it chooses AND creates the room (the owner's call); the round CREATE
   * creates with the tile already chosen. The keyboard row's elements follow
   * the filter.
   */
  private mapPicker(draft: RoomDraft, host: RoomsStepHost): HTMLElement {
    const info = BATTLE_MODES[draft.mode];
    const maps = this.assetCatalogService.maps;
    const search = h('input', { class: 'chip chip-input', attrs: { type: 'search', placeholder: 'Search maps…', autocomplete: 'off', spellcheck: 'false' } });
    search.value = this.mapQuery;
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        search.blur();
      }
    });
    const stripEl = h('div', { class: 'strip strip-maps' });
    const tiles = new Map<string, HTMLElement>();
    const shown: string[] = [];
    const choose = (id: string): void => {
      draft.mapId = id;
      this.storageService.saveProfile({ mapId: id });
      for (const [tileId, el] of tiles) el.classList.toggle('is-selected', tileId === id);
      host.showBackdrop(id);
    };
    const usable = (m: { supportsCtf?: boolean }): boolean => !info.requiresFlags || m.supportsCtf !== false;
    const mapRow: KeyRow = {
      kind: 'pick',
      elements: [],
      scroller: stripEl,
      selected: () => Math.max(0, shown.indexOf(draft.mapId)),
      activate: (index) => {
        const map = maps.find((m) => m.id === shown[index]);
        if (map != null && usable(map)) {
          choose(map.id);
          this.create(host);
        }
      },
    };
    const paint = (): void => {
      clear(stripEl);
      tiles.clear();
      shown.length = 0;
      const query = this.mapQuery.trim().toLowerCase();
      for (const map of maps.filter((m) => m.name.toLowerCase().includes(query))) {
        const disabled = !usable(map);
        const tile = h('div', { class: `tile tile-map ${map.id === draft.mapId ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}` });
        tile.appendChild(map.thumbnail != null ? lazyImage(map.thumbnail) : h('div', { class: 'tile-art' }));
        tile.appendChild(h('div', { class: 'tile-label', text: disabled ? `${map.name} · no flags` : map.name }));
        tappable(tile, () => {
          if (disabled) return;
          choose(map.id);
          this.create(host);
        });
        stripEl.appendChild(tile);
        tiles.set(map.id, tile);
        shown.push(map.id);
      }
      mapRow.elements = shown.map((id) => tiles.get(id)!);
      if (tiles.size === 0) {
        stripEl.appendChild(h('div', { class: 'hint', text: 'No map matches.' }));
      }
    };
    search.addEventListener('input', () => {
      this.mapQuery = search.value;
      paint();
    });
    paint();
    // Keyboard: the search chip is a row of its own (Enter puts the caret in it), the tiles the next.
    host.rows.push({ kind: 'pick', elements: [search], selected: () => 0, activate: () => search.focus() });
    this.mapRowIndex = host.rows.length;
    host.rows.push(mapRow);
    requestAnimationFrame(() => scrollStripTo(stripEl, tiles.get(draft.mapId)));
    return h(
      'div',
      { class: 'section' },
      h('div', { class: 'section-head' }, h('div', { class: 'caption', text: info.requiresFlags ? 'Map · flag maps only · tap to create' : 'Map · tap to create' }), search),
      stripEl,
    );
  }

  private closeCreate(host: RoomsStepHost): void {
    this.draft = null;
    this.view = 'list';
    host.refresh();
  }

  private create(host: RoomsStepHost): void {
    const draft = this.draft;
    if (draft == null || this.busy) return;
    const profile = this.storageService.getProfile();
    const name = draft.name.trim().slice(0, CC_ROOM_NAME_MAX) || `${profile.name}'s room`;
    this.storageService.saveProfile({ roomName: name, roomMaxPlayers: draft.maxPlayers, roomDurationMin: draft.durationMin, mode: draft.mode, mapId: draft.mapId });
    const map = this.assetCatalogService.map(draft.mapId);
    this.busy = true;
    this.joinError = null;
    host.refresh();
    online.roomSessionService
      .create({ ...draft, name }, map?.name ?? draft.mapId, this.identity(draft.mode))
      .then(() => {
        this.draft = null;
        this.view = 'lobby';
      })
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : String(error);
        this.joinError = JOIN_ERRORS[code] ?? `Could not create the room (${code})`;
        this.loggerService.warn('rooms: create failed', code);
      })
      .finally(() => {
        this.busy = false;
        host.refresh();
      });
  }

  /** `mapId` when the mode allows it, else the first map that does. */
  private usableMap(mode: BattleModeId, mapId: string): string {
    const info = BATTLE_MODES[mode];
    const maps = this.assetCatalogService.maps;
    const usable = maps.filter((m) => !info.requiresFlags || m.supportsCtf !== false);
    return usable.some((m) => m.id === mapId) ? mapId : (usable[0]?.id ?? mapId);
  }

  // --- LOBBY -----------------------------------------------------------------

  private renderLobby(body: HTMLElement, host: RoomsStepHost): StepButton {
    const session = online.roomSessionService;
    const room = session.room()!;
    const me = room.peers.find((p) => p.isLocal);
    const isHost = session.isHost;
    const teams = this.modeRuleService.isTeamMode(room.mode);

    const leave = h('div', { class: 'chip chip-btn', text: '‹ LEAVE' });
    tappable(leave, () => this.leave(host));
    host.rows.push({ kind: 'pick', elements: [leave], selected: () => 0, activate: () => this.leave(host) });
    body.appendChild(h('div', { class: 'section-head' }, h('div', { class: 'caption', text: isHost ? 'Lobby · your room' : 'Lobby · waiting for the host' }), leave));

    const connected = room.peers.length;
    body.appendChild(
      h(
        'div',
        { class: 'room is-selected is-static' },
        h(
          'div',
          { class: 'room-row' },
          h('div', { class: 'room-main' }, h('div', { class: 'room-name', text: room.name }), h('div', { class: 'room-meta', text: `${MODE_SHORT[room.mode]} · ${room.mapName}${room.durationMin > 0 ? ` · ${room.durationMin} min` : ''}` })),
          h('div', { class: 'room-side' }, room.locked ? h('span', { class: 'room-lock', text: LOCK_GLYPH }) : null, h('span', { class: 'room-count', text: `${connected}/${room.maxPlayers}` })),
        ),
      ),
    );

    const seats = h('div', { class: 'seats' });
    for (const peer of room.peers) {
      seats.appendChild(
        h(
          'div',
          { class: `seat ${peer.isLocal ? 'is-local' : ''} ${!peer.isLocal && !peer.linked ? 'is-linking' : ''}` },
          h('span', { class: 'seat-dot', style: { background: teamColor(peer.team ?? 'dm') } }),
          h('span', { class: 'seat-name', text: peer.name }),
          peer.hull.length > 0 ? h('span', { class: 'seat-loadout', text: `${peer.hull} / ${peer.turret}` }) : null,
          h('span', { class: 'menu-spacer' }),
          !peer.isLocal && !peer.linked ? h('span', { class: 'badge badge-dim', text: 'LINKING…' }) : null,
          peer.ready && !peer.isHost ? h('span', { class: 'badge badge-ready', text: 'READY' }) : null,
          peer.isHost ? h('span', { class: 'badge badge-host', text: 'HOST' }) : null,
          peer.isLocal ? h('span', { class: 'badge', text: 'YOU' }) : null,
        ),
      );
    }
    for (let i = connected; i < Math.min(room.maxPlayers, LOBBY_SEATS_SHOWN); i++) {
      seats.appendChild(h('div', { class: 'seat is-empty' }, h('span', { class: 'seat-dot' }), h('span', { class: 'seat-name', text: 'Waiting for a player…' })));
    }
    body.appendChild(h('div', { class: 'section' }, h('div', { class: 'caption', text: `Players · ${connected} of ${room.maxPlayers}` }), seats));

    if (teams) {
      const opts = h('div', { class: 'opts' });
      opts.appendChild(
        chips<TeamSide>(
          host.rows,
          'Your side',
          [
            { id: 'red', label: 'RED', cls: 'chip-red' },
            { id: 'blue', label: 'BLUE', cls: 'chip-blue' },
          ],
          me?.team ?? 'red',
          (id) => {
            if (!session.canPickTeam(id)) return;
            this.storageService.saveProfile({ team: id });
            session.setTeam(id);
          },
        ),
      );
      const sides = session.sides();
      const uneven = Math.abs(sides.red - sides.blue) > 1;
      opts.appendChild(
        h('div', {
          class: `hint ${uneven ? 'is-warn' : ''}`,
          text: `Sides: RED ${sides.red} · BLUE ${sides.blue}${uneven ? ' — uneven' : ''}. Newcomers land on the emptier side; switch freely${isHost && (this.storageService.getProfile().roomBots ?? CC_DEFAULT_ROOM_BOTS) > 0 ? ', bots fill the emptier one' : ''}.`,
        }),
      );
      body.appendChild(opts);
    }
    const linking = room.peers.filter((p) => !p.isLocal && !p.linked).length;
    const profile = this.storageService.getProfile();
    const bots = isHost ? (profile.roomBots ?? CC_DEFAULT_ROOM_BOTS) : 0;
    if (isHost) {
      const opts = h('div', { class: 'opts' });
      opts.appendChild(counter(host.rows, 'Bots', bots, 0, CC_ROOM_MAX_BOTS, (value) => this.storageService.saveProfile({ roomBots: value })));
      opts.appendChild(
        chips<BotDifficulty>(
          host.rows,
          'Bots level',
          [
            { id: 'easy', label: 'EASY' },
            { id: 'normal', label: 'NORMAL' },
            { id: 'hard', label: 'HARD' },
          ],
          profile.botDifficulty,
          (id) => this.storageService.saveProfile({ botDifficulty: id }),
        ),
      );
      body.appendChild(opts);
    }
    body.appendChild(
      h('div', {
        class: 'hint',
        text: isHost
          ? linking > 0
            ? `Linking to ${linking} player${linking > 1 ? 's' : ''}… START opens the battle for everyone seated${bots > 0 ? ` plus ${bots} bot${bots > 1 ? 's' : ''} (spread over the players' phones)` : ''}.`
            : `Players join from the rooms list. START opens the battle for everyone seated${bots > 0 ? ` plus ${bots} bot${bots > 1 ? 's' : ''} (spread over the players' phones)` : ''}.`
          : 'The host starts the battle once the room is ready.',
      }),
    );
    if (this.joinError != null) body.appendChild(h('div', { class: 'hint error', text: this.joinError }));

    if (isHost) {
      return { label: 'START', primary: true, action: () => this.start() };
    }
    const ready = session.ready;
    return {
      label: ready ? 'READY ✓' : 'READY',
      primary: !ready,
      action: () => session.setReady(!ready),
    };
  }

  private leave(host: RoomsStepHost): void {
    online.roomSessionService.leave('left');
    this.view = 'list';
    this.listings = null;
    this.joinError = null;
    host.refresh();
  }

  /** The host's START: the session announces it to every seat (the host's bots included) and emits `start`, which plays here too. */
  private start(): void {
    const session = online.roomSessionService;
    const room = session.room();
    if (room == null) return;
    const profile = this.storageService.getProfile();
    const bots = this.modeRuleService.buildBotSeats(room.mode, profile.roomBots ?? CC_DEFAULT_ROOM_BOTS, session.seatsForStart());
    const start = session.start(bots, profile.botDifficulty);
    if (start == null) this.loggerService.warn('rooms: start refused (not the host)');
  }
}

/** What a redraw would change: the rooms, their seats and states, in order. */
function listingKey(rooms: RoomListing[] | null): string {
  return rooms == null ? '' : rooms.map((r) => `${r.id}:${r.players}/${r.maxPlayers}:${r.phase}:${r.locked ? 1 : 0}:${r.host}`).join('|');
}

export default RoomsMenuService;
