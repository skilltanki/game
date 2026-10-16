// The loading screen: logo, a real byte-progress bar (fed by the engine's
// AssetProgress) and the phase name.
import { assetProgress } from '../../../../engine/game/AssetProgress';
import { h } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';
import type AssetSourceService from '../asset/AssetSourceService';

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export class LoadingScreenService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);
  private readonly assetSourceService = inject<AssetSourceService>(TYPES.assetSourceService);

  private titleEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;

  public show = (title: string, phase = ''): void => {
    this.titleEl = h('div', { class: 'title', text: title, style: { fontSize: '13px', letterSpacing: '1px' } });
    this.phaseEl = h('div', { class: 'caption', text: phase });
    this.fillEl = h('div', { class: 'fill' });
    this.labelEl = h('div', { class: 'label', text: '0%' });
    this.counterEl = h('div', { style: { font: 'bold 12px monospace', color: 'rgba(255,255,255,0.75)' } });
    const panel = h(
      'div',
      { class: 'panel', style: { width: 'min(420px, 88vw)', gap: '10px' } },
      this.titleEl,
      h('div', { class: 'bar' }, this.fillEl, this.labelEl),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, this.phaseEl, this.counterEl),
    );
    const overlay = h('div', { class: 'overlay' }, h('img', { class: 'logo', attrs: { src: this.assetSourceService.logoUrl, alt: 'SkillTanki' } }), panel);
    this.uiRootService.show('loading', overlay);
    assetProgress.onProgress((received, total) => this.setProgress(received, total));
  };

  public setPhase = (phase: string): void => {
    if (this.phaseEl != null) {
      this.phaseEl.textContent = phase;
    }
  };

  public setProgress = (received: number, total: number): void => {
    if (this.fillEl == null || this.labelEl == null || this.counterEl == null) {
      return;
    }
    if (total <= 0) {
      this.counterEl.textContent = `${formatMb(received)} MB`;
      this.labelEl.textContent = '';
      return;
    }
    const fraction = Math.max(0, Math.min(1, received / total));
    this.fillEl.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.labelEl.textContent = `${Math.round(fraction * 100)}%`;
    this.counterEl.textContent = `${formatMb(received)} / ${formatMb(total)} MB`;
  };

  public fail = (message: string): void => {
    if (this.titleEl != null) {
      this.titleEl.textContent = message;
      this.titleEl.classList.add('error');
    }
    this.setPhase('');
  };

  public hide = (): void => {
    assetProgress.onProgress(null);
    this.uiRootService.hide('loading');
    this.titleEl = this.phaseEl = this.fillEl = this.labelEl = this.counterEl = null;
  };
}

export default LoadingScreenService;
