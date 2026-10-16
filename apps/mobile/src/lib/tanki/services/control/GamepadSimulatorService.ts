// Dev only: a virtual gamepad behind the REAL Gamepad API. With `?gamepad=sim`
// (dev server only, like `?rooms=mock`) navigator.getGamepads() is replaced
// by one standard-mapping pad whose buttons and sticks live in a popup page
// (src/ui/gamepadSimPage.ts); the page posts its whole state on every
// change and this service copies it into the pad. GamepadInputService polls
// the pad exactly as it would a Bluetooth one, so whatever the game does
// with it is the gamepad path — the keyboard is not involved (the popup
// takes pointer input only).
//
// The popup needs a user gesture (Chrome's popup blocker): it opens on the
// first pointer or key on the game page, and again on demand through
// `open()` (globalThis.tanki.gamepadSimulatorService.open()).
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';

const PAD_ID = 'SkillTanki virtual gamepad (sim)';

interface SimButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

/** The pad as the Gamepad API hands it out (a plain object: the DOM's Gamepad cannot be constructed). */
interface SimPad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  timestamp: number;
  axes: number[];
  buttons: SimButton[];
  vibrationActuator: null;
}

export class GamepadSimulatorService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private pad: SimPad | null = null;
  private popup: Window | null = null;
  private installed = false;

  /** `?gamepad=sim` on the dev server. */
  public get enabled(): boolean {
    return import.meta.env.DEV && new URLSearchParams(location.search).get('gamepad') === 'sim';
  }

  /** True while the popup is open and feeding the pad. */
  public get connected(): boolean {
    return this.pad?.connected === true;
  }

  /** Installs the fake Gamepad API and opens the controller on the first gesture. */
  public attach = (): void => {
    if (!this.enabled || this.installed) return;
    this.installed = true;
    const self = this;
    // The pad is listed only while the popup feeds it; before and after, no gamepad.
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: function getGamepads(): (Gamepad | null)[] {
        const pad = self.pad != null && self.pad.connected ? (self.pad as unknown as Gamepad) : null;
        return [pad, null, null, null];
      },
    });
    window.addEventListener('message', this.onMessage);
    const once = (): void => {
      window.removeEventListener('pointerdown', once, true);
      window.removeEventListener('keydown', once, true);
      this.open();
    };
    window.addEventListener('pointerdown', once, true);
    window.addEventListener('keydown', once, true);
    // Automation (no popup blocker) gets it at once; a browser that blocks it waits for the gesture.
    this.open();
    this.loggerService.log('gamepad simulator installed (?gamepad=sim): navigator.getGamepads is the virtual pad');
  };

  /** Opens (or focuses) the controller popup. Returns false when the browser blocked it. */
  public open = (): boolean => {
    if (!this.installed) return false;
    if (this.popup != null && !this.popup.closed) {
      this.popup.focus();
      return true;
    }
    let popup: Window | null = null;
    try {
      popup = window.open('', 'skilltanki-gamepad-sim', 'popup,width=600,height=420');
    } catch {
      popup = null;
    }
    if (popup == null) {
      this.loggerService.warn('gamepad simulator: the popup was blocked; tap the page once, or call tanki.gamepadSimulatorService.open()');
      return false;
    }
    this.popup = popup;
    // The page is written into the opened window (same origin as the opener), so the game needs no extra route or file.
    void import('../../../../ui/gamepadSimPage').then(({ GAMEPAD_SIM_PAGE }) => {
      if (this.popup !== popup || popup.closed) return;
      popup.document.open();
      popup.document.write(GAMEPAD_SIM_PAGE);
      popup.document.close();
    });
    return true;
  };

  // --- internals -----------------------------------------------------------------

  private onMessage = (event: MessageEvent): void => {
    // Only the controller popup may drive the pad.
    if (this.popup == null || event.source !== this.popup) return;
    const data = event.data as { t?: unknown; buttons?: unknown; axes?: unknown; closed?: unknown } | null;
    if (data == null || data.t !== 'gamepad-sim' || !Array.isArray(data.buttons) || !Array.isArray(data.axes)) return;
    if (data.closed === true) {
      this.disconnect();
      return;
    }
    const first = this.pad == null;
    if (first) {
      this.pad = {
        id: PAD_ID,
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: performance.now(),
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        vibrationActuator: null,
      };
    }
    const pad = this.pad!;
    pad.connected = true;
    for (let i = 0; i < pad.buttons.length; i++) {
      const value = Number(data.buttons[i]) || 0;
      pad.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
    }
    for (let i = 0; i < pad.axes.length; i++) {
      pad.axes[i] = Math.max(-1, Math.min(1, Number(data.axes[i]) || 0));
    }
    pad.timestamp = performance.now();
    if (first) this.fire('gamepadconnected');
  };

  private disconnect(): void {
    const pad = this.pad;
    if (pad == null || !pad.connected) return;
    pad.connected = false;
    this.fire('gamepaddisconnected');
    this.pad = null;
    this.loggerService.log('gamepad simulator: the controller closed');
  }

  /** The connect/disconnect events as the browser sends them; a plain Event carries the pad (GamepadEvent wants a real Gamepad). */
  private fire(type: 'gamepadconnected' | 'gamepaddisconnected'): void {
    const event = new Event(type);
    Object.defineProperty(event, 'gamepad', { value: this.pad as unknown as Gamepad, enumerable: true });
    window.dispatchEvent(event);
  }
}

export default GamepadSimulatorService;
