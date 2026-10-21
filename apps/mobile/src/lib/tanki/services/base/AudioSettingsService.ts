// Sound on/off for the whole game: the PlayCanvas sound system (engines,
// turrets, shots, deaths) through its master volume, and the few plain
// HTMLAudio cues (flag events, supplies) through `silent`, which their
// players check. `muted` is the player's setting, remembered in the profile
// and toggled from the speaker icon in the menu; `hold()` is the battle's
// pause — everything quiet while the box is up, the setting untouched
// (the owner's call), so `silent` = muted || held.
import type * as pc from 'playcanvas';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';
import type StorageService from './StorageService';

export class AudioSettingsService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);

  private app: pc.AppBase | null = null;
  /** The battle is paused: quiet until it resumes or ends. */
  private held = false;

  /** The player's setting (the speaker icon). */
  public get muted(): boolean {
    return this.storageService.getProfile().muted ?? false;
  }

  /** Nothing should sound right now: muted by the player or held by the pause. */
  public get silent(): boolean {
    return this.muted || this.held;
  }

  /** The pause holds the sound (true) and lets it go (false); the setting stays as it is. */
  public hold = (held: boolean): void => {
    if (this.held === held) return;
    this.held = held;
    this.applyToApp();
  };

  /** The renderer registers its app once created, so the stored state applies from the first sound. */
  public attach = (app: pc.AppBase): void => {
    this.app = app;
    this.applyToApp();
  };

  public setMuted = (muted: boolean): void => {
    this.storageService.saveProfile({ muted });
    this.applyToApp();
    this.loggerService.log('sound', muted ? 'muted' : 'on');
  };

  public toggle = (): boolean => {
    const next = !this.muted;
    this.setMuted(next);
    return next;
  };

  private applyToApp(): void {
    if (this.app == null) {
      return;
    }
    (this.app.systems.sound as pc.SoundComponentSystem).volume = this.silent ? 0 : 1;
  }
}

export default AudioSettingsService;
