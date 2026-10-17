// The original's "Maximum Armor / Damage / Speed" cues on the LOCAL tank's
// supply activations. One cue at a time: an activation while a cue plays
// queues behind it (two taps a moment apart play both, in order). The local
// tank's death drops the queue — a cue for an effect the respawn has just
// wiped would announce nothing — but never cuts the cue already playing.
// Plain HTMLAudio like the flag cues (FlagModeService), gated by
// AudioSettingsService.muted at the moment of the activation.
import type { SupplyKind } from '../../../../model/TankCommand';
import { assetUrl } from '../../../../engine/tank/TankAssets';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type AudioSettingsService from '../base/AudioSettingsService';
import type BattleEventService from './BattleEventService';
import type BattleStateService from './BattleStateService';

/** Supplies with a cue; the repair kit and the nuclear fuel have none in the original. */
const CUES: Partial<Record<SupplyKind, string>> = {
  armor: 'MaximumArmor',
  damage: 'MaximumDamage',
  nitro: 'MaximumSpeed',
};
const VOLUME = 0.7;

export class SupplySoundService {
  private readonly audioSettingsService = inject<AudioSettingsService>(TYPES.audioSettingsService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);

  private readonly sounds = new Map<string, HTMLAudioElement>();
  /** Cue names waiting for the one playing to end. */
  private readonly queue: string[] = [];
  private playing: HTMLAudioElement | null = null;
  private readonly unsubscribe: Array<() => void> = [];

  /** After the roster is spawned: subscribes to the battle's events and warms the three cues. */
  public create = (): void => {
    this.dispose();
    const localId = this.battleStateService.local.id;
    for (const name of Object.values(CUES)) this.audio(name);
    this.unsubscribe.push(
      this.battleEventService.on('supply', (event) => {
        if (event.local) this.cue(event.kind);
      }),
      this.battleEventService.on('death', (event) => {
        if (event.victimId === localId) this.queue.length = 0;
      }),
    );
  };

  public dispose = (): void => {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.queue.length = 0;
    if (this.playing != null) {
      this.playing.onended = null;
      this.playing.pause();
      this.playing = null;
    }
  };

  /** What is playing and waiting (diagnostics: `tanki.supplySoundService.state`). */
  public get state(): { playing: string | null; queue: string[] } {
    let playing: string | null = null;
    for (const [name, audio] of this.sounds) if (audio === this.playing) playing = name;
    return { playing, queue: [...this.queue] };
  }

  private cue(kind: SupplyKind): void {
    const name = CUES[kind];
    if (name == null || this.audioSettingsService.muted) return;
    if (this.playing != null) {
      this.queue.push(name);
      return;
    }
    this.start(name);
  }

  private start(name: string): void {
    const audio = this.audio(name);
    this.playing = audio;
    audio.onended = () => this.next(audio);
    audio.currentTime = 0;
    // A rejected play (autoplay policy before the first gesture) counts as ended, so the queue is not stranded.
    void audio.play().catch(() => this.next(audio));
  }

  private next(ended: HTMLAudioElement): void {
    if (this.playing !== ended) return;
    ended.onended = null;
    this.playing = null;
    const name = this.queue.shift();
    if (name != null) this.start(name);
  }

  private audio(name: string): HTMLAudioElement {
    let audio = this.sounds.get(name);
    if (audio == null) {
      audio = new Audio(assetUrl(`/battle/sounds/${name}.mp3`));
      audio.preload = 'auto';
      audio.volume = VOLUME;
      this.sounds.set(name, audio);
    }
    return audio;
  }
}

export default SupplySoundService;
