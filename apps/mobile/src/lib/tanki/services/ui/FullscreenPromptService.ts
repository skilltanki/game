// One modal before the menu on a phone in a browser tab: play without the
// browser bars by adding SkillTanki to the home screen (the PWA route — the
// manifest is `display: fullscreen` and index.html carries
// apple-mobile-web-app-capable + black-translucent + viewport-fit=cover, so
// the web clip opens without Safari's chrome). Chrome hands over a
// `beforeinstallprompt` event that can be replayed from a tap: CONTINUE
// closes the box and replays it, so Chrome's own install sheet follows the
// explanation (the owner's call: one button, the native dialog does the
// asking). Safari has no API, so the modal explains Share -> Add to Home
// Screen instead. Full screen
// itself is one tap away in the menu's top bar (FullscreenService), so the
// modal does not offer it (the owner's call: two ways in one box read as
// complicated). Not shown when already standalone or fullscreen, nor on a
// fine-pointer device (a desktop has F11 and no bars worth the interruption).
// Shown OVER the menu once it is up (layer `prompt` above `menu`), so the
// garage backdrop and the turning tank are behind the vignette, as the pause
// box sits over a battle.
import { h, tappable } from '../../../../ui/dom';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type StorageService from '../base/StorageService';
import type FullscreenService from '../base/FullscreenService';
import type DeviceFormService from '../base/DeviceFormService';
import type UiRootService from './UiRootService';

/** Chrome's deferred install prompt (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export class FullscreenPromptService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly fullscreenService = inject<FullscreenService>(TYPES.fullscreenService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);
  private readonly deviceFormService = inject<DeviceFormService>(TYPES.deviceFormService);
  private readonly uiRootService = inject<UiRootService>(TYPES.uiRootService);

  private installEvent: BeforeInstallPromptEvent | null = null;

  /** Call early in boot: Chrome fires the install event once, before any UI is up. */
  public listen = (): void => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e as BeforeInstallPromptEvent;
    });
  };

  /** Shows the modal when it applies, once per profile (localStorage); resolves once the player has chosen (at once when it does not apply). */
  public prompt = (): Promise<void> => {
    if (!this.deviceFormService.touch || this.fullscreenService.immersive || this.storageService.getProfile().homeScreenPromptAt != null) {
      return Promise.resolve();
    }
    this.storageService.saveProfile({ homeScreenPromptAt: Date.now() });
    return new Promise<void>((resolve) => {
      let finished = false;
      // CONTINUE is the active (green) chip: Enter or Space press it, as in the pause box.
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          done();
        }
      };
      const done = (): void => {
        if (finished) return;
        finished = true;
        window.removeEventListener('keydown', onKey);
        this.uiRootService.hide('prompt');
        // Chrome's native install prompt, from the tap that closed the box (it needs the user's gesture).
        const event = this.installEvent;
        this.installEvent = null;
        if (event != null) {
          void event
            .prompt()
            .then(() => event.userChoice)
            .then((choice) => this.loggerService.log('install prompt', choice.outcome))
            .catch((error: unknown) => this.loggerService.warn('install prompt failed', error));
        }
        resolve();
      };
      const box = h(
        'div',
        { class: 'modal modal-wide' },
        h('div', { class: 'chip chip-title modal-title', text: 'HOME SCREEN' }),
        h('div', { class: 'modal-text', text: 'Play without the browser bars: add SkillTanki to the Home Screen and open it from there.' }),
      );
      // Without Chrome's event (Safari, a browser that already asked) the box explains the menu route instead.
      if (this.installEvent == null) {
        box.appendChild(h('div', { class: 'modal-text modal-hint', text: this.installHint() }));
      }
      const skip = h('div', { class: 'chip chip-btn chip-big is-selected modal-continue', text: 'CONTINUE' });
      tappable(skip, done);
      box.appendChild(skip);
      this.uiRootService.show('prompt', h('div', { class: 'overlay is-dialog' }, box));
      window.addEventListener('keydown', onKey);
    });
  };

  private installHint(): string {
    const ua = navigator.userAgent;
    // Wording only (which menu to open); support itself is never judged by the agent.
    if (/iPhone|iPad|iPod/.test(ua)) {
      return 'iPhone / iPad: tap Share, then “Add to Home Screen”.';
    }
    return 'Android: open the browser menu and choose “Install app” or “Add to Home screen”.';
  }
}

export default FullscreenPromptService;
