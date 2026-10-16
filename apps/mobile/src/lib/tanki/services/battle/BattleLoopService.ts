// The per-frame battle loop: fixed 33 ms physics steps with render
// interpolation on top (the BattleRunner pattern). Port of
// logic/battleLoop.ts, with one difference that is the whole point of the
// mobile client: every tank — human, bot, remote — is driven by the command
// its ControlSource delivered for this tick, through the one TankDriver.
import * as pc from 'playcanvas';
import { ShaftWeapon } from '../../../../engine/weapon/ShaftWeapon';
import { ProjectileWeapon } from '../../../../engine/weapon/ProjectileWeapon';
import { SUPPLY_TYPES } from '../../../../engine/game/Supplies';
import { CC_PHYSICS_STEP_MS } from '../../../../config/params';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type EngineService from '../base/EngineService';
import type BattleStateService from './BattleStateService';
import type EffectsService from './EffectsService';
import type RespawnService from './RespawnService';
import type SupplyRuleService from './SupplyRuleService';
import type CameraService from './CameraService';
import type ClockService from './ClockService';
import type TankSpawnService from './TankSpawnService';
import type ControlRegistryService from '../control/ControlRegistryService';
import type TankDriverService from '../control/TankDriverService';
import type FlagModeService from '../mode/FlagModeService';
import type HudService from '../ui/HudService';
import type MapSceneLoaderService from '../scene/MapSceneLoaderService';
import { online } from '../../../online';

export class BattleLoopService {
  private readonly engineService = inject<EngineService>(TYPES.engineService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);
  private readonly supplyRuleService = inject<SupplyRuleService>(TYPES.supplyRuleService);
  private readonly cameraService = inject<CameraService>(TYPES.cameraService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly tankSpawnService = inject<TankSpawnService>(TYPES.tankSpawnService);
  private readonly controlRegistryService = inject<ControlRegistryService>(TYPES.controlRegistryService);
  private readonly tankDriverService = inject<TankDriverService>(TYPES.tankDriverService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);
  private readonly hudService = inject<HudService>(TYPES.hudService);
  private readonly mapSceneLoaderService = inject<MapSceneLoaderService>(TYPES.mapSceneLoaderService);

  private detach: (() => void) | null = null;
  private readonly camSimPos = new pc.Vec3();
  private readonly invSimRoot = new pc.Mat4();
  private readonly overheadWorld = new pc.Vec3();
  private readonly overheadScreen = new pc.Vec3();
  private readonly toOverhead = new pc.Vec3();
  private bushesHidden = false;

  public start = (): void => {
    this.stop();
    this.bushesHidden = false;
    this.detach = this.engineService.onUpdate(this.onFrame);
  };

  public stop = (): void => {
    this.detach?.();
    this.detach = null;
  };

  // --- frame -----------------------------------------------------------------

  private onFrame = (dtSec: number): void => {
    const state = this.battleStateService;
    // Online, a pause is only the box over the screen: the world goes on (the
    // bots this machine drives keep thinking and streaming, the player's own
    // tank stands where it is and can be hit), or the other players would
    // see every tank from this machine freeze and the player sit immune.
    const live = state.phase === 'playing' || (state.phase === 'paused' && state.config.online != null);
    if (!state.running || !live) {
      // Paused / over / loading: the world stands still and no frame time
      // accumulates, so resuming does not fast-forward.
      state.stepper.drain();
      return;
    }
    state.stepper.advance(dtSec * 1000, this.step);
    this.render(dtSec);
  };

  // --- one physics step ------------------------------------------------------

  private step = (tick: number, timeMs: number, dtSec: number): void => {
    const state = this.battleStateService;
    const physics = state.physics;
    const actors = state.actors();
    const net = state.config.online != null;

    // 0. Online: the replicas take their owners' latest poses.
    if (net) online.netBattleService.beforeStep(timeMs);
    // 1. Every control source delivers its command for this tick.
    this.controlRegistryService.collect(tick, dtSec);
    // 2. The driver applies them — the same code path for all three kinds.
    for (const actor of actors) {
      if (actor.lastCommand != null) {
        this.tankDriverService.apply(actor, actor.lastCommand, dtSec);
      }
    }
    // 3. Physics.
    for (const actor of actors) {
      actor.gameTank.runBeforePhysicsUpdate(dtSec);
    }
    physics.update(CC_PHYSICS_STEP_MS);
    const detector = physics.getCollisionDetector();
    for (const actor of actors) {
      actor.gameTank.tank.setSimTime(timeMs);
      actor.gameTank.runAfterPhysicsUpdate();
      actor.gameTank.updateWeapon(timeMs, detector);
    }
    // 4. Per-step systems, in the engine's order.
    this.effectsService.effects.dust.update();
    for (const actor of actors) {
      this.supplyRuleService.detectHits(actor);
      actor.supplies.update(CC_PHYSICS_STEP_MS);
      this.supplyRuleService.rememberHealth(actor);
    }
    this.respawnService.stepSuicide();
    this.effectsService.status.applyStep(timeMs);
    this.respawnService.stepOverturn();
    this.respawnService.stepDeaths();
    this.flagModeService.step(timeMs);
    this.clockService.step();
    // 5. Online: publish this machine's command and pose; the host decides deaths, spawns, the clock.
    if (net && state.running) online.netBattleService.afterStep(tick, timeMs);
  };

  // --- render pass -----------------------------------------------------------

  private render(dtSec: number): void {
    const state = this.battleStateService;
    const effects = this.effectsService.effects;
    const dtMs = dtSec * 1000;
    const timeMs = state.timeMs;
    const camSimPos = this.camSimPos;
    const actors = state.actors();
    const local = state.hasLocal ? state.local : null;

    effects.tracers.update(dtMs);
    this.cameraService.updateShake(dtMs);
    effects.railgunShot.update(dtMs, camSimPos);
    effects.hitEffects.update(dtMs, camSimPos);
    this.effectsService.status.renderTick(timeMs);

    const localTank = local?.gameTank ?? null;
    const shaftAim = localTank?.weapon instanceof ShaftWeapon ? localTank.weapon.getAimFraction(timeMs) : 0;
    // The player's own plate (hp bar, call sign, effect icons) is never
    // drawn: the HUD shows all of it, and on a phone it only hides the aim.
    localTank?.setOverheadVisible(false);
    for (const laser of this.tankSpawnService.laserSights()) {
      const owner = laser.getOwner();
      const ownerAiming = owner.weapon instanceof ShaftWeapon ? owner.weapon.isAiming() : true;
      laser.update(camSimPos, ownerAiming);
    }
    for (const beam of this.tankSpawnService.isidaBeams()) {
      beam.update(dtMs, camSimPos);
    }
    for (const actor of actors) {
      actor.gameTank.audio?.update(dtSec);
    }

    // Camera position in sim space (billboards turn around sim Z).
    const simRoot = this.engineService.simRoot;
    const camera = this.engineService.camera;
    this.invSimRoot.copy(simRoot.getWorldTransform()).invert();
    this.invSimRoot.transformPoint(camera.getPosition(), camSimPos);
    state.mapStage.skyBox?.update(camSimPos);

    const alpha = state.stepper.alpha;
    for (const actor of actors) {
      actor.gameTank.updateRender(alpha, camSimPos, dtSec);
      if (actor.gameTank.weapon instanceof ProjectileWeapon) {
        actor.gameTank.weapon.updateBillboards(camSimPos);
      }
    }
    // After the tanks: a carried flag reads its carrier's interpolated pose.
    this.flagModeService.render(camSimPos);

    this.cameraService.renderTick(dtSec, shaftAim);
    // Spawn-protection blink: visual children only, so sounds keep playing.
    for (const actor of actors) {
      const blinkHidden = actor.gameTank.tank.isInvulnerable() && timeMs % 300 < 120;
      actor.gameTank.setVisible(!blinkHidden);
    }
    // Active effect icons over every tank with running supplies; the repair
    // kit shows for HEAL_ICON_MS after use even though its heal is instant.
    for (const actor of actors) {
      actor.gameTank.setActiveEffects(
        SUPPLY_TYPES.filter((t) => (t === 'health' ? timeMs < actor.healShownUntil : actor.supplies.getState(t).active)),
      );
    }

    if (local != null) {
      // A screen anchor just above the hull, for the HUD's floating effect
      // chips (the engine's own 3D plate stays hidden for the local tank).
      let overhead: { x: number; y: number } | null = null;
      const tankWorld = local.gameTank.entity.getPosition();
      this.overheadWorld.set(tankWorld.x, tankWorld.y + local.gameTank.hullSize.z * 0.01 + 0.9, tankWorld.z);
      this.toOverhead.sub2(this.overheadWorld, camera.getPosition());
      if (this.toOverhead.dot(camera.forward) > 0.1) {
        camera.camera!.worldToScreen(this.overheadWorld, this.overheadScreen);
        overhead = { x: this.overheadScreen.x, y: this.overheadScreen.y };
      }
      this.hudService.frame({
        health: local.gameTank.tank.health,
        maxHealth: local.gameTank.tank.maxHealth,
        dead: local.gameTank.tank.isDead(),
        reload: local.gameTank.weapon.getStatus(timeMs),
        supplies: local.supplies,
        suicideProgress: this.respawnService.suicideProgress,
        overturned: this.respawnService.isOverturnWarning(local.gameTank),
        shaftAim,
        overhead,
        healShownMsLeft: Math.max(0, local.healShownUntil - timeMs),
      });
    }

    // Sprite props (bushes) hide while the Shaft scope sits at barrel height.
    const hideBushes = shaftAim > 0.01;
    const billboards = state.mapStage.billboards;
    if (hideBushes !== this.bushesHidden) {
      this.bushesHidden = hideBushes;
      for (const sprite of billboards) {
        sprite.enabled = !hideBushes;
      }
    }
    if (!this.bushesHidden) {
      this.mapSceneLoaderService.faceBillboards(billboards, camSimPos);
    }
  }
}

export default BattleLoopService;
