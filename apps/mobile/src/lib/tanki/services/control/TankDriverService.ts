// Applies a TankCommand to a tank. This is the ONLY code that calls
// setMovementParams / the turret controller / setTrigger on a GameTank, so
// humans, bots and remote peers cannot drift apart in what they can do.
import { ShaftWeapon } from '../../../../engine/weapon/ShaftWeapon';
import { Vector3 } from '../../../../engine/math/Vector3';
import type { TankActor } from '../../../../classes/TankActor';
import type { TankCommand } from '../../../../model/TankCommand';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type RespawnService from '../battle/RespawnService';
import type CameraService from '../battle/CameraService';
import type BattleStateService from '../battle/BattleStateService';
import type SupplyRuleService from '../battle/SupplyRuleService';
import type BattleEventService from '../battle/BattleEventService';

/** How fast the stick sweeps the Shaft's barrel in sniper mode, rad/s. */
const SHAFT_PITCH_SPEED = (25 * Math.PI) / 180;
/** Sniper-mode elevation limits (ProTanki shots-data: asymmetric). */
const SHAFT_AIM_MAX_PITCH_UP = (12 * Math.PI) / 180;
const SHAFT_AIM_MAX_PITCH_DOWN = (15 * Math.PI) / 180;

const _target = new Vector3();
/** How long the repair-kit icon stays over a tank after use. */
export const HEAL_ICON_MS = 5000;

export class TankDriverService {
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);
  private readonly cameraService = inject<CameraService>(TYPES.cameraService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly supplyRuleService = inject<SupplyRuleService>(TYPES.supplyRuleService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);

  public apply = (actor: TankActor, command: TankCommand, dtSec: number): void => {
    const gameTank = actor.gameTank;
    const tank = gameTank.tank;
    const dead = tank.isDead();

    // --- hull --------------------------------------------------------------
    const shaftTargeting = gameTank.weapon instanceof ShaftWeapon && gameTank.weapon.isAiming();
    if (!dead) {
      tank.setMovementParams(shaftTargeting ? 0 : command.move, command.turn, command.reverseBackTurn);
      if (shaftTargeting) {
        // Sniper mode: the drive axis elevates the gun by hand instead.
        const manual = command.pitch;
        if (manual != null) {
          actor.shaftPitch = Math.max(-SHAFT_AIM_MAX_PITCH_DOWN, Math.min(SHAFT_AIM_MAX_PITCH_UP, manual));
        } else {
          actor.shaftPitch = Math.max(
            -SHAFT_AIM_MAX_PITCH_DOWN,
            Math.min(SHAFT_AIM_MAX_PITCH_UP, actor.shaftPitch + command.move * SHAFT_PITCH_SPEED * dtSec),
          );
        }
        gameTank.manualPitch = actor.shaftPitch;
      } else {
        gameTank.manualPitch = null;
        actor.shaftPitch = 0;
      }
    } else {
      tank.setMovementParams(0, 0, false);
      gameTank.manualPitch = null;
    }

    // --- turret ------------------------------------------------------------
    const turret = tank.turretController;
    const tracking = command.turretTarget != null && !dead;
    // World-stabilised turret only while tracking a point: the gyroscope keeps
    // the aim through the hull's own turns, but with nothing to track it would
    // make the turret appear to spin every time the hull turns.
    turret.setGyroscopePower(tracking ? 1 : 0);
    if (tracking) {
      _target.reset(command.turretTarget!.x, command.turretTarget!.y, command.turretTarget!.z);
      gameTank.aimTurretAt(_target);
    } else {
      turret.rotateLeft(command.turret > 0 && !dead);
      turret.rotateRight(command.turret < 0 && !dead);
      turret.center(command.turretCenter && !dead);
    }

    // --- shot direction (aim assist) ---------------------------------------
    if (command.aimPoint != null) {
      if (gameTank.aimPoint == null) {
        gameTank.aimPoint = new Vector3();
      }
      gameTank.aimPoint.reset(command.aimPoint.x, command.aimPoint.y, command.aimPoint.z);
    } else {
      gameTank.aimPoint = null;
    }

    // --- trigger -----------------------------------------------------------
    gameTank.setTrigger(command.fire && !dead);

    // --- supplies (one-shot) ------------------------------------------------
    if (command.supply != null && !dead) {
      const activated = actor.supplies.activate(command.supply);
      if (activated) {
        this.battleEventService.emit('supply', { actorId: actor.id, kind: command.supply, local: actor.isLocal });
      }
      if (activated && command.supply === 'health') {
        // The kit heals in a blink; the icon lingers so everyone sees it.
        actor.healShownUntil = this.battleStateService.timeMs + HEAL_ICON_MS;
        // Only hits from now on may interrupt it, not the one that prompted it.
        this.supplyRuleService.rememberHealth(actor);
      }
    }

    // --- self-destruct (held) -----------------------------------------------
    this.respawnService.setSuicideHeld(actor, command.selfDestruct && !dead);

    // --- camera (local presentation only) -------------------------------------
    if (actor.isLocal) {
      this.cameraService.setTilt(command.cameraTilt);
    }
  };
}

export default TankDriverService;
