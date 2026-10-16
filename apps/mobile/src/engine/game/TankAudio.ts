// Tank audio in the spirit of the original TankSoundEffects/EngineSounds:
// engine loops (idle / acceleration / moving), turret rotation loop, shot and
// death one-shots. Positional via PlayCanvas sound components (the camera
// carries an audiolistener).
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import type { GameTank } from './GameTank';
import { StreamWeapon } from '../weapon/StreamWeapon';

const ENGINE_IDLE = assetUrl('/battle/sounds/engines/LegacyTankEngineIdle.mp3');
const ENGINE_ACCELERATION = assetUrl('/battle/sounds/engines/LegacyTankEngineAcceleration.mp3');
const ENGINE_MOVING = assetUrl('/battle/sounds/engines/LegacyTankEngineLoop.mp3');
const TURRET_ROTATION = assetUrl('/turrets/TurretRotation.mp3');
const DEATH_EXPLOSION = assetUrl('/battle/death/explosion-tnk.mp3');

const SHOT_SOUNDS: Record<string, string> = {
  Railgun: assetUrl('/turrets/railgun/railgun.mp3'),
  Thunder: assetUrl('/turrets/thunder/thunder_shot.mp3'),
  Smoky: assetUrl('/turrets/smoky/smoky_shot.mp3'),
  Shaft: assetUrl('/turrets/shaft/shot.wav'),
  Twins: assetUrl('/turrets/twins/plazma_shot.mp3'),
  Ricochet: assetUrl('/turrets/ricochet/ricochet_shot.mp3'),
  Firebird: assetUrl('/turrets/firebird/flamethrower.mp3'),
  Freeze: assetUrl('/turrets/frezee/freeze.mp3'),
  Isida: assetUrl('/turrets/isida/damage.mp3'),
};
const SHOT_SOUND_MIN_INTERVAL_MS = 300; // throttle for rapid-fire stream weapons
/**
 * Stream turrets whose mp3 is a CONTINUOUS loop, not a one-shot (freeze.mp3 is
 * 272 KB — four times the Railgun's). The original ran them as a live sound
 * effect killed by FreezeEffects.stopEffects(); firing them as one-shots left
 * the sound running long after the trigger was released.
 */
const STREAM_TURRETS = new Set(['Firebird', 'Freeze', 'Isida']);
const DEFAULT_SHOT_SOUND = SHOT_SOUNDS.Smoky;

const MOVING_SPEED_THRESHOLD = 250; // units/s: below this, input plays "acceleration"
const VOLUME_FADE_PER_SEC = 4;

const assetCache = new Map<string, pc.Asset>();

function loadAudioAsset(app: pc.AppBase, url: string): Promise<pc.Asset> {
  const cached = assetCache.get(url);
  if (cached != null) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'audio', (err, asset) => {
      if (err != null || asset == null) {
        reject(new Error(String(err ?? `audio load failed: ${url}`)));
      } else {
        assetCache.set(url, asset);
        resolve(asset);
      }
    });
  });
}

export class TankAudio {
  private entity: pc.Entity;
  private volumes = { idle: 0, acceleration: 0, moving: 0, turret: 0, stream: 0 };

  private constructor(private gameTank: GameTank, private shotUrl: string) {
    this.entity = gameTank.entity;
  }

  /** Preloads shared audio and unlocks the AudioContext on the first gesture. */
  static async loadShared(app: pc.AppBase): Promise<void> {
    const resume = (): void => {
      const context = (app.systems.sound as pc.SoundComponentSystem).context;
      if (context != null && context.state === 'suspended') {
        void context.resume();
      }
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    await Promise.all(
      [ENGINE_IDLE, ENGINE_ACCELERATION, ENGINE_MOVING, TURRET_ROTATION, DEATH_EXPLOSION, ...Object.values(SHOT_SOUNDS)].map(
        (url) => loadAudioAsset(app, url),
      ),
    );
  }

  static async create(app: pc.AppBase, gameTank: GameTank, turretName: string): Promise<TankAudio> {
    const shotUrl = SHOT_SOUNDS[turretName] ?? DEFAULT_SHOT_SOUND;
    const audio = new TankAudio(gameTank, shotUrl);
    const entity = gameTank.entity;
    entity.addComponent('sound', {
      positional: true,
      distanceModel: pc.DISTANCE_LINEAR,
      refDistance: 5,
      maxDistance: 60,
      volume: 1,
    });
    const sound = entity.sound!;
    const slot = (name: string, url: string, loop: boolean): void => {
      sound.addSlot(name, {
        asset: assetCache.get(url)!.id,
        loop,
        autoPlay: loop,
        volume: loop ? 0 : 1,
        overlap: !loop,
      });
    };
    slot('idle', ENGINE_IDLE, true);
    slot('acceleration', ENGINE_ACCELERATION, true);
    slot('moving', ENGINE_MOVING, true);
    slot('turret', TURRET_ROTATION, true);
    if (STREAM_TURRETS.has(turretName)) {
      // Looped and faded by update() while the beam is on; never one-shot.
      slot('stream', shotUrl, true);
    } else {
      slot('shot', shotUrl, false);
    }
    slot('death', DEATH_EXPLOSION, false);
    return audio;
  }

  private lastShotSoundAt = 0;

  playShot(): void {
    // Stream turrets are driven by the looped 'stream' slot in update()
    if (this.entity.sound?.slot('shot') == null) {
      return;
    }
    const now = performance.now();
    if (now - this.lastShotSoundAt >= SHOT_SOUND_MIN_INTERVAL_MS) {
      this.lastShotSoundAt = now;
      this.entity.sound.play('shot');
    }
  }

  playDeath(): void {
    this.entity.sound?.play('death');
  }

  /**
   * Cuts every looping sound at once.
   *
   * The loops are faded by update(), which stops being called when the battle
   * ends — so whatever was playing at the final whistle (a bot's turret still
   * traversing, an engine mid-rev) hung there forever. Volumes are zeroed too,
   * or a later update() would resume them from the stale value.
   */
  stopLoops(): void {
    const sound = this.entity.sound;
    for (const name of ['idle', 'acceleration', 'moving', 'turret', 'stream'] as const) {
      this.volumes[name] = 0;
      const slot = sound?.slot(name);
      if (slot != null) {
        slot.volume = 0;
        slot.stop();
      }
    }
  }

  /** Per-frame: engine mode by control+speed (original set*Mode), turret loop while rotating. */
  update(dtSec: number): void {
    const tank = this.gameTank.tank;
    const sound = this.entity.sound;
    if (sound == null) {
      return;
    }
    const dead = tank.isDead();
    const moveInput = tank.chassis.getActualMovementDirection() !== 0 || tank.chassis.getActualTurnDirection() !== 0;
    const speed = tank.getBody().state.velocity.length();

    const target = {
      idle: dead ? 0 : moveInput || speed > MOVING_SPEED_THRESHOLD ? 0 : 0.45,
      acceleration: dead ? 0 : moveInput && speed < MOVING_SPEED_THRESHOLD ? 0.55 : 0,
      moving: dead ? 0 : (moveInput || speed > MOVING_SPEED_THRESHOLD * 1.5) && speed >= MOVING_SPEED_THRESHOLD ? 0.55 : 0,
      turret: !dead && tank.turretController.isRotating() ? 0.4 : 0,
      // Continuous beam sound: on only while the stream is actually firing
      stream: !dead && this.gameTank.weapon instanceof StreamWeapon && this.gameTank.weapon.isStreaming() ? 0.75 : 0,
    };
    for (const name of ['idle', 'acceleration', 'moving', 'turret', 'stream'] as const) {
      const current = this.volumes[name];
      const desired = target[name];
      const step = VOLUME_FADE_PER_SEC * dtSec;
      const next = current < desired ? Math.min(desired, current + step) : Math.max(desired, current - step);
      if (next !== current) {
        this.volumes[name] = next;
        const slot = sound.slot(name);
        if (slot != null) {
          slot.volume = next;
        }
      }
    }
  }
}
