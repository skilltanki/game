// Orchestrates a battle's life: assemble, play, pause, finish, tear down.
// This is the only service that calls the others' create()/dispose(), in a
// fixed order, so a battle can be restarted without reloading the page.
import { Vector3 } from '../../../../engine/math/Vector3';
import type { BattleConfig } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type BattleStateService from './BattleStateService';
import type BattleEventService from './BattleEventService';
import type MapStageService from './MapStageService';
import type EffectsService from './EffectsService';
import type CombatService from './CombatService';
import type ScoreService from './ScoreService';
import type ClockService from './ClockService';
import type CameraService from './CameraService';
import type RespawnService from './RespawnService';
import type TankSpawnService from './TankSpawnService';
import type BattleLoopService from './BattleLoopService';
import type ModeRuleService from '../mode/ModeRuleService';
import type FlagModeService from '../mode/FlagModeService';
import type ControlRegistryService from '../control/ControlRegistryService';
import type TouchInputService from '../control/TouchInputService';
import type NavWorldAdapterService from '../adapter/NavWorldAdapterService';
import type OnlineBattleAdapterService from '../adapter/OnlineBattleAdapterService';
import { engine } from '../../../engine';
import { online } from '../../../online';
import type LoadingScreenService from '../ui/LoadingScreenService';
import { TankRoster } from '../../../../engine/game/TankRoster';

export class BattleSessionService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly mapStageService = inject<MapStageService>(TYPES.mapStageService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly combatService = inject<CombatService>(TYPES.combatService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly cameraService = inject<CameraService>(TYPES.cameraService);
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);
  private readonly tankSpawnService = inject<TankSpawnService>(TYPES.tankSpawnService);
  private readonly battleLoopService = inject<BattleLoopService>(TYPES.battleLoopService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);
  private readonly controlRegistryService = inject<ControlRegistryService>(TYPES.controlRegistryService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);
  private readonly navWorldAdapterService = inject<NavWorldAdapterService>(TYPES.navWorldAdapterService);
  private readonly onlineBattleAdapterService = inject<OnlineBattleAdapterService>(TYPES.onlineBattleAdapterService);
  private readonly loadingScreenService = inject<LoadingScreenService>(TYPES.loadingScreenService);

  private starting = false;

  public get running(): boolean {
    return this.battleStateService.running;
  }

  /** Assembles and starts a battle. Throws (after cleanup) when loading fails. */
  public start = async (config: BattleConfig): Promise<void> => {
    if (this.starting) {
      return;
    }
    this.starting = true;
    try {
      if (this.running) {
        this.dispose();
      }
      const mapEntry = this.assetCatalogService.map(config.mapId);
      if (mapEntry == null) {
        throw new Error(`unknown map "${config.mapId}"`);
      }
      this.loadingScreenService.show('Entering battle', 'Map');
      const state = this.battleStateService;
      state.begin(config, mapEntry, new TankRoster());
      this.engineService.resetSimRoot();
      this.engineService.applyVisual(mapEntry.visual);
      this.engineService.start();

      const stage = await this.mapStageService.load(mapEntry, this.loadingScreenService);

      // Map reflection for the bots: the walkability grid over the static geometry.
      this.loadingScreenService.setPhase('Navigation');
      const world = this.navWorldAdapterService.world();
      const nav = await engine.botEngineService.prepareBattle(world, {
        mapId: mapEntry.id,
        fingerprint: `${stage.staticShapes.length}:${Math.round(world.bounds.minX)},${Math.round(world.bounds.minY)},${Math.round(world.bounds.maxX)},${Math.round(world.bounds.maxY)}:${Math.round(stage.killZ)}`,
        onProgress: (p) => this.loadingScreenService.setPhase(`Navigation ${Math.round((p.done / p.total) * 100)}%`),
      });
      this.loggerService.log(`navigation: ${nav.nodes} nodes in ${nav.buildMs.toFixed(0)} ms${nav.cached ? ' (cached)' : ''}`);

      this.loadingScreenService.setPhase('Effects');
      await this.effectsService.create(mapEntry.visual);
      this.scoreService.create(this.modeRuleService.isFlagMode(config.mode));
      await this.cameraService.create();
      this.combatService.create();
      this.clockService.reset();
      // A room's battle is as long as the room says (the lobby expires the listing by the same number).
      this.clockService.setDuration(config.online?.durationMs ?? null);
      this.clockService.setOnTimeUp(() => this.finish('time'));
      this.scoreService.onDeath((event) => {
        // Online, the host's clock starts here and the lobby hears it (its listing expires durationMs after this stamp).
        if (this.clockService.startOnFirstKill() && config.online != null) online.roomSessionService.reportPhase('playing');
        this.flagModeService.dropCarriedFlag(event.victim, state.timeMs);
      });

      this.loadingScreenService.setPhase('Tanks');
      await this.tankSpawnService.preload();
      const roster = this.modeRuleService.buildRoster(config);
      for (const descriptor of roster) {
        await this.tankSpawnService.spawn(descriptor);
      }
      this.respawnService.create();
      await this.flagModeService.setup(stage.ctfFlagPositions);
      this.placeAtSpawns();
      if (config.online != null) {
        // Multiplayer: the netcode takes over damage, deaths, spawns, flags
        // and the clock (host) or replays the host's word (replica); the
        // host's `sync` moves everyone to the same spawns within a moment.
        this.loadingScreenService.setPhase('Peers');
        online.netBattleService.start(this.onlineBattleAdapterService.create(), state.timeMs);
      }

      this.touchInputService.setEnabled(true);
      this.battleEventService.emit('teamScore', { red: 0, blue: 0 });
      state.setPhase('playing');
      this.battleLoopService.start();
      this.loadingScreenService.hide();
      this.loggerService.log('battle started', config.mode, config.mapId, roster.length, 'tanks');
    } catch (error) {
      this.loggerService.error('battle failed to start', error);
      this.dispose();
      this.loadingScreenService.fail(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.starting = false;
    }
  };

  public pause = (): void => {
    if (this.battleStateService.phase === 'playing') {
      this.touchInputService.setEnabled(false);
      this.battleStateService.setPhase('paused');
    }
  };

  public resume = (): void => {
    if (this.battleStateService.phase === 'paused') {
      this.touchInputService.setEnabled(true);
      this.battleStateService.setPhase('playing');
    }
  };

  /** The final whistle: the world freezes, the result screen takes over. */
  public finish = (reason: 'time' | 'left'): void => {
    if (!this.running || this.battleStateService.phase === 'over') {
      return;
    }
    this.touchInputService.setEnabled(false);
    for (const actor of this.battleStateService.actors()) {
      actor.gameTank.audio?.stopLoops();
    }
    this.battleStateService.setPhase('over');
    this.battleEventService.emit('finished', { reason });
    if (this.battleStateService.config.online != null) {
      // The host's whistle reaches the replicas and the lobby together (a no-op when the clock already blew it).
      online.netBattleService.announceFinish(reason);
      online.roomSessionService.reportPhase('finished');
    }
  };

  /** Tears the battle down (idempotent). */
  public dispose = (): void => {
    if (!this.battleStateService.running) {
      return;
    }
    this.battleLoopService.stop();
    online.netBattleService.stop();
    this.onlineBattleAdapterService.dispose();
    this.controlRegistryService.detachAll();
    this.touchInputService.setEnabled(false);
    for (const actor of [...this.battleStateService.actors()]) {
      actor.gameTank.audio?.stopLoops();
    }
    engine.botEngineService.disposeBattle();
    this.flagModeService.dispose();
    this.respawnService.dispose();
    this.combatService.dispose();
    this.cameraService.dispose();
    this.scoreService.dispose();
    this.effectsService.dispose();
    this.tankSpawnService.clear();
    this.mapStageService.unload();
    this.engineService.resetSimRoot();
    this.battleStateService.end();
    this.battleEventService.clear();
    this.loggerService.log('battle disposed');
  };

  private placeAtSpawns(): void {
    const stage = this.battleStateService.mapStage;
    const actors = this.battleStateService.actors();
    if (stage.spawnPoints.length > 0) {
      for (const actor of actors) {
        actor.gameTank.spawnAt(stage.spawnPoints);
      }
      return;
    }
    actors.forEach((actor, index) => {
      const angle = (index / Math.max(1, actors.length)) * Math.PI * 2;
      actor.gameTank.spawnAtPoint({
        type: 'dm',
        position: new Vector3(Math.cos(angle) * 850, Math.sin(angle) * 850, 50),
        rotationZ: angle + Math.PI,
      });
    });
  }
}

export default BattleSessionService;
