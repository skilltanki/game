// The start menu, drawn for a phone in the HUD's language: dark translucent
// chips with a thin light border, the green glow for what is selected, and a
// round PLAY button in the thumb corner where FIRE sits in battle.
//
// Full screen, no dialog box. Four tabs in the bottom bar:
//   TANK  — call sign, hull, turret, paint (tiles in horizontal strips)
//   PLAY  — SINGLE PLAYER / MULTIPLAYER as two squares (single is the
//           default); a step of its own so a phone screen holds it (the
//           owner's call: squares plus the mode tiles did not fit)
//   MODE  — the modes as tiles (no Explore in multiplayer)
//   MAP   — single player: map tiles with a search chip, then bots /
//           difficulty / side
//   ROOMS — multiplayer in place of MAP: the rooms list, the create-room
//           form and the lobby (RoomsMenuService)
// The round button is NEXT on the first three tabs and PLAY on MAP (CREATE /
// START / READY on ROOMS — it stays in the thumb corner on every step, the
// owner's call), and the title chip counts the step (STEP 1/4 · GARAGE). The
// garage needs NEXT (three strips to set up), but a players square, a mode
// and a map are one choice each, so those tiles speedrun: a tap on a square
// opens MODE, a tap on a mode opens MAP / ROOMS, a tap on a map starts the
// battle (the owner's call — a tap that only highlighted the tile and waited
// for the round button read as nothing happening). Keyboard rows:
// ui/keyRows.ts; widgets: ui/widgets.ts.
import { BATTLE_MODES, type BattleModeId } from '../../../../engine/game/BattleMode';
import { CC_MAX_BOTS, CC_TELEGRAM_URL } from '../../../../config/params';
import type { BattleConfig, BotDifficulty, TeamSide } from '../../../../model/BattleConfig';
import { MULTIPLAYER_MODES, type PlaySide } from '../../../../model/Lobby';
import { clear, h, lazyImage, tappable } from '../../../../ui/dom';
import type { KeyRow } from '../../../../ui/keyRows';
import { chips, counter, nextButton, scrollStripTo, setStepChip, stepChip, strip } from '../../../../ui/widgets';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';
import type RoomsMenuService from './RoomsMenuService';
import type { StepButton } from './RoomsMenuService';
import type StorageService from '../base/StorageService';
import type AssetSourceService from '../asset/AssetSourceService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type ModeRuleService from '../mode/ModeRuleService';
import type MenuBackdropService from '../scene/MenuBackdropService';
import type GaragePreviewService from '../scene/GaragePreviewService';
import type GraphicsQualityService from '../base/GraphicsQualityService';
import type AudioSettingsService from '../base/AudioSettingsService';
import type FullscreenService from '../base/FullscreenService';
import { QUALITY_PRESETS } from '../base/GraphicsQualityService';

/** The third tab is MAP in single player and ROOMS in multiplayer (same id). */
type Tab = 'tank' | 'play' | 'mode' | 'map';

const TABS: Tab[] = ['tank', 'play', 'mode', 'map'];
/** The two squares of the PLAY tab. */
const PLAY_SIDES: { id: PlaySide; name: string; description: string; tag: string }[] = [
  { id: 'single', name: 'Single player', description: 'You against the bots, right now', tag: 'offline · no sign-up' },
  { id: 'multi', name: 'Multiplayer', description: 'Up to 8 tanks in one room', tag: 'rooms · lan & online' },
];
const TEAM_PAINT = '__team__';
/** Speaker glyphs (24 px grid, stroked): sound on with waves, off with a cross. */
const SPEAKER_ON_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const SPEAKER_OFF_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';
/** Full-screen glyphs (24 px grid, stroked): four corners pointing out to enter, in to leave. */
const EXPAND_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
const COMPRESS_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>';
const MODE_TAG: Record<BattleModeId, string> = {
  dm: 'free for all',
  tdm: 'red vs blue',
  ctf: 'teams · flags',
  assault: 'teams · flags',
  explore: 'solo · no score',
};

export class MenuService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);
  private readonly assetSourceService = inject<AssetSourceService>(TYPES.assetSourceService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);
  private readonly menuBackdropService = inject<MenuBackdropService>(TYPES.menuBackdropService);
  private readonly garagePreviewService = inject<GaragePreviewService>(TYPES.garagePreviewService);
  private readonly graphicsQualityService = inject<GraphicsQualityService>(TYPES.graphicsQualityService);
  private readonly audioSettingsService = inject<AudioSettingsService>(TYPES.audioSettingsService);
  private readonly fullscreenService = inject<FullscreenService>(TYPES.fullscreenService);
  private readonly roomsMenuService = inject<RoomsMenuService>(TYPES.roomsMenuService);
  private detachFullscreen: (() => void) | null = null;

  private tab: Tab = 'tank';
  private root: HTMLElement | null = null;
  private onPlay: ((config: BattleConfig) => void) | null = null;
  private body: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private playEl: HTMLElement | null = null;
  private tabEls = new Map<Tab, HTMLElement>();
  private mapQuery = '';
  /** Keyboard rows of the current tab, top to bottom, and where the focus is. */
  private rows: KeyRow[] = [];
  private focusRow = 0;
  private focusIndex = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /**
   * The focus outline is drawn only once the keyboard is in use: a screen
   * that opens with a white frame around its first chip reads as a glitch on
   * a phone, where nothing will ever press Enter. The first arrow key shows
   * it, a tap anywhere hides it again (the owner's call).
   */
  private keyboardFocus = false;
  /** What the round button does on the ROOMS step (set by RoomsMenuService on render). */
  private stepButton: StepButton | null = null;
  /** The multiplayer step's button in the top bar (desktop): the same action as the round one. */
  private topNextEl: HTMLElement | null = null;

  public show = (onPlay: (config: BattleConfig) => void): void => {
    this.onPlay = onPlay;
    // Every visit starts on the first tab: leaving a battle (pause -> MAIN
    // MENU, result -> CONTINUE) lands in the garage, not on the map step.
    this.tab = 'tank';
    this.roomsMenuService.reset();
    this.body = h('div', { class: 'menu-body' });
    this.titleEl = h('div', { class: 'chip chip-title' });
    this.playEl = h('div', { class: 'ctl ctl-fire menu-play', text: 'NEXT' });
    // The round button walks the tabs (NEXT) and only starts the battle on
    // the last one (PLAY / DRIVE), so a thumb cannot launch a half-configured
    // battle by habit.
    tappable(this.playEl, () => this.advance());
    // The rooms step's button again in the top bar (the owner's call: on a
    // desktop the round one is far from the pointer); render() labels it.
    this.topNextEl = stepChip(() => this.advance());
    // One listener per menu, whatever show/hide sequence led here.
    if (this.keyHandler != null) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);

    const tabs = h('div', { class: 'menu-tabs' });
    this.tabEls.clear();
    for (const tab of TABS) {
      const el = h('div', { class: 'chip chip-tab', text: this.tabLabel(tab) });
      tappable(el, () => this.go(tab));
      tabs.appendChild(el);
      this.tabEls.set(tab, el);
    }
    const root = h(
      'div',
      { class: 'menu' },
      h(
        'div',
        { class: 'menu-top' },
        h('img', { class: 'menu-logo', attrs: { src: this.assetSourceService.logoUrl, alt: 'SkillTanki' } }),
        this.titleEl,
        h('div', { class: 'menu-spacer' }),
        this.topNextEl,
        this.qualityChip(),
        this.nameChip(),
        this.soundButton(),
        this.fullscreenButton(),
      ),
      this.body,
      h(
        'div',
        { class: 'menu-bottom' },
        tabs,
        h('div', { class: 'menu-spacer' }),
        // Telegram sits above PLAY in one column, so the gap holds whatever
        // size the round button takes on this screen.
        h('div', { class: 'menu-play-stack' }, this.telegramButton(), this.playEl),
      ),
    );
    this.root = root;
    // A tap takes over from the keyboard: the outline goes until the next arrow key.
    root.addEventListener(
      'pointerdown',
      () => {
        if (!this.keyboardFocus) return;
        this.keyboardFocus = false;
        this.paintFocus();
      },
      { capture: true },
    );
    this.keyboardFocus = false;
    this.uiRootService.show('menu', root);
    this.render();
    this.showBackdrop(this.storageService.getProfile().mapId);
  };

  public hide = (): void => {
    if (this.keyHandler != null) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.rows = [];
    this.detachFullscreen?.();
    this.detachFullscreen = null;
    this.garagePreviewService.hide();
    this.menuBackdropService.hide();
    this.roomsMenuService.sleep();
    this.uiRootService.hide('menu');
    this.root = null;
    this.body = null;
    this.titleEl = null;
    this.playEl = null;
    this.topNextEl = null;
    this.tabEls.clear();
  };

  // --- the 3D backdrop ------------------------------------------------------------

  /** The map behind the menu; the vignette lifts once it is on screen. */
  private showBackdrop(mapId: string): void {
    const root = this.root;
    void this.menuBackdropService.show(mapId).then((shown) => {
      if (shown && this.root === root && root != null) {
        root.classList.add('is-scene');
      }
    });
  }

  /** The garage tank stands in the backdrop while the TANK tab is up. */
  private syncScene(): void {
    this.menuBackdropService.setOrbit(this.tab === 'tank' ? 'garage' : 'wide');
    if (this.tab === 'tank') {
      const p = this.storageService.getProfile();
      this.garagePreviewService.show({ hull: p.hull, turret: p.turret, paint: p.paint, modification: p.modification });
    } else {
      this.garagePreviewService.hide();
    }
  }

  // --- navigation ---------------------------------------------------------------

  private get multiplayer(): boolean {
    return this.storageService.getProfile().play === 'multi';
  }

  private tabLabel(tab: Tab): string {
    return tab === 'tank' ? 'TANK' : tab === 'play' ? 'PLAY' : tab === 'mode' ? 'MODE' : this.multiplayer ? 'ROOMS' : 'MAP';
  }

  private go(tab: Tab): void {
    this.tab = tab;
    this.render();
  }

  /** The round button: the next tab, or the battle (the room step's action) on the last one. */
  private advance(): void {
    const index = TABS.indexOf(this.tab);
    if (index < TABS.length - 1) {
      this.go(TABS[index + 1]);
    } else if (this.multiplayer) {
      this.stepButton?.action();
    } else {
      this.start();
    }
  }

  // --- keyboard ----------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target != null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (this.root == null || this.rows.length === 0) {
      return;
    }
    const row = this.rows[this.focusRow];
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        this.keyboardFocus = true;
        break;
      default:
        return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        if (row.kind === 'step') {
          row.step(delta);
          this.paintFocus();
          break;
        }
        if (row.elements.length === 0) break;
        this.focusIndex = Math.max(0, Math.min(row.elements.length - 1, this.focusIndex + delta));
        this.paintFocus();
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        // Inside a wrapped grid first: the tile straight above/below the focused one.
        if (row.kind === 'pick') {
          const neighbour = this.lineNeighbour(row.elements, this.focusIndex, dir);
          if (neighbour >= 0) {
            this.focusIndex = neighbour;
            this.paintFocus();
            break;
          }
        }
        const next = Math.max(0, Math.min(this.rows.length - 1, this.focusRow + dir));
        if (next !== this.focusRow) this.focusTo(next);
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (row.kind === 'pick' && row.elements.length > 0) {
          row.activate(this.focusIndex);
        }
        break;
      default:
        break;
    }
  }

  /** Index of the element on the line above (dir -1) / below (+1) nearest in x to `index`, or -1 when the row has no such line. */
  private lineNeighbour(elements: HTMLElement[], index: number, dir: -1 | 1): number {
    const self = elements[index];
    if (self == null) return -1;
    const top = self.offsetTop;
    const centre = self.offsetLeft + self.offsetWidth / 2;
    let best = -1;
    let bestLine = dir < 0 ? -Infinity : Infinity;
    let bestDx = Infinity;
    elements.forEach((el, i) => {
      const line = el.offsetTop;
      if (dir < 0 ? line >= top : line <= top) return;
      const dx = Math.abs(el.offsetLeft + el.offsetWidth / 2 - centre);
      // The nearest line first, then the nearest column on it.
      if ((dir < 0 ? line > bestLine : line < bestLine) || (line === bestLine && dx < bestDx)) {
        bestLine = line;
        bestDx = dx;
        best = i;
      }
    });
    return best;
  }

  /** The round button as the last keyboard row of a tab. */
  private pushButtonRow(): void {
    const button = this.playEl;
    if (button == null) return;
    this.rows.push({ kind: 'pick', elements: [button], selected: () => 0, activate: () => this.advance() });
  }

  /** Focus a row on its current choice. */
  private focusTo(rowIndex: number): void {
    this.focusRow = rowIndex;
    const row = this.rows[rowIndex];
    this.focusIndex = row == null || row.kind === 'step' ? 0 : Math.max(0, row.selected());
    this.paintFocus();
  }

  private paintFocus(): void {
    for (const el of this.root?.querySelectorAll('.is-focus') ?? []) el.classList.remove('is-focus');
    if (!this.keyboardFocus) return;
    const row = this.rows[this.focusRow];
    if (row == null) return;
    if (row.kind === 'step') {
      row.element.classList.add('is-focus');
      row.element.scrollIntoView({ block: 'nearest' });
      return;
    }
    const el = row.elements[this.focusIndex];
    if (el == null) return;
    el.classList.add('is-focus');
    if (row.scroller != null) scrollStripTo(row.scroller, el);
    el.scrollIntoView({ block: 'nearest' });
  }

  private render(): void {
    if (this.body == null) return;
    for (const [id, el] of this.tabEls) {
      el.classList.toggle('is-selected', id === this.tab);
      el.textContent = this.tabLabel(id);
    }
    const profile = this.storageService.getProfile();
    const mode = BATTLE_MODES[profile.mode];
    const multi = this.multiplayer;
    clear(this.body);
    this.rows = [];
    this.stepButton = null;
    // The rooms list polls the lobby only while it is the screen on view.
    if (!(this.tab === 'map' && multi)) this.roomsMenuService.sleep();
    switch (this.tab) {
      case 'tank':
        this.renderTank(this.body);
        break;
      case 'play':
        this.renderPlay(this.body);
        break;
      case 'mode':
        this.renderMode(this.body);
        break;
      case 'map':
        if (multi) {
          this.renderRooms(this.body);
        } else {
          this.renderMap(this.body);
        }
        break;
    }
    if (this.titleEl != null) {
      const step = TABS.indexOf(this.tab) + 1;
      const name =
        this.tab === 'tank' ? 'GARAGE' : this.tab === 'play' ? 'PLAYERS' : this.tab === 'mode' ? 'GAME MODE' : multi ? this.roomsMenuService.title() : mode.requiresFlags ? 'MAP · FLAG MAPS' : 'MAP';
      this.titleEl.replaceChildren(h('span', { class: 'chip-dim', text: `STEP ${step}/${TABS.length}` }), h('span', { text: name }));
    }
    if (this.playEl != null) {
      const last = this.tab === TABS[TABS.length - 1];
      // Through a method: the switch above set the field from renderRooms(),
      // which control flow cannot see past the `= null` before it.
      const button = last && multi ? this.roomsButton() : null;
      this.playEl.textContent = button != null ? button.label : !last ? 'NEXT' : mode.id === 'explore' ? 'DRIVE' : 'PLAY';
      this.playEl.classList.toggle('is-next', button != null ? !button.primary : !last);
      if (this.topNextEl != null) setStepChip(this.topNextEl, button != null && !button.inBody ? button : null);
    }
    this.pushButtonRow();
    this.body.scrollTop = 0;
    // A step may ask the arrows to start on a particular row (the room's map page: its tiles).
    const startRow = this.tab === 'map' && multi ? (this.roomsButton()?.focusRow ?? 0) : 0;
    this.focusTo(Math.min(startRow, Math.max(0, this.rows.length - 1)));
    this.syncScene();
  }

  // --- tabs --------------------------------------------------------------------

  private renderTank(body: HTMLElement): void {
    const profile = this.storageService.getProfile();
    body.appendChild(
      strip(this.rows, 'Hull', this.assetCatalogService.hulls.map((x) => ({ id: x.id, label: x.id, image: x.thumbnail })), profile.hull, (id) => {
        this.storageService.saveProfile({ hull: id });
        this.syncScene();
      }),
    );
    body.appendChild(
      strip(this.rows, 'Turret', this.assetCatalogService.turrets.map((x) => ({ id: x.id, label: x.id, image: x.thumbnail })), profile.turret, (id) => {
        this.storageService.saveProfile({ turret: id });
        this.syncScene();
      }),
    );
    const paints = this.assetCatalogService.paints;
    if (paints.length > 0) {
      body.appendChild(
        strip(
          this.rows,
          'Paint',
          [{ id: TEAM_PAINT, label: 'Team' }, ...paints.map((p) => ({ id: p.id, label: p.id, image: p.preview }))],
          profile.paint ?? TEAM_PAINT,
          (id) => {
            this.storageService.saveProfile({ paint: id === TEAM_PAINT ? undefined : id });
            this.syncScene();
          },
          'tile-paint',
        ),
      );
    }
    // A second NEXT in the pause menu's rectangular chip style, under the last
    // strip at the left edge (the owner's call): the garage is the one step with
    // nothing to tap through, and the round button sits a thumb's reach away
    // on a desktop. Desktop widths only (theme.css); the round NEXT stays.
    nextButton(this.rows, body, () => this.go(TABS[1]));
  }

  /** SINGLE PLAYER / MULTIPLAYER: two squares, single by default. One choice is the whole step: pick and move on to the modes. */
  private renderPlay(body: HTMLElement): void {
    const play: PlaySide = this.storageService.getProfile().play ?? 'single';
    const sides = h('div', { class: 'strip strip-modes strip-play' });
    const sideTiles: HTMLElement[] = [];
    const pickSide = (id: PlaySide): void => {
      const current = this.storageService.getProfile();
      const patch: Partial<typeof current> = { play: id };
      if (id === 'multi' && !MULTIPLAYER_MODES.includes(current.mode)) patch.mode = 'dm';
      this.storageService.saveProfile(patch);
      this.roomsMenuService.reset();
      this.go('mode');
    };
    for (const side of PLAY_SIDES) {
      const tile = h(
        'div',
        { class: `tile tile-mode tile-play ${play === side.id ? 'is-selected' : ''}` },
        h('div', { class: 'tile-name', text: side.name }),
        h('div', { class: 'tile-desc', text: side.description }),
        h('div', { class: 'tile-tag', text: side.tag }),
      );
      tappable(tile, () => pickSide(side.id));
      sides.appendChild(tile);
      sideTiles.push(tile);
    }
    this.rows.push({
      kind: 'pick',
      elements: sideTiles,
      selected: () => Math.max(0, PLAY_SIDES.findIndex((s) => s.id === (this.storageService.getProfile().play ?? 'single'))),
      activate: (index) => pickSide(PLAY_SIDES[index].id),
    });
    body.appendChild(h('div', { class: 'section' }, h('div', { class: 'caption', text: 'Players · opens the modes' }), sides));
  }

  private renderMode(body: HTMLElement): void {
    const profile = this.storageService.getProfile();
    const play: PlaySide = profile.play ?? 'single';
    const modes = h('div', { class: 'strip strip-modes' });
    const tiles = new Map<BattleModeId, HTMLElement>();
    // Explore is a solo drive: not a room.
    const ids = (Object.keys(BATTLE_MODES) as BattleModeId[]).filter((id) => play === 'single' || MULTIPLAYER_MODES.includes(id));
    for (const id of ids) {
      const mode = BATTLE_MODES[id];
      const tile = h(
        'div',
        { class: `tile tile-mode ${profile.mode === mode.id ? 'is-selected' : ''}` },
        h('div', { class: 'tile-name', text: mode.name }),
        h('div', { class: 'tile-desc', text: mode.description }),
        h('div', { class: 'tile-tag', text: MODE_TAG[mode.id] }),
      );
      // One choice is the whole step: pick and move on to the map / rooms.
      tappable(tile, () => {
        this.storageService.saveProfile({ mode: mode.id });
        for (const [tileId, el] of tiles) el.classList.toggle('is-selected', tileId === mode.id);
        this.go('map');
      });
      modes.appendChild(tile);
      tiles.set(mode.id, tile);
    }
    this.rows.push({
      kind: 'pick',
      elements: ids.map((id) => tiles.get(id)!),
      selected: () => Math.max(0, ids.indexOf(this.storageService.getProfile().mode)),
      // Enter on a mode is the tap: choose and open the next step.
      activate: (index) => {
        this.storageService.saveProfile({ mode: ids[index] });
        this.go('map');
      },
    });
    body.appendChild(h('div', { class: 'section' }, h('div', { class: 'caption', text: play === 'multi' ? 'Pick a mode · opens the rooms' : 'Pick a mode · opens the map step' }), modes));
  }

  private roomsButton(): StepButton | null {
    return this.stepButton;
  }

  /** The multiplayer third step: RoomsMenuService draws it and names the round button. */
  private renderRooms(body: HTMLElement): void {
    this.stepButton = this.roomsMenuService.render(body, {
      rows: this.rows,
      refresh: () => this.render(),
      showBackdrop: (mapId) => this.showBackdrop(mapId),
      play: (config) => this.onPlay?.(config),
    });
  }

  private renderMap(body: HTMLElement): void {
    const profile = this.storageService.getProfile();
    const mode = BATTLE_MODES[profile.mode];
    const maps = this.assetCatalogService.maps;
    const usable = maps.filter((m) => !mode.requiresFlags || m.supportsCtf !== false);
    let selected = usable.some((m) => m.id === profile.mapId) ? profile.mapId : (usable[0]?.id ?? profile.mapId);
    this.storageService.saveProfile({ mapId: selected });
    this.showBackdrop(selected);

    const search = h('input', { class: 'chip chip-input', attrs: { type: 'search', placeholder: 'Search…', autocomplete: 'off' } });
    search.value = this.mapQuery;
    const strip = h('div', { class: 'strip strip-maps' });
    const tiles = new Map<string, HTMLElement>();
    const shown: string[] = [];
    const choose = (id: string): void => {
      selected = id;
      this.storageService.saveProfile({ mapId: id });
      for (const [tileId, el] of tiles) el.classList.toggle('is-selected', tileId === id);
      this.showBackdrop(id);
    };
    const mapRow: KeyRow = {
      kind: 'pick',
      elements: [],
      scroller: strip,
      selected: () => Math.max(0, shown.indexOf(selected)),
      // Enter on a map is the tap: choose and play (a no-flag map in a flag mode does nothing).
      activate: (index) => {
        const map = maps.find((m) => m.id === shown[index]);
        if (map == null || (mode.requiresFlags && map.supportsCtf === false)) return;
        choose(map.id);
        this.start();
      },
    };
    this.rows.push(mapRow);
    const paint = (): void => {
      clear(strip);
      tiles.clear();
      shown.length = 0;
      const query = this.mapQuery.trim().toLowerCase();
      for (const map of maps.filter((m) => m.name.toLowerCase().includes(query))) {
        const disabled = mode.requiresFlags && map.supportsCtf === false;
        const tile = h('div', { class: `tile tile-map ${map.id === selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}` });
        tile.appendChild(map.thumbnail != null ? lazyImage(map.thumbnail) : h('div', { class: 'tile-art' }));
        tile.appendChild(h('div', { class: 'tile-label', text: disabled ? `${map.name} · no flags` : map.name }));
        // The map is the last choice: a tap on a playable one starts the battle
        // with the bots / difficulty / side below as they stand.
        tappable(tile, () => {
          if (disabled) return;
          choose(map.id);
          this.start();
        });
        strip.appendChild(tile);
        tiles.set(map.id, tile);
        shown.push(map.id);
      }
      mapRow.elements = shown.map((id) => tiles.get(id)!);
      if (tiles.size === 0) {
        strip.appendChild(h('div', { class: 'hint', text: 'No map matches.' }));
      }
    };
    search.addEventListener('input', () => {
      this.mapQuery = search.value;
      paint();
    });
    paint();
    body.appendChild(
      h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('div', { class: 'caption', text: mode.requiresFlags ? 'Map · flag maps only · tap to play' : 'Map · tap to play' }), search), strip),
    );
    requestAnimationFrame(() => scrollStripTo(strip, tiles.get(selected)));

    if (mode.id === 'explore') {
      // The garage's rectangular button again (desktop only): the last step's action, under the strip.
      nextButton(this.rows, body, () => this.start(), 'DRIVE');
      return;
    }
    const opts = h('div', { class: 'opts' });
    opts.appendChild(counter(this.rows, 'Bots', profile.bots, 0, CC_MAX_BOTS, (value) => this.storageService.saveProfile({ bots: value })));
    opts.appendChild(
      chips<BotDifficulty>(
        this.rows,
        'Difficulty',
        [
          { id: 'easy', label: 'EASY' },
          { id: 'normal', label: 'NORMAL' },
          { id: 'hard', label: 'HARD' },
        ],
        profile.botDifficulty,
        (id) => this.storageService.saveProfile({ botDifficulty: id }),
      ),
    );
    if (mode.teams) {
      opts.appendChild(
        chips<TeamSide>(
          this.rows,
          'Your side',
          [
            { id: 'red', label: 'RED', cls: 'chip-red' },
            { id: 'blue', label: 'BLUE', cls: 'chip-blue' },
          ],
          profile.team,
          (id) => this.storageService.saveProfile({ team: id }),
        ),
      );
    }
    body.appendChild(opts);
    // The garage's rectangular button again (desktop only), under the options: PLAY with the map as selected.
    nextButton(this.rows, body, () => this.start(), 'PLAY');
  }

  private start(): void {
    const profile = this.storageService.getProfile();
    const config: BattleConfig = {
      mode: profile.mode,
      mapId: profile.mapId,
      playerName: profile.name.trim() || 'Player',
      loadout: { hull: profile.hull, turret: profile.turret, paint: profile.paint, modification: profile.modification },
      team: profile.team,
      bots: this.modeRuleService.info(profile.mode).bots ? profile.bots : 0,
      botDifficulty: profile.botDifficulty,
    };
    this.onPlay?.(config);
  }

  // --- widgets ------------------------------------------------------------------

  /** Icon-only link to the Telegram channel, pinned above PLAY at the right edge. */
  private telegramButton(): HTMLElement {
    const link = h('a', {
      class: 'menu-telegram',
      attrs: { href: CC_TELEGRAM_URL, target: '_blank', rel: 'noopener', title: 'Telegram', 'aria-label': 'Telegram' },
      html:
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M21.9 3.4 2.9 10.7c-1 .4-1 1.9.1 2.2l4.7 1.5 1.8 5.6c.3.9 1.4 1.1 2 .4l2.6-2.6 4.8 3.5c.8.6 1.9.1 2.1-.9l3-15.3c.2-1.1-.8-2-1.9-1.6ZM9.7 13.9l8.1-5.5c.4-.2.7.3.4.6l-6.7 6.2-.3 3-1.5-4.3Z" fill="currentColor"/></svg>',
    });
    return link;
  }

  /**
   * Graphics preset in the top bar, left of the call sign: a tap cycles
   * HIGH -> MEDIUM -> LOW (resolution now, dust from the next battle,
   * multisampling from the next launch).
   */
  private qualityChip(): HTMLElement {
    const chip = h('div', { class: 'chip chip-btn chip-quality' });
    const paint = (): void => {
      chip.replaceChildren(h('span', { class: 'chip-dim', text: 'GRAPHICS' }), h('span', { text: this.graphicsQualityService.preset.toUpperCase() }));
    };
    tappable(chip, () => {
      const index = QUALITY_PRESETS.indexOf(this.graphicsQualityService.preset);
      this.graphicsQualityService.apply(QUALITY_PRESETS[(index + 1) % QUALITY_PRESETS.length]);
      paint();
    });
    paint();
    return chip;
  }

  /** Speaker icon in the far right corner: a tap mutes / unmutes every sound. */
  private soundButton(): HTMLElement {
    const button = h('div', { class: 'chip chip-btn menu-sound', attrs: { role: 'button', 'aria-label': 'Sound' } });
    const paint = (): void => {
      const muted = this.audioSettingsService.muted;
      button.classList.toggle('is-muted', muted);
      button.setAttribute('aria-pressed', String(muted));
      button.innerHTML = muted ? SPEAKER_OFF_SVG : SPEAKER_ON_SVG;
    };
    tappable(button, () => {
      this.audioSettingsService.toggle();
      paint();
    });
    paint();
    return button;
  }

  /** Full-screen toggle right of the speaker; absent where the API is (iPhone Safari). The icon follows the real state. */
  private fullscreenButton(): HTMLElement {
    const button = h('div', { class: 'chip chip-btn menu-sound menu-fullscreen', attrs: { role: 'button', 'aria-label': 'Full screen' } });
    if (!this.fullscreenService.supported) {
      button.hidden = true;
      return button;
    }
    const paint = (): void => {
      const active = this.fullscreenService.active;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.innerHTML = active ? COMPRESS_SVG : EXPAND_SVG;
    };
    // Inside the tap handler, or the browser refuses the request.
    tappable(button, () => void this.fullscreenService.toggle().then(paint));
    this.detachFullscreen?.();
    this.detachFullscreen = this.fullscreenService.onChange(paint);
    paint();
    return button;
  }

  /** Call sign chip; a tap turns it into an input, blur/enter saves. */
  private nameChip(): HTMLElement {
    const chip = h('div', { class: 'chip chip-name' });
    const paint = (): void => {
      const name = this.storageService.getProfile().name;
      chip.replaceChildren(h('span', { class: 'chip-dim', text: 'CALL SIGN' }), h('span', { text: name }), h('span', { class: 'chip-dim', text: '✎' }));
    };
    const edit = (): void => {
      const input = h('input', { class: 'chip chip-input chip-name-input', attrs: { type: 'text', maxlength: '20', autocomplete: 'off', spellcheck: 'false' } });
      input.value = this.storageService.getProfile().name;
      const done = (): void => {
        this.storageService.saveProfile({ name: input.value.trim().slice(0, 20) || 'Player' });
        input.replaceWith(chip);
        paint();
      };
      input.addEventListener('blur', done);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      chip.replaceWith(input);
      input.focus();
      input.select();
    };
    tappable(chip, edit);
    paint();
    return chip;
  }
}

export default MenuService;
