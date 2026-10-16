// The battle-over modal: your place (deathmatch) or VICTORY / DEFEAT (team
// modes) with the standings. CONTINUE is where the interstitial goes; Enter
// or Space presses it (the keyboard and the gamepad).
import { CC_AD_PLACEMENTS } from '../../../../config/params';
import { esc, h, ordinal, tappable, teamColor } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';
import type AdService from '../base/AdService';
import type BattleStateService from '../battle/BattleStateService';
import type ScoreService from '../battle/ScoreService';
import type ModeRuleService from '../mode/ModeRuleService';

export class ResultScreenService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly adService = inject<AdService>(TYPES.adService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  public show = (onContinue: () => void): void => {
    const config = this.battleStateService.config;
    const teams = this.modeRuleService.isTeamMode(config.mode);
    const rows = [...this.scoreService.rows()].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
    const panel = h('div', { class: 'panel', style: { width: 'min(460px, 92vw)', gap: '10px' } });
    panel.appendChild(h('div', { class: 'result-sub', text: 'Battle over' }));

    if (teams) {
      const mine = config.team;
      const own = this.scoreService.teamScore[mine];
      const other = this.scoreService.teamScore[this.modeRuleService.enemyOf(mine)];
      const outcome = own > other ? 'VICTORY' : own < other ? 'DEFEAT' : 'DRAW';
      const colour = own > other ? '#9ad755' : own < other ? '#ff7a5a' : '#e8e8e8';
      panel.appendChild(h('div', { class: 'result-heading', text: outcome, style: { color: colour } }));
      const score = h('div', { class: 'result-score' });
      for (const side of ['red', 'blue'] as const) {
        if (side === 'blue') score.appendChild(h('span', { text: ':', style: { color: '#666' } }));
        score.appendChild(
          h('div', {
            class: `side ${side === mine ? 'is-mine' : ''}`,
            text: String(this.scoreService.teamScore[side]),
            style: { color: teamColor(side) },
          }),
        );
      }
      panel.appendChild(score);
      panel.appendChild(h('div', { class: 'result-sub', text: this.modeRuleService.scoreLabel(config.mode) }));
    } else {
      const place = Math.max(1, rows.findIndex((r) => r.isLocal) + 1);
      panel.appendChild(h('div', { class: 'result-heading', text: ordinal(place), style: { color: place === 1 ? '#9ad755' : '#e8e8e8', fontSize: '48px' } }));
      panel.appendChild(h('div', { class: 'result-sub', text: place === 1 ? 'You won the deathmatch' : `of ${rows.length} tanks` }));
    }

    const table = h('div', { class: 'panel-body' });
    table.innerHTML =
      '<table class="result-table"><tr><th>#</th><th>Player</th><th class="num">Kills</th><th class="num">Deaths</th></tr>' +
      rows
        .map(
          (r, i) =>
            `<tr class="${r.isLocal ? 'is-local' : ''}"><td style="color:#888">${i + 1}</td>` +
            `<td style="color:${teamColor(r.team)};font-weight:bold">${esc(r.name)}</td>` +
            `<td class="num">${r.frags}</td><td class="num" style="color:#f88">${r.deaths}</td></tr>`,
        )
        .join('') +
      '</table>';
    panel.appendChild(table);

    const button = h('button', { class: 'btn btn-green btn-lg', text: 'CONTINUE' });
    const press = (): void => {
      if (button.disabled) return;
      button.disabled = true;
      void this.adService.showInterstitial(CC_AD_PLACEMENTS.resultInterstitial).then(() => {
        this.hide();
        onContinue();
      });
    };
    tappable(button, press);
    this.detachKeys();
    this.keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        press();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    panel.appendChild(h('div', { class: 'footer', style: { justifyContent: 'center' } }, button));
    this.uiRootService.show('result', h('div', { class: 'overlay' }, panel));
    this.adService.preloadInterstitial(CC_AD_PLACEMENTS.resultInterstitial);
  };

  public hide = (): void => {
    this.detachKeys();
    this.uiRootService.hide('result');
  };

  private detachKeys(): void {
    if (this.keyHandler != null) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }
}

export default ResultScreenService;
