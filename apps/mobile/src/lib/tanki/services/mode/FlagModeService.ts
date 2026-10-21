// Capture the Flag / Assault runtime: flag entities, pedestals, the pickup
// and delivery checks. The RULES are the engine's CtfMode (a port of the
// original server's handler); this service only runs the touch detection
// and turns the outcomes into battle events. Port of logic/ctf.ts without
// the HUD/HTML coupling.
import { Vector3 } from '../../../../engine/math/Vector3';
import { RayHit } from '../../../../engine/physics/collision/types/RayHit';
import { CtfMode } from '../../../../engine/game/CtfMode';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { CtfFlagPositions } from '../../../../engine/map/CtfFlags';
import { assetUrl } from '../../../../engine/tank/TankAssets';
import type * as pc from 'playcanvas';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type BattleStateService from '../battle/BattleStateService';
import type BattleEventService from '../battle/BattleEventService';
import type ScoreService from '../battle/ScoreService';
import type AudioSettingsService from '../base/AudioSettingsService';

/** How close to its pedestal a carrier must be to score (sim units). */
const DELIVERY_RADIUS = 250;

const _rayOrigin = new Vector3();
const _rayDir = new Vector3();
const _rayHit = new RayHit();
const _tankPos = new Vector3();

export class FlagModeService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly audioSettingsService = inject<AudioSettingsService>(TYPES.audioSettingsService);

  private ctf: CtfMode | null = null;
  private readonly sounds = new Map<string, HTMLAudioElement>();
  /** False on an online replica: the host runs the rules, this machine replays its events. */
  private authority = true;

  public setAuthority = (on: boolean): void => {
    this.authority = on;
  };

  /**
   * The host's flag event, replayed here: the flag moves and the battle event
   * fires, no rules run. `team` means what the engine's CtfEvent means: the
   * FLAG for taken / dropped / returned, the SCORING team for delivered (the
   * cargo that goes home is then the enemy flag in CTF, the own flag in Assault).
   */
  public applyRemote = (kind: 'taken' | 'dropped' | 'returned' | 'delivered', team: 'red' | 'blue', by: GameTank | null): void => {
    const ctf = this.ctf;
    if (ctf == null) return;
    const flagTeam = team;
    switch (kind) {
      case 'taken':
        if (by != null) ctf.flags[flagTeam].setCarrier(by);
        break;
      case 'returned':
        ctf.flags[flagTeam].returnToBase();
        break;
      case 'delivered': {
        const cargo = ctf.rules === 'assault' ? team : team === 'red' ? 'blue' : 'red';
        ctf.flags[cargo].returnToBase();
        break;
      }
      default:
        break;
    }
    if (kind === 'taken' || kind === 'dropped' || kind === 'delivered') {
      if (by != null) ctf.onEvent?.({ kind, team: flagTeam, by });
    } else {
      ctf.onEvent?.({ kind: 'returned', team: flagTeam, by });
    }
  };

  public get mode(): CtfMode | null {
    return this.ctf;
  }

  public get active(): boolean {
    return this.ctf != null;
  }

  /** Builds the flags when the mode and the map call for them. */
  public setup = async (positions: CtfFlagPositions | null): Promise<void> => {
    this.ctf = null;
    const mode = this.battleStateService.config.mode;
    if ((mode !== 'ctf' && mode !== 'assault') || positions == null) {
      return;
    }
    try {
      const { loadCtfAssets, buildPedestal } = await import('../../../../engine/game/CtfAssets');
      const app = this.engineService.app;
      const simRoot = this.engineService.simRoot;
      const assets = await loadCtfAssets(app);
      const ctf = CtfMode.create(positions, assets.flagTextures, simRoot);
      ctf.rules = mode === 'assault' ? 'assault' : 'ctf';
      void buildPedestal(app, 'red', positions.red, simRoot);
      void buildPedestal(app, 'blue', positions.blue, simRoot);
      ctf.onScore = (team) => this.scoreService.addTeamPoint(team);
      ctf.onEvent = (event) => {
        const by = 'by' in event && event.by != null ? this.battleStateService.actorOf(event.by) : null;
        this.battleEventService.emit('flag', {
          kind: event.kind,
          flag: event.team,
          byId: by?.id ?? null,
          byName: by?.name ?? null,
          byTeam: by?.gameTank.tank.team ?? null,
        });
        // The original plays the return jingle only for a REAL return; the
        // technical one after a carrier's death stays silent.
        if (event.kind === 'taken') this.play('FlagTaken');
        else if (event.kind === 'dropped') this.play('FlagDropped');
        else if (event.kind === 'returned' && event.by != null) this.play('FlagReturned');
        else if (event.kind === 'delivered') this.play('FlagCaptured');
      };
      this.ctf = ctf;
      this.loggerService.log('flag mode ready', ctf.rules);
    } catch (error) {
      this.loggerService.warn('flag mode not initialised', error);
      this.ctf = null;
    }
  };

  /** Holds a tank off the flags for a moment (spawn on the pedestal in Assault). */
  public lockPickup = (gameTank: GameTank, now: number): void => {
    this.ctf?.lockPickup(gameTank, now);
  };

  public carriedBy = (gameTank: GameTank): 'red' | 'blue' | null => this.ctf?.carriedBy(gameTank) ?? null;

  /** A dying carrier drops the flag where it fell. */
  public dropCarriedFlag = (gameTank: GameTank, now: number): void => {
    if (!this.authority) return;
    this.ctf?.dropCarriedFlag(gameTank, gameTank.tank.getBody().state.position, true, now);
  };

  /** Pickup / delivery pass on the physics pose. Fixed-step. */
  public step = (now: number): void => {
    const ctf = this.ctf;
    if (ctf == null || !this.authority) {
      return;
    }
    const detector = this.battleStateService.physics.getCollisionDetector();
    for (const actor of this.battleStateService.actors()) {
      const gameTank = actor.gameTank;
      if (gameTank.tank.isDead()) {
        continue;
      }
      const team = gameTank.tank.team;
      if (team !== 'red' && team !== 'blue') {
        continue;
      }
      _tankPos.copy(gameTank.tank.getBody().state.position);
      const half = { x: gameTank.hullSize.x * 0.5, y: gameTank.hullSize.y * 0.5, z: gameTank.hullSize.z * 0.5 };
      // Delivery is keyed off the PEDESTAL, not off touching your own flag.
      if (ctf.tryDeliverAtBase(gameTank, _tankPos, DELIVERY_RADIUS)) {
        continue;
      }
      for (const flagTeam of ['red', 'blue'] as const) {
        const flag = ctf.flags[flagTeam];
        if (flag.state === 'carried' || !flag.overlaps(_tankPos, half)) {
          continue;
        }
        // No grabbing through walls or floors: ray to the flag box centre.
        _rayOrigin.copy(_tankPos);
        _rayDir.x = flag.position.x - _rayOrigin.x;
        _rayDir.y = flag.position.y - _rayOrigin.y;
        _rayDir.z = flag.centerZ() - _rayOrigin.z;
        if (detector.raycastStatic(_rayOrigin, _rayDir, 0xffff, 1, null, _rayHit)) {
          continue;
        }
        ctf.triggerFlag(flagTeam, gameTank, now);
      }
    }
  };

  /** Carried flags follow their carrier's interpolated pose; billboarding. */
  public render = (camSimPos: pc.Vec3): void => {
    this.ctf?.update(camSimPos);
  };

  public dispose = (): void => {
    this.ctf = null;
    this.authority = true;
    for (const audio of this.sounds.values()) {
      audio.pause();
    }
  };

  private play(name: string): void {
    if (this.audioSettingsService.silent) {
      return;
    }
    let audio = this.sounds.get(name);
    if (audio == null) {
      audio = new Audio(assetUrl(`/battle/modes/ctf/sounds/${name}.mp3`));
      audio.volume = 0.6;
      this.sounds.set(name, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }
}

export default FlagModeService;
