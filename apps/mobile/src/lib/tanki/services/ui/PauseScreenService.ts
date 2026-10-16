// Pause: RESUME or back to the MAIN MENU. Keyboard: the arrows move the
// active chip, Enter or Space presses it (Escape resumes via GameFacadeService).
import { h, tappable } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type UiRootService from './UiRootService';

export class PauseScreenService {
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** `hint` (online: the battle goes on behind the box) sits under the title. */
  public show = (onResume: () => void, onLeave: () => void, hint?: string): void => {
    const resume = h('div', { class: 'chip chip-btn chip-big is-selected', text: 'RESUME' });
    tappable(resume, onResume);
    const leave = h('div', { class: 'chip chip-btn chip-big', text: 'MAIN MENU' });
    tappable(leave, onLeave);
    // Same language as the start menu: chips over the vignette, no logo.
    const box = h(
      'div',
      { class: 'modal' },
      h('div', { class: 'chip chip-title modal-title', text: 'PAUSED' }),
      ...(hint != null ? [h('div', { class: 'modal-text modal-hint', text: hint })] : []),
      resume,
      leave,
    );
    this.uiRootService.show('pause', h('div', { class: 'overlay' }, box));

    const buttons: { el: HTMLElement; press: () => void }[] = [
      { el: resume, press: onResume },
      { el: leave, press: onLeave },
    ];
    let active = 0;
    const paint = (): void => buttons.forEach((b, i) => b.el.classList.toggle('is-selected', i === active));
    this.detachKeys();
    this.keyHandler = (e) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          active = Math.max(0, active - 1);
          paint();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          active = Math.min(buttons.length - 1, active + 1);
          paint();
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          buttons[active].press();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  };

  public hide = (): void => {
    this.detachKeys();
    this.uiRootService.hide('pause');
  };

  private detachKeys(): void {
    if (this.keyHandler != null) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }
}

export default PauseScreenService;
