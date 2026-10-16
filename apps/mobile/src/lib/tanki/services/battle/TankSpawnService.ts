// Builds tanks from descriptors and wires them into every battle subsystem
// in ONE place: the engine's GameTank, the roster, dust, score, audio, the
// Shaft laser / Isida beam, supplies, and — the mobile client's addition —
// the control source that will drive it. The reverse (despawn) undoes the
// same set, which is what a dynamic roster (players joining later) needs.
import { GameTank } from '../../../../engine/game/GameTank';
import { Supplies } from '../../../../engine/game/Supplies';
import { TankAudio } from '../../../../engine/game/TankAudio';
import { ProjectileWeapon } from '../../../../engine/weapon/ProjectileWeapon';
import { StreamWeapon } from '../../../../engine/weapon/StreamWeapon';
import { LaserSight } from '../../../../engine/weapon/LaserSight';
import { IsidaBeam } from '../../../../engine/weapon/IsidaBeam';
import { TankState } from '../../../../engine/game/TankRoster';
import { TankActor } from '../../../../classes/TankActor';
import type { ActorDescriptor, BotDifficulty } from '../../../../model/BattleConfig';
import type { ControlSource } from '../../../../model/ControlSource';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type EngineService from '../base/EngineService';
import type AssetCatalogService from '../asset/AssetCatalogService';
import type BattleStateService from './BattleStateService';
import type EffectsService from './EffectsService';
import type CombatService from './CombatService';
import type ScoreService from './ScoreService';
import type RespawnService from './RespawnService';
import type FlagModeService from '../mode/FlagModeService';
import type TouchInputService from '../control/TouchInputService';
import type PerceptionAdapterService from '../adapter/PerceptionAdapterService';
import { engine } from '../../../engine';
import { online } from '../../../online';
import type ControlRegistryService from '../control/ControlRegistryService';

/** Bots traverse their turret 15% slower than the player (original tuning). */
const BOT_TURRET_FACTOR = 0.85;
const TURRET_SPEED = 1.7;
const TURRET_ACCELERATION = 3.4;

export class TankSpawnService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly assetCatalogService = inject<AssetCatalogService>(TYPES.assetCatalogService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly combatService = inject<CombatService>(TYPES.combatService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);
  private readonly touchInputService = inject<TouchInputService>(TYPES.touchInputService);
  private readonly perceptionAdapterService = inject<PerceptionAdapterService>(TYPES.perceptionAdapterService);
  private readonly controlRegistryService = inject<ControlRegistryService>(TYPES.controlRegistryService);

  private readonly lasers = new TankState<LaserSight>();
  private readonly beams = new TankState<IsidaBeam>();
  private audioLoaded = false;

  /** Shared samples, once per app. */
  public preload = async (): Promise<void> => {
    if (!this.audioLoaded) {
      await TankAudio.loadShared(this.engineService.app);
      this.audioLoaded = true;
    }
  };

  public spawn = async (descriptor: ActorDescriptor): Promise<TankActor> => {
    const app = this.engineService.app;
    const simRoot = this.engineService.simRoot;
    const physics = this.battleStateService.physics;
    const isBot = descriptor.control === 'bot';
    let gameTank!: GameTank;
    gameTank = await GameTank.create(app, simRoot, physics, {
      id: descriptor.id,
      name: descriptor.name,
      hull: descriptor.loadout.hull,
      turret: descriptor.loadout.turret,
      modification: descriptor.loadout.modification,
      team: descriptor.team,
      paint: descriptor.loadout.paint,
      turretRotationSpeed: isBot ? TURRET_SPEED * BOT_TURRET_FACTOR : TURRET_SPEED,
      turretRotationAcceleration: isBot ? TURRET_ACCELERATION * BOT_TURRET_FACTOR : TURRET_ACCELERATION,
      weaponListener: this.combatService.listenerFor(descriptor.team, () => gameTank, descriptor.loadout.turret),
      getAllTanks: () => this.battleStateService.tanks(),
      ownTank: descriptor.control === 'touch',
      assets: this.assetCatalogService.tankAssets,
    });

    // --- wiring (mirror of the desktop TankFactory.addTankToBattle) ---------
    this.battleStateService.roster.add(gameTank);
    const weapon = gameTank.weapon;
    if (gameTank.turretName === 'Twins' && weapon instanceof ProjectileWeapon) {
      weapon.onExpire = (position) => this.effectsService.effects.hitEffects.spawnSheet('fade_Twins', position, 120, 420);
    }
    if (descriptor.control === 'remote' && weapon instanceof StreamWeapon) {
      // A replica's jet is driven by the owner's trigger; its own gauge must never cut it short.
      weapon.infiniteEnergy = true;
    }
    this.effectsService.effects.addTankDust(gameTank);
    this.scoreService.register(gameTank);
    gameTank.audio = await TankAudio.create(app, gameTank, gameTank.turretName);
    if (gameTank.turretName === 'Shaft') {
      this.lasers.set(gameTank, await LaserSight.create(app, simRoot, gameTank, physics.getCollisionDetector()));
    }
    if (gameTank.turretName === 'Isida') {
      this.beams.set(gameTank, await IsidaBeam.create(app, simRoot, gameTank));
    }
    this.flagModeService.lockPickup(gameTank, this.battleStateService.timeMs);

    // --- the mobile layer: supplies for everyone, a control source each ----
    const supplies = new Supplies(gameTank);
    const actor = new TankActor(descriptor, gameTank, supplies, IDLE_CONTROL);
    actor.control = this.controlFor(descriptor, actor);
    this.respawnService.registerSupplies(actor);
    this.battleStateService.addActor(actor);
    await this.controlRegistryService.attach(actor);
    this.loggerService.log('spawned', descriptor.id, descriptor.loadout.hull, descriptor.loadout.turret, descriptor.team);
    return actor;
  };

  public despawn = (actor: TankActor): void => {
    const gameTank = actor.gameTank;
    this.controlRegistryService.detach(actor);
    this.battleStateService.physics.removeBody(gameTank.tank.tankBody);
    gameTank.audio?.stopLoops();
    gameTank.setVisible(false);
    gameTank.setOverheadVisible(false);
    gameTank.entity.enabled = false;
    this.effectsService.effects.dust.removeTank(gameTank.tank);
    this.scoreService.unregister(gameTank);
    this.respawnService.unregisterSupplies(actor);
    this.perceptionAdapterService.forget(actor.id);
    this.lasers.delete(gameTank);
    this.beams.delete(gameTank);
    this.battleStateService.roster.remove(gameTank.id);
    this.battleStateService.removeActor(actor.id);
  };

  public laserSights = (): LaserSight[] => [...this.lasers.all()];

  public isidaBeams = (): IsidaBeam[] => [...this.beams.all()];

  public clear = (): void => {
    this.lasers.clear();
    this.beams.clear();
    this.perceptionAdapterService.clear();
  };

  /** Battle seed (config or random) folded with the actor id, so every bot differs but a bench replays. */
  private seedFor(actorId: string): number {
    let hash = (this.battleStateService.config.seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    for (let i = 0; i < actorId.length; i++) {
      hash = Math.imul(hash ^ actorId.charCodeAt(i), 0x01000193) >>> 0;
    }
    return hash;
  }

  /** A bot brain for an existing actor (the host seat moved here): ControlRegistryService.replace does the swap. */
  public botSource = (actor: TankActor, difficulty: BotDifficulty): ControlSource =>
    engine.botEngineService.createSource({
      id: actor.id,
      perception: this.perceptionAdapterService.build(actor),
      difficulty,
      seed: this.seedFor(actor.id),
    });

  /** The owner's command stream for an existing actor (the host seat moved away). */
  public remoteSource = (actor: TankActor): ControlSource => online.netBattleService.createSource(actor.id);

  private controlFor(descriptor: ActorDescriptor, actor: TankActor): ControlSource {
    switch (descriptor.control) {
      case 'touch':
        return this.touchInputService.createSource();
      case 'bot':
        return engine.botEngineService.createSource({
          id: actor.id,
          perception: this.perceptionAdapterService.build(actor),
          difficulty: descriptor.difficulty ?? 'normal',
          seed: this.seedFor(actor.id),
        });
      case 'remote':
        // The owner's commands over the mesh (lib/online).
        return online.netBattleService.createSource(actor.id);
      default:
        return IDLE_CONTROL;
    }
  }
}

/** A source that never speaks: the buffer repeats an idle command. */
const IDLE_CONTROL: ControlSource = { kind: 'none', async start() {}, stop() {} };

export default TankSpawnService;
