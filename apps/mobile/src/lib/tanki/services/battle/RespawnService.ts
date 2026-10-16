// The death lifecycle (spawn picking, respawn with protection, drowning,
// self-destruct, overturn recovery): the engine's RespawnSystem, built per
// battle. Self-destruct is per actor on the command side; the engine only
// tracks the LOCAL hold today, so a bot's request is a no-op until the
// system grows per-tank holds (bots never ask for it anyway).
import { RespawnSystem, RESPAWN_DELAY_MS, SUICIDE_DELAY_MS } from '../../../../engine/logic/respawn';
import { TankState } from '../../../../engine/game/TankRoster';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { Supplies } from '../../../../engine/game/Supplies';
import type { TankActor } from '../../../../classes/TankActor';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from './BattleStateService';
import type BattleEventService from './BattleEventService';
import type EffectsService from './EffectsService';
import type CombatService from './CombatService';
import type ScoreService from './ScoreService';
import type CameraService from './CameraService';
import type FlagModeService from '../mode/FlagModeService';

export { RESPAWN_DELAY_MS, SUICIDE_DELAY_MS };

export class RespawnService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly combatService = inject<CombatService>(TYPES.combatService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly cameraService = inject<CameraService>(TYPES.cameraService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);

  private _system: RespawnSystem | null = null;
  private readonly suppliesByTank = new TankState<Supplies>();
  /** Online: when the local tank died (the engine's timers stand still while the host owns deaths). */
  private localDeadAtMs: number | null = null;

  /** Runs after the roster has spawned (and registered its supplies): the map is reset in dispose(), not here. */
  public create = (): void => {
    const stage = this.battleStateService.mapStage;
    this._system = new RespawnSystem({
      statusEffects: this.effectsService.status,
      battleScore: this.scoreService.score,
      combat: this.combatService.presenter,
      hitEffects: this.effectsService.effects.hitEffects,
      suppliesByTank: this.suppliesByTank,
      spawnPoints: stage.spawnPoints,
      killZ: stage.killZ,
      ctf: () => this.flagModeService.mode,
      tanks: () => this.battleStateService.gameTanks(),
      localPlayer: () => this.battleStateService.local.gameTank,
      getNow: () => this.battleStateService.timeMs,
      onLocalSpawnPicked: (spawn) => this.cameraService.startSpawnFlyIn(spawn),
      onLocalRespawned: () => this.cameraService.cancelFlyIn(),
    });
  };

  /** Online: the host owns deaths; a completed self-destruct hold is sent, not detonated (RespawnSystem.network). */
  public setNetwork = (network: { sendSuicide(): void } | null): void => {
    if (this._system != null) this._system.network = network;
  };

  public registerSupplies = (actor: TankActor): void => {
    this.suppliesByTank.set(actor.gameTank, actor.supplies);
  };

  public unregisterSupplies = (actor: TankActor): void => {
    this.suppliesByTank.delete(actor.gameTank);
  };

  public get system(): RespawnSystem {
    if (this._system == null) {
      throw new Error('RespawnService.create() has not run');
    }
    return this._system;
  }

  public setSuicideHeld = (actor: TankActor, held: boolean): void => {
    if (actor.isLocal && this._system != null) {
      this._system.setSuicideHeld(held);
    }
  };

  public respawnTimerMs = (gameTank: GameTank): number => this._system?.respawnTimerMs(gameTank) ?? 0;

  public isOverturnWarning = (gameTank: GameTank): boolean => this._system?.isOverturnWarning(gameTank) ?? false;

  public get suicideProgress(): number {
    const system = this._system;
    return system != null && system.suicideHeld ? system.suicideHeldMs / SUICIDE_DELAY_MS : 0;
  }

  public get suicideHeld(): boolean {
    return this._system?.suicideHeld ?? false;
  }

  /** Fixed-step passes, in the engine's order. */
  public stepSuicide = (): void => this._system?.stepSuicide();
  public stepOverturn = (): void => this._system?.stepOverturn();
  public stepDeaths = (): void => {
    this._system?.stepDeaths();
    if (this.battleStateService.hasLocal) {
      const local = this.battleStateService.local.gameTank;
      let deadMs = 0;
      if (local.tank.isDead()) {
        if (this._system?.network != null) {
          const now = this.battleStateService.timeMs;
          this.localDeadAtMs ??= now;
          deadMs = Math.max(1, now - this.localDeadAtMs);
        } else {
          deadMs = this.respawnTimerMs(local);
        }
      } else {
        this.localDeadAtMs = null;
      }
      this.battleEventService.emit('localDeath', { deadMs, respawnInMs: deadMs > 0 ? Math.max(0, RESPAWN_DELAY_MS - deadMs) : 0 });
    }
  };

  public dispose = (): void => {
    this._system = null;
    this.suppliesByTank.clear();
    this.localDeadAtMs = null;
  };
}

export default RespawnService;
