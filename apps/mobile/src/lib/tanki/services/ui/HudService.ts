// The in-battle HUD: score line and clock, kill log, the player's health and
// reload bars, the supplies row (tap), the effect countdown chips, the death
// and overturn notices, the pause and score-table buttons. Everything is
// driven by battle events plus one `frame()` call per rendered frame.
import { assetUrl } from '../../../../engine/tank/TankAssets';
import type { Supplies } from '../../../../engine/game/Supplies';
import { SUPPLY_KINDS, type SupplyKind } from '../../../../model/TankCommand';
import { esc, h, tappable, teamColor } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';
import type TouchInputService from '../control/TouchInputService';
import type TouchControlsService from './TouchControlsService';
import type BattleEventService from '../battle/BattleEventService';
import type BattleStateService from '../battle/BattleStateService';
import type ScoreService from '../battle/ScoreService';
import type ModeRuleService from '../mode/ModeRuleService';
import type GameFacadeService from '../public/GameFacadeService';

export interface HudFrame {
  health: number;
  maxHealth: number;
  dead: boolean;
  reload: number;
  supplies: Supplies;
  suicideProgress: number;
  overturned: boolean;
  shaftAim: number;
  /** Screen point (CSS px) above the player's tank; null when off screen or dead. */
  overhead: { x: number; y: number } | null;
  /** Repair kit used recently: ms the icon still shows (0 = hidden). */
  healShownMsLeft: number;
}

const EFFECT_ICON_BASE = '/embedded/battlefieldmodel/bitmaps/EffectIndicator_icon';
const SUPPLY_ICON: Record<SupplyKind, string> = {
  health: `${EFFECT_ICON_BASE}HealthCls.png`,
  armor: `${EFFECT_ICON_BASE}ArmorCls.png`,
  damage: `${EFFECT_ICON_BASE}PowerCls.png`,
  nitro: `${EFFECT_ICON_BASE}NitroCls.png`,
  nuclear: `${EFFECT_ICON_BASE}RadiationYellowCls.png`,
};

/** Overhead chip smoothing (see placeOverhead). */
const OVERHEAD_SMOOTH_MS = 80;
const OVERHEAD_SNAP_PX = 120;
const OVERHEAD_MIN_MOVE_PX = 0.3;

interface SupplyCell {
  cell: HTMLElement;
  shade: HTMLElement;
  cd: HTMLElement;
}

export class HudService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);
  private readonly touchControlsService = inject<TouchControlsService>(TYPES.touchControlsService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);
  private readonly gameFacadeService = inject<GameFacadeService>(TYPES.gameFacadeService);

  private scoreEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private deathEl: HTMLElement | null = null;
  private warningEl: HTMLElement | null = null;
  private hpFill: HTMLElement | null = null;
  private hpLabel: HTMLElement | null = null;
  private reloadFill: HTMLElement | null = null;
  private tableEl: HTMLElement | null = null;
  private readonly supplyCells = new Map<SupplyKind, SupplyCell>();
  private readonly effectChips = new Map<SupplyKind, { chip: HTMLElement; label: HTMLElement }>();
  /** Active supply effects with their seconds left, floating over the tank. */
  private overheadEl: HTMLElement | null = null;
  /** Smoothed screen anchor of the overhead chips (null = not placed yet). */
  private overheadPos: { x: number; y: number } | null = null;
  private lastFrameAt = 0;
  private readonly subscriptions: (() => void)[] = [];
  private lastRespawnIn = -1;

  public show = (): void => {
    this.hide();
    const mode = this.battleStateService.config.mode;
    const teams = this.modeRuleService.isTeamMode(mode);

    this.scoreEl = h('div', { class: 'hud-score' });
    this.timerEl = h('div', { class: 'hud-timer', text: '10:00' });
    this.logEl = h('div', { class: 'hud-log' });
    this.deathEl = h('div', { class: 'hud-death', text: 'DESTROYED', style: { display: 'none' } });
    this.warningEl = h('div', { class: 'hud-warning', style: { display: 'none' } });
    this.hpFill = h('div', { class: 'fill' });
    this.hpLabel = h('div', { class: 'label' });
    this.reloadFill = h('div', { class: 'fill' });
    this.tableEl = h('div', { class: 'hud-table', style: { display: 'none' } });

    // Active effects ride above the tank (the engine's 3D plate is hidden
    // for the local tank), each with its seconds left.
    this.overheadEl = h('div', { class: 'hud-overhead', style: { display: 'none' } });
    for (const kind of SUPPLY_KINDS) {
      const label = h('span');
      const chip = h('div', { class: 'chip' }, h('i', { style: { backgroundImage: `url("${assetUrl(SUPPLY_ICON[kind])}")` } }), label);
      this.overheadEl.appendChild(chip);
      this.effectChips.set(kind, { chip, label });
    }

    const supplies = h('div', { class: 'hud-supplies' });
    SUPPLY_KINDS.forEach((kind, index) => {
      const shade = h('div', { class: 'shade' });
      const cd = h('div', { class: 'cd' });
      const cell = h(
        'div',
        { class: 'supply tap', attrs: { 'data-kind': kind, title: `${kind} (${index + 1})` } },
        h('img', { attrs: { src: assetUrl(SUPPLY_ICON[kind]), alt: kind } }),
        shade,
        cd,
      );
      tappable(cell, () => this.touchInputService.requestSupply(kind));
      supplies.appendChild(cell);
      this.supplyCells.set(kind, { cell, shade, cd });
    });

    const pauseBtn = h('div', { class: 'icon-btn tap', text: '❚❚', attrs: { title: 'Pause' } });
    tappable(pauseBtn, () => this.gameFacadeService.pause());
    const tableBtn = h('div', { class: 'icon-btn tap', text: '☰', attrs: { title: 'Score (hold Tab)' } });
    tappable(tableBtn, () => this.setTableVisible(!this.tableVisible));
    // Desktop: the table shows while Tab is HELD, as in the original client.
    // preventDefault keeps the browser from moving focus around the page.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      if (!e.repeat) this.setTableVisible(true);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      this.setTableVisible(false);
    };
    const onBlur = (): void => this.setTableVisible(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.subscriptions.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    const hud = h(
      'div',
      { class: 'hud' },
      h('div', { class: 'hud-topleft' }, tableBtn),
      h('div', { class: 'hud-topright' }, pauseBtn),
      this.scoreEl,
      this.timerEl,
      this.logEl,
      h('div', { class: 'hud-center' }, this.deathEl, this.warningEl),
      this.tableEl,
      this.overheadEl,
      supplies,
      h('div', { class: 'hud-status' }, h('div', { class: 'bar hp' }, this.hpFill, this.hpLabel), h('div', { class: 'bar reload' }, this.reloadFill)),
    );
    this.uiRootService.show('hud', hud);
    // Explore has no score and no clock, but the supplies stay: a free drive
    // is where nitro and the rest are tried out (the owner's call).
    if (mode === 'explore') {
      this.scoreEl.style.display = 'none';
      this.timerEl.style.display = 'none';
    }

    // --- events ------------------------------------------------------------
    const events = this.battleEventService;
    this.subscriptions.push(
      events.on('teamScore', ({ red, blue }) => this.renderScore(teams, red, blue)),
      events.on('death', (e) => {
        this.renderScore(teams, this.scoreService.teamScore.red, this.scoreService.teamScore.blue);
        this.log(this.describeDeath(e));
      }),
      events.on('flag', (e) => {
        const flag = `<span style="color:${teamColor(e.flag)}">${e.flag} flag</span>`;
        const who = e.byName != null ? `<span style="color:${teamColor(e.byTeam ?? 'dm')}">${esc(e.byName)}</span>` : '';
        const verb = { taken: 'took the', dropped: 'dropped the', returned: 'returned the', delivered: 'captured the' }[e.kind];
        this.log(who !== '' ? `${who} <span class="dim">${verb}</span> ${flag}` : `${flag} <span class="dim">returned to base</span>`);
      }),
      events.on('clock', ({ msLeft }) => this.renderClock(msLeft)),
      events.on('localDeath', ({ respawnInMs, deadMs }) => {
        const seconds = Math.ceil(respawnInMs / 1000);
        if (deadMs > 0 && seconds !== this.lastRespawnIn && this.deathEl != null) {
          this.lastRespawnIn = seconds;
          this.deathEl.textContent = seconds > 0 ? `DESTROYED · ${seconds}` : 'DESTROYED';
        }
      }),
    );
    this.renderScore(teams, 0, 0);
  };

  public hide = (): void => {
    for (const off of this.subscriptions) off();
    this.subscriptions.length = 0;
    this.supplyCells.clear();
    this.effectChips.clear();
    this.uiRootService.hide('hud');
    this.scoreEl = this.timerEl = this.logEl = this.deathEl = this.warningEl = null;
    this.hpFill = this.hpLabel = this.reloadFill = this.tableEl = this.overheadEl = null;
    this.overheadPos = null;
    this.lastFrameAt = 0;
  };

  /** Once per rendered frame, from the battle loop. */
  public frame = (data: HudFrame): void => {
    if (this.hpFill == null || this.hpLabel == null || this.reloadFill == null) {
      return;
    }
    const hp = data.maxHealth > 0 ? Math.max(0, data.health / data.maxHealth) : 0;
    this.hpFill.style.width = `${(hp * 100).toFixed(1)}%`;
    this.hpLabel.textContent = `${Math.max(0, Math.round(data.health))} / ${Math.round(data.maxHealth)}`;
    const reload = Math.max(0, Math.min(1, data.reload));
    this.reloadFill.style.width = `${(reload * 100).toFixed(0)}%`;
    this.reloadFill.style.filter = reload >= 1 ? 'none' : 'grayscale(0.4) brightness(0.9)';
    if (this.deathEl != null) {
      this.deathEl.style.display = data.dead ? 'block' : 'none';
      if (!data.dead) this.lastRespawnIn = -1;
    }
    let anyEffect = false;
    for (const kind of SUPPLY_KINDS) {
      const state = data.supplies.getState(kind);
      const cell = this.supplyCells.get(kind);
      if (cell != null) {
        cell.shade.style.height = `${Math.round(state.cooldownFraction * 100)}%`;
        cell.cell.classList.toggle('is-active', state.active);
        cell.cell.classList.toggle('is-cooling', state.cooldownMsLeft > 0);
        if (state.cooldownMsLeft > 0) cell.cd.textContent = String(Math.ceil(state.cooldownMsLeft / 1000));
      }
      const chip = this.effectChips.get(kind);
      if (chip != null) {
        // The repair kit heals instantly; its chip counts the display window.
        const msLeft = kind === 'health' ? data.healShownMsLeft : state.effectMsLeft;
        const on = msLeft > 0;
        anyEffect ||= on;
        chip.chip.classList.toggle('is-on', on);
        if (on) chip.label.textContent = `${Math.ceil(msLeft / 1000)}s`;
      }
    }
    if (this.overheadEl != null) {
      const show = anyEffect && data.overhead != null && !data.dead;
      this.overheadEl.style.display = show ? 'flex' : 'none';
      if (show && data.overhead != null) {
        this.placeOverhead(data.overhead.x, data.overhead.y);
      } else {
        this.overheadPos = null;
      }
    }
    this.touchControlsService.setSuicideProgress(data.suicideProgress);
    if (this.warningEl != null) {
      let warning: string | null = null;
      if (data.suicideProgress > 0) {
        warning = `Self-destruct in ${((1 - data.suicideProgress) * 5).toFixed(1)}s — release to cancel`;
      } else if (data.overturned) {
        warning = 'Tank overturned — flipping back';
      }
      this.warningEl.style.display = warning == null ? 'none' : 'block';
      if (warning != null) this.warningEl.textContent = warning;
    }
  };

  // --- internals ----------------------------------------------------------------

  /**
   * The raw anchor follows every suspension bounce of the hull, which reads as
   * twitching text. A short low-pass filter (time constant OVERHEAD_SMOOTH_MS)
   * keeps the chips gliding, a big jump (respawn) snaps, and the transform is
   * only rewritten when the chips actually move by a fraction of a pixel.
   */
  private placeOverhead(targetX: number, targetY: number): void {
    const now = performance.now();
    const dt = this.lastFrameAt > 0 ? Math.min(100, now - this.lastFrameAt) : 16;
    this.lastFrameAt = now;
    const previous = this.overheadPos;
    let x = targetX;
    let y = targetY;
    if (previous != null && Math.hypot(targetX - previous.x, targetY - previous.y) < OVERHEAD_SNAP_PX) {
      const k = 1 - Math.exp(-dt / OVERHEAD_SMOOTH_MS);
      x = previous.x + (targetX - previous.x) * k;
      y = previous.y + (targetY - previous.y) * k;
      if (Math.abs(x - previous.x) < OVERHEAD_MIN_MOVE_PX && Math.abs(y - previous.y) < OVERHEAD_MIN_MOVE_PX) {
        return;
      }
    }
    this.overheadPos = { x, y };
    this.overheadEl!.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  private renderScore(teams: boolean, red: number, blue: number): void {
    if (this.scoreEl == null) return;
    if (teams) {
      this.scoreEl.innerHTML = `<span style="color:${teamColor('red')}">RED ${red}</span><span class="dim"> : </span><span style="color:${teamColor('blue')}">${blue} BLUE</span>`;
      return;
    }
    const own = this.battleStateService.hasLocal ? this.scoreService.fragsOf(this.battleStateService.local.gameTank) : 0;
    const best = this.scoreService.leaderFrags();
    const tail = own >= best || best <= 0 ? '<span style="color:#9c9">LEADING</span>' : `<span class="dim">BEST</span> ${best}`;
    this.scoreEl.innerHTML = `<span class="dim">YOU</span> ${own}<span class="dim"> · </span>${tail}`;
  }

  private renderClock(msLeft: number | null): void {
    if (this.timerEl == null) return;
    if (msLeft == null) {
      this.timerEl.style.display = 'none';
      return;
    }
    const total = Math.ceil(Math.max(0, msLeft) / 1000);
    this.timerEl.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    this.timerEl.classList.toggle('is-urgent', msLeft <= 60000);
  }

  private describeDeath(e: { victimName: string; victimTeam: string; killerName: string | null; killerTeam: string | null; cause: string }): string {
    const v = `<span style="color:${teamColor(e.victimTeam)}">${esc(e.victimName)}</span>`;
    const k = e.killerName != null ? `<span style="color:${teamColor(e.killerTeam ?? 'dm')}">${esc(e.killerName)}</span>` : null;
    if (e.cause === 'selfDestruct') {
      return k != null ? `${v} <span class="dim">self-destructed (kill for</span> ${k}<span class="dim">)</span>` : `${v} <span class="dim">self-destructed</span>`;
    }
    if (k == null) {
      return `${v} <span class="dim">${e.cause === 'drown' ? 'drowned' : 'died'}</span>`;
    }
    const verb = e.cause === 'drown' ? 'drowned' : e.cause === 'blast' ? 'blew up' : 'destroyed';
    return `${k} <span class="dim">${verb}</span> ${v}`;
  }

  private log(html: string): void {
    if (this.logEl == null) return;
    const entry = h('div', { html });
    this.logEl.appendChild(entry);
    while (this.logEl.children.length > 5) {
      this.logEl.removeChild(this.logEl.firstChild!);
    }
    setTimeout(() => {
      entry.style.opacity = '0';
      setTimeout(() => entry.remove(), 650);
    }, 4000);
  }

  private get tableVisible(): boolean {
    return this.tableEl != null && this.tableEl.style.display !== 'none';
  }

  /** The score table: rebuilt from the live standings every time it opens. */
  private setTableVisible(visible: boolean): void {
    if (this.tableEl == null) return;
    if (!visible) {
      this.tableEl.style.display = 'none';
      return;
    }
    if (this.tableVisible) return;
    const rows = [...this.scoreService.rows()].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
    this.tableEl.innerHTML =
      '<table><tr><th>Player</th><th>Tank</th><th class="num">Kills</th><th class="num">Deaths</th></tr>' +
      rows
        .map(
          (r) =>
            `<tr class="${r.isLocal ? 'is-local' : ''}"><td style="color:${teamColor(r.team)};font-weight:bold">${esc(r.name)}</td>` +
            `<td style="color:#bbb">${esc(r.hull)} / ${esc(r.turret)}</td><td class="num">${r.frags}</td><td class="num" style="color:#f88">${r.deaths}</td></tr>`,
        )
        .join('') +
      '</table>';
    this.tableEl.style.display = 'block';
  }
}

export default HudService;
