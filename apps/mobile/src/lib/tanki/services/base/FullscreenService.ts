// The Fullscreen API behind one door: whether the device has it (read from
// document.fullscreenEnabled / webkitFullscreenEnabled, never from the user
// agent — iPhone Safari has none, only the native video player), whether the
// page is already immersive (fullscreen, or installed as a web clip and
// running standalone), a toggle that MUST be called inside a user gesture
// (a request outside one is refused, iPad included), and a change hook for
// the icon that shows the state.
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

interface FullscreenDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export class FullscreenService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  /** The API is there. */
  public get supported(): boolean {
    const doc = document as FullscreenDocument;
    return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
  }

  /** The page fills the screen right now. */
  public get active(): boolean {
    const doc = document as FullscreenDocument;
    return doc.fullscreenElement != null || doc.webkitFullscreenElement != null;
  }

  /** Installed to the home screen and opened from there (no browser chrome). */
  public get standalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }

  /** Either way of having no browser bars. */
  public get immersive(): boolean {
    return this.standalone || this.active;
  }

  /** Enter or leave; call from a tap/click handler. */
  public toggle = async (): Promise<void> => {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;
    try {
      if (this.active) {
        if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
        else if (typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
      } else if (typeof root.requestFullscreen === 'function') {
        await root.requestFullscreen({ navigationUI: 'hide' });
      } else if (typeof root.webkitRequestFullscreen === 'function') {
        await root.webkitRequestFullscreen();
      }
      this.loggerService.log('fullscreen', this.active ? 'on' : 'off');
    } catch (error) {
      this.loggerService.warn('fullscreen refused', error);
    }
  };

  /** Fires after every change; returns the unsubscribe. */
  public onChange = (listener: () => void): (() => void) => {
    document.addEventListener('fullscreenchange', listener);
    document.addEventListener('webkitfullscreenchange', listener);
    return () => {
      document.removeEventListener('fullscreenchange', listener);
      document.removeEventListener('webkitfullscreenchange', listener);
    };
  };
}

export default FullscreenService;
