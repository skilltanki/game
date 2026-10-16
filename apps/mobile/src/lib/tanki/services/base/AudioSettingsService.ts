// Sound on/off for the whole game: the PlayCanvas sound system (engines,
// turrets, shots, deaths) through its master volume, and the few plain
// HTMLAudio cues (flag events) through `muted`, which their players check.
// Remembered in the profile; toggled from the speaker icon in the menu.
import type * as pc from 'playcanvas';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';
import type StorageService from './StorageService';

export class AudioSettingsService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly storageService = inject<StorageService>(TYPES.storageService);

  private app: pc.AppBase | null = null;

  public get muted(): boolean {
    return this.storageService.getProfile().muted ?? false;
  }

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
    (this.app.systems.sound as pc.SoundComponentSystem).volume = this.muted ? 0 : 1;
  }
}

export default AudioSettingsService;
