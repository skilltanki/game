// The bot engine's front door. The battle hands it the static world once
// (prepareBattle builds the grid) and a BotPerception per bot
// (createSource); it hands back ControlSources that, once per physics
// tick, perceive -> decide -> plan/steer -> aim -> push ONE TankCommand.
import { BotMemory } from '../../../../classes/engine/BotMemory';
import type { NavGrid } from '../../../../classes/engine/NavGrid';
import { Rng } from '../../../../classes/engine/Rng';
import type { BotDifficulty } from '../../../../model/BattleConfig';
import type { CommandSink, ControlSource, ControlSourceEnv } from '../../../../model/ControlSource';
import type { BotPerception } from '../../../../model/Perception';
import { createCommand, type TankCommand } from '../../../../model/TankCommand';
import { DEFAULT_NAV_PARAMS, type NavBuildProgress, type NavParams } from '../../../../model/engine/Nav';
import type { StaticWorld } from '../../../../model/engine/World';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type NavGridBuildService from '../nav/NavGridBuildService';
import type NavGraphService from '../nav/NavGraphService';
import type PathfindingService from '../nav/PathfindingService';
import type NavQueryService from '../nav/NavQueryService';
import type NavCacheService from '../nav/NavCacheService';
import type LearnedBlockService from '../nav/LearnedBlockService';
import type NavigatorService from '../motion/NavigatorService';
import type StuckRecoveryService from '../motion/StuckRecoveryService';
import type GunnerService from '../tactics/GunnerService';
import type TriggerService from '../tactics/TriggerService';
import type SupplyService from '../tactics/SupplyService';
import type StrategyService from './StrategyService';
import type PersonaService from './PersonaService';
import type { BotPersona } from '../../../../model/engine/Persona';
import type NavDebugService from '../public/NavDebugService';
import type BlackboardService from '../squad/BlackboardService';
import type RoleAuctionService from '../squad/RoleAuctionService';
import type SightingService from '../tactics/SightingService';
import type ThreatMapService from '../tactics/ThreatMapService';
import type MedicService from '../tactics/MedicService';
import type ExposureService from '../insight/ExposureService';
import type MapInsightService from '../insight/MapInsightService';
import type { CostLayer } from '../../../../model/engine/Nav';
import type BenchService from '../public/BenchService';

export interface BotActorRef {
  id: string;
  perception: BotPerception;
  difficulty: BotDifficulty;
  /** Per-bot seed; the same seed replays the same decisions. */
  seed: number;
}

export interface PrepareOptions {
  mapId: string;
  /** Anything that changes when the map's geometry changes (shape count, bounds); keys the cache. */
  fingerprint?: string;
  params?: Partial<NavParams>;
  onProgress?: (progress: NavBuildProgress) => void;
}

export interface PrepareResult {
  nodes: number;
  buildMs: number;
  /** The grid came from the IndexedDB cache instead of being built. */
  cached: boolean;
}

interface BotRuntime {
  ref: BotActorRef;
  memory: BotMemory;
  rng: Rng;
  persona: BotPersona;
  sink: CommandSink | null;
  index: number;
  wasDead: boolean;
}

/** How long the turret keeps its last aim after losing the target before centring. */
const TURRET_HOLD_MS = 2500;

export class BotEngineService {
  private readonly navGridBuildService = inject<NavGridBuildService>(TYPES.navGridBuildService);
  private readonly navGraphService = inject<NavGraphService>(TYPES.navGraphService);
  private readonly pathfindingService = inject<PathfindingService>(TYPES.pathfindingService);
  private readonly navQueryService = inject<NavQueryService>(TYPES.navQueryService);
  private readonly navCacheService = inject<NavCacheService>(TYPES.navCacheService);
  private readonly learnedBlockService = inject<LearnedBlockService>(TYPES.learnedBlockService);
  private readonly navigatorService = inject<NavigatorService>(TYPES.navigatorService);
  private readonly stuckRecoveryService = inject<StuckRecoveryService>(TYPES.stuckRecoveryService);
  private readonly gunnerService = inject<GunnerService>(TYPES.gunnerService);
  private readonly triggerService = inject<TriggerService>(TYPES.triggerService);
  private readonly supplyService = inject<SupplyService>(TYPES.supplyService);
  private readonly strategyService = inject<StrategyService>(TYPES.strategyService);
  private readonly personaService = inject<PersonaService>(TYPES.personaService);
  private readonly navDebugService = inject<NavDebugService>(TYPES.navDebugService);
  private readonly benchService = inject<BenchService>(TYPES.benchService);
  private readonly blackboardService = inject<BlackboardService>(TYPES.blackboardService);
  private readonly roleAuctionService = inject<RoleAuctionService>(TYPES.roleAuctionService);
  private readonly sightingService = inject<SightingService>(TYPES.sightingService);
  private readonly threatMapService = inject<ThreatMapService>(TYPES.threatMapService);
  private readonly medicService = inject<MedicService>(TYPES.medicService);
  private readonly exposureService = inject<ExposureService>(TYPES.exposureService);
  private readonly mapInsightService = inject<MapInsightService>(TYPES.mapInsightService);
  private readonly noLayers: CostLayer[] = [];

  private grid: NavGrid | null = null;
  private readonly runtimes = new Map<string, BotRuntime>();
  private botCounter = 0;

  public get currentGrid(): NavGrid | null {
    return this.grid;
  }

  /** Reflects the map into the walkability graph. Call once per battle, before the bots start. */
  public prepareBattle = async (world: StaticWorld, options: PrepareOptions): Promise<PrepareResult> => {
    this.disposeBattle();
    const started = performance.now();
    const params: NavParams = { ...DEFAULT_NAV_PARAMS, ...options.params };
    const cacheKey = options.fingerprint != null ? this.navCacheService.key(options.mapId, options.fingerprint, params) : null;
    let grid = cacheKey != null ? await this.navCacheService.load(cacheKey) : null;
    const cached = grid != null;
    if (grid == null) {
      grid = await this.navGridBuildService.build(world, params, options.onProgress);
      this.navGraphService.build(grid);
      await this.exposureService.measure(grid, world, options.onProgress);
      if (cacheKey != null) {
        void this.navCacheService.store(cacheKey, grid);
      }
    }
    this.grid = grid;
    this.pathfindingService.attach(grid);
    this.navQueryService.attach(grid);
    this.navDebugService.attach(grid);
    this.mapInsightService.attach(grid);
    this.navigatorService.setHooks({
      onPathRequest: (ok) => this.benchService.recordPathRequest(ok),
      onPath: (actorId, points) => {
        this.navDebugService.recordPath(actorId, points);
        const runtime = this.runtimes.get(actorId);
        if (runtime != null) {
          this.blackboardService.boardFor(runtime.ref.perception.self.team).paths.set(actorId, points);
        }
      },
    });
    this.stuckRecoveryService.setOnStuck((_id, at, now) => {
      this.benchService.recordStuck();
      this.learnedBlockService.mark(at, now);
    });
    this.learnedBlockService.attach(grid);
    const buildMs = performance.now() - started;
    this.benchService.recordGrid(grid.nodeCount, buildMs);
    return { nodes: grid.nodeCount, buildMs, cached };
  };

  public disposeBattle = (): void => {
    this.runtimes.clear();
    this.strategyService.clear();
    this.blackboardService.clear();
    this.botCounter = 0;
    this.grid = null;
    this.pathfindingService.attach(null);
    this.navQueryService.attach(null);
    this.navDebugService.attach(null);
    this.mapInsightService.attach(null);
    this.learnedBlockService.attach(null);
  };

  public createSource = (ref: BotActorRef): ControlSource => {
    const self = this;
    return {
      kind: 'bot',
      async start(sink: CommandSink, _env: ControlSourceEnv): Promise<void> {
        const runtime: BotRuntime = {
          ref,
          memory: new BotMemory(),
          rng: new Rng(ref.seed),
          persona: self.personaService.create(ref.difficulty, ref.seed),
          sink,
          index: self.botCounter++,
          wasDead: false,
        };
        self.runtimes.set(ref.id, runtime);
        self.blackboardService.join(ref.id, ref.perception);
        // The perception may not be complete yet (flags come after spawn): roles are assigned on the first tick.
        runtime.wasDead = true;
      },
      tick(_tick: number, dtSec: number): void {
        const runtime = self.runtimes.get(ref.id);
        if (runtime?.sink == null) return;
        const started = performance.now();
        runtime.sink.push(self.think(runtime, dtSec));
        self.benchService.recordTick(performance.now() - started);
      },
      stop(): void {
        self.runtimes.delete(ref.id);
        self.strategyService.forget(ref.id);
        self.blackboardService.leave(ref.id);
      },
    };
  };

  /** Perceive -> decide -> plan & steer -> aim -> one command. */
  private think(runtime: BotRuntime, dtSec: number): TankCommand {
    const { memory, rng } = runtime;
    const perception = runtime.ref.perception;
    const self = perception.self;
    if (!self.alive) {
      runtime.wasDead = true;
      return createCommand();
    }
    if (runtime.wasDead) {
      // Fresh life: forget the old chase, maybe a new role.
      runtime.wasDead = false;
      memory.reset();
      this.strategyService.assignRole(perception, memory, runtime.index);
    }
    // Flipped onto the roof: nothing drives, and it is not "stuck" either; the
    // engine rights an overturned tank after 6 s (respawn.ts OVERTURN_FLIP_MS).
    if (!self.upright) {
      if (memory.overturnedSince === 0) memory.overturnedSince = perception.now;
      return createCommand();
    }
    memory.overturnedSince = 0;
    // Squad bookkeeping: report what I see; once a second the team re-auctions roles and refreshes its threat map.
    const board = this.blackboardService.boardFor(self.team);
    this.sightingService.observe(perception, board);
    this.roleAuctionService.assign(board, perception.now);
    if (this.grid != null) {
      this.threatMapService.update(board, this.grid, perception.now);
    }
    const objective = this.strategyService.decide(perception, memory, runtime.persona, rng);
    const profile = this.personaService.gunnerProfile(runtime.ref.difficulty, runtime.persona);
    // A carrier plans around known enemies; everyone routes around spots that just jammed a hull.
    const learned = this.learnedBlockService.layerAt(perception.now);
    const layers: CostLayer[] = self.carriesFlag != null && board.threat != null ? [board.threat] : [];
    if (learned != null) layers.push(learned);
    if (layers.length === 0) layers.push(...this.noLayers);

    const preferred = objective.kind === 'hunt' ? objective.target : null;
    const engage = objective.kind !== 'goto' || objective.engage;
    // An Isida with a wounded teammate in reach heals instead of shooting.
    const patient = this.medicService.pickPatient(perception, this.strategyService.teamContext(perception));
    const target = patient ?? (engage ? this.gunnerService.pickTarget(perception, preferred, profile) : null);
    const gun = this.gunnerService.aim(perception, memory, target, profile, dtSec);
    if (gun.target != null) memory.lastTargetAt = perception.now;
    // The finger: a held trigger for most turrets, taps and charges for one that fires on release (the Shaft).
    const trigger = this.triggerService.decide(perception, memory, gun);
    const steer = this.navigatorService.steer(perception, memory, rng, objective, dtSec, layers);
    const supply = this.supplyService.pick(perception, memory, gun.target, runtime.ref.difficulty);

    return createCommand({
      move: steer.move,
      turn: steer.turn,
      turretTarget: gun.turretTarget,
      aimPoint: gun.aimPoint,
      fire: trigger.fire,
      pitch: trigger.pitch,
      supply,
      // No target: the turret holds its last aim for a moment (a tank ducking
      // behind cover comes back), then returns to the hull's nose and stays
      // there. The original bot's endless idle sweep read as a glitch on a phone.
      turret: 0,
      turretCenter: gun.target == null && perception.now - memory.lastTargetAt > TURRET_HOLD_MS,
    });
  }
}

export default BotEngineService;
