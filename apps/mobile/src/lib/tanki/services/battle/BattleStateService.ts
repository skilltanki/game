// The one place the current battle's state lives: configuration, phase,
// simulation clock, physics scene, map stage and the actor registry. Every
// other battle service reads from here; only BattleSessionService and the
// loop write to it.
import { TankPhysicsScene } from '../../../../engine/tank/TankPhysicsScene';
import type { TankRoster } from '../../../../engine/game/TankRoster';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { Tank } from '../../../../engine/tank/Tank';
import type { MapRegistryEntry } from '../../../../engine/logic/bootstrap';
import { FixedStepper } from '../../../../classes/FixedStepper';
import type { TankActor } from '../../../../classes/TankActor';
import type { BattleConfig } from '../../../../model/BattleConfig';
import type { BattlePhase } from '../../../../model/BattleEvents';
import { CC_PHYSICS_STEP_MS } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleEventService from './BattleEventService';
import type { MapStage } from './MapStageService';

export class BattleStateService {
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);

  private _config: BattleConfig | null = null;
  private _phase: BattlePhase = 'idle';
  private _physics: TankPhysicsScene | null = null;
  private _mapEntry: MapRegistryEntry | null = null;
  private _mapStage: MapStage | null = null;
  private _roster: TankRoster | null = null;
  private readonly actorsById = new Map<string, TankActor>();
  private actorList: TankActor[] = [];
  private _local: TankActor | null = null;

  /** Simulation clock (ticks and ms); reset per battle. */
  public readonly stepper = new FixedStepper(CC_PHYSICS_STEP_MS);

  // --- lifecycle -----------------------------------------------------------

  public begin = (config: BattleConfig, mapEntry: MapRegistryEntry, roster: TankRoster): void => {
    this._config = config;
    this._mapEntry = mapEntry;
    this._roster = roster;
    this._physics = new TankPhysicsScene(0, mapEntry.gravity ?? 1000);
    this.stepper.reset();
    this.actorsById.clear();
    this.actorList = [];
    this._local = null;
    this.setPhase('loading');
  };

  public end = (): void => {
    this._physics?.destroy();
    this._physics = null;
    this._mapStage = null;
    this._roster = null;
    this.actorsById.clear();
    this.actorList = [];
    this._local = null;
    this._config = null;
    this.setPhase('idle');
  };

  public setMapStage = (stage: MapStage): void => {
    this._mapStage = stage;
  };

  public setPhase = (phase: BattlePhase): void => {
    if (this._phase === phase) {
      return;
    }
    this._phase = phase;
    this.battleEventService.emit('phase', { phase });
  };

  // --- actors ----------------------------------------------------------------

  public addActor = (actor: TankActor): void => {
    this.actorsById.set(actor.id, actor);
    this.actorList = [...this.actorsById.values()];
    if (actor.isLocal) {
      this._local = actor;
    }
  };

  public removeActor = (id: string): TankActor | null => {
    const actor = this.actorsById.get(id) ?? null;
    if (actor != null) {
      this.actorsById.delete(id);
      this.actorList = [...this.actorsById.values()];
      if (this._local === actor) {
        this._local = null;
      }
    }
    return actor;
  };

  public actor = (id: string): TankActor | null => this.actorsById.get(id) ?? null;

  public actorOf = (gameTank: GameTank): TankActor | null => this.actorsById.get(gameTank.id) ?? null;

  /** Live list (same array instance until the roster changes). */
  public actors = (): TankActor[] => this.actorList;

  public gameTanks = (): GameTank[] => this.actorList.map((a) => a.gameTank);

  public tanks = (): Tank[] => this.actorList.map((a) => a.gameTank.tank);

  public get local(): TankActor {
    if (this._local == null) {
      throw new Error('no local actor in this battle');
    }
    return this._local;
  }

  public get hasLocal(): boolean {
    return this._local != null;
  }

  // --- accessors -----------------------------------------------------------

  public get config(): BattleConfig {
    if (this._config == null) {
      throw new Error('no battle is running');
    }
    return this._config;
  }

  public get running(): boolean {
    return this._config != null;
  }

  public get phase(): BattlePhase {
    return this._phase;
  }

  public get physics(): TankPhysicsScene {
    if (this._physics == null) {
      throw new Error('no battle is running');
    }
    return this._physics;
  }

  public get mapEntry(): MapRegistryEntry {
    if (this._mapEntry == null) {
      throw new Error('no battle is running');
    }
    return this._mapEntry;
  }

  public get mapStage(): MapStage {
    if (this._mapStage == null) {
      throw new Error('the map stage is not loaded');
    }
    return this._mapStage;
  }

  public get roster(): TankRoster {
    if (this._roster == null) {
      throw new Error('no battle is running');
    }
    return this._roster;
  }

  /** Simulation time in ms (what every "now" in the battle means). */
  public get timeMs(): number {
    return this.stepper.timeMs;
  }

  public get tick(): number {
    return this.stepper.tick;
  }
}

export default BattleStateService;
