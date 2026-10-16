// What a SHOT looks and sounds like, and what a kill does: the per-turret shot
// presentation (tracers, shells, muzzle flashes, explosions), hit bookkeeping
// (lastHitBy, burn/chill statuses), the lethal-hit ceremony and the wreck's
// mushroom cloud. Moved verbatim from main.ts; behavior is 1:1.
import { Vector3 } from '../math/Vector3';
import type { ShotResult } from '../weapon/RailgunWeapon';
import type { TeamType } from '../tank/Tank';
import type { GameTank } from '../game/GameTank';
import type { TankRoster } from '../game/TankRoster';
import type { BattleScore } from '../game/BattleScore';
import type { StatusEffects } from './statusEffects';
import { MUZZLE_SIZE, STREAM_SPRITE, VISUAL_SHELL_SPEED, type BattleEffects } from './effects';

export interface ShakePreset {
  ms: number;
  radius: number;
}

// Shake presets: firing our own gun vs taking a hit. Radii are a third of
// the first pass — the original amplitude read as a rendering glitch rather
// than an impact.
export const SHAKE_SHOT: ShakePreset = { ms: 220, radius: 9 };
export const SHAKE_HIT: ShakePreset = { ms: 420, radius: 20 };
/**
 * Turrets that never kick the camera on their own shot: the three stream
 * guns and Twins. Their fire interval (160-180 ms stream ticks, 175 ms for
 * Twins) is shorter than the 220 ms shake, so every shot would restart it.
 */
const NO_SHAKE_TURRETS = new Set(['Firebird', 'Freeze', 'Isida', 'Twins']);
// Turrets whose mp3 is a charge-up that resolves into the discharge: the
// sound starts with the charge, not with the shot.
const CHARGING_TURRETS = new Set(['Railgun']);
/** Death-blast cloud height, in hull lengths. */
const MUSHROOM_HULL_LENGTHS = 3;

export interface CombatDeps {
  effects: BattleEffects;
  statusEffects: StatusEffects;
  roster: TankRoster;
  battleScore: BattleScore;
  getNow(): number;
  shakeCamera(preset: ShakePreset): void;
  /**
   * Network seam: may THIS machine set burn/freeze for a hit by `shooter`?
   * Absent = always (single player). Online only the host decides statuses
   * (its own and its bots' hits here, the peers' hits from their claims); a
   * replica's weapon firing on an observer must not chill anyone.
   */
  statusAuthority?(shooter: GameTank | null): boolean;
}

export interface CombatPresenter {
  onChargeFor(getShooter: () => GameTank | null): () => void;
  onShotFor(team: TeamType, getShooter: () => GameTank | null, turret: string): (result: ShotResult) => void;
  detonateWreck(gameTank: GameTank): void;
}

export function createCombatPresenter(deps: CombatDeps): CombatPresenter {
  const { effects, statusEffects, roster, battleScore, shakeCamera } = deps;
  const { tracers, hitEffects, railgunShot } = effects;
  const _jetVel = new Vector3();
  const _powAt = new Vector3(); // RailgunPowEffect position scratch

  const onChargeFor = (getShooter: () => GameTank | null) => (): void => {
    getShooter()?.audio?.playShot();
  };

  /**
   * A destroyed tank goes up in a mushroom cloud — on every death, whether it
   * was a kill or a self-destruct.
   *
   * Cosmetic ONLY: the wreck deals no area damage, so there are no blast
   * casualties, no frags from the blast and no chain reactions. The frag for
   * the death itself is awarded by whoever caused it (the weapon-hit handler,
   * the drowning path, or the self-destruct branch).
   */
  const detonateWreck = (gameTank: GameTank): void => {
    // Sized from the HULL: the cloud stands about three hull-lengths tall, so
    // a big hull makes a big cloud.
    const hullLength = gameTank.tank.halfLength * 2;
    hitEffects.spawnMushroom(
      gameTank.tank.getBody().state.position,
      hullLength * MUSHROOM_HULL_LENGTHS,
    );
    // Hardest shake in the game.
    shakeCamera({ ms: SHAKE_HIT.ms * 1.6, radius: SHAKE_HIT.radius * 2 });
  };

  const onShotFor = (team: TeamType, getShooter: () => GameTank | null, turret: string) => (result: ShotResult): void => {
    if (turret === 'Smoky' && hitEffects.hasSheet('shell_Smoky')) {
      // Visible shell flying along the (already resolved) hitscan line
      const length = result.origin.distanceTo(result.endPoint);
      if (length > 1) {
        _jetVel.diff(result.endPoint, result.origin).scale(VISUAL_SHELL_SPEED / length);
        hitEffects.spawnJetParticle('shell_Smoky', result.origin, 105, 105, (length / VISUAL_SHELL_SPEED) * 1000, _jetVel);
      }
    } else if (turret === 'Railgun') {
      // Original RailgunEffects.createShotTrail — rings + smoke along the ray
      railgunShot.spawnShot(result.origin, result.endPoint);
    } else if (STREAM_SPRITE[turret] == null && turret !== 'Isida') {
      // Jet turrets draw a continuous particle stream, Isida draws its own
      // three-part beam in the render loop — everything else gets a tracer
      tracers.spawn(result.origin, result.endPoint, turret);
    }
    // Charging turrets already played their sound when the charge began
    // (RailgunWeapon.startCharging -> onStartCharging), so don't replay it here.
    // A projectile DETONATION event has origin == endPoint with hits/staticHit;
    // everything else is a launch/shot. ProjectileWeapon fires onShot TWICE per
    // shell — once at the muzzle and once when it explodes — so both the shot
    // sound and the muzzle flash must be skipped on the detonation event.
    const isDetonation =
      result.origin.distanceToSquared(result.endPoint) < 1 && (result.staticHit || result.hits.length > 0);
    if (!isDetonation) {
      if (!CHARGING_TURRETS.has(turret)) {
        getShooter()?.audio?.playShot();
      }
      // Recoil kick when WE fire (the original shook on the local player only).
      // Rapid-fire turrets are excluded: at a ~175 ms cadence (Twins) or a
      // continuous stream (Firebird/Freeze/Isida) the shake never decays
      // between shots and reads as a vibrating camera, not as recoil.
      if (getShooter()?.isLocal === true && !NO_SHAKE_TURRETS.has(turret)) {
        shakeCamera(SHAKE_SHOT);
      }
      hitEffects.spawnSheet(`muzzle_${turret}`, result.origin, MUZZLE_SIZE[turret] ?? 160, 330);
    }
    if (turret === 'Railgun' && (result.staticHit || result.hits.length > 0)) {
      // RailgunPowEffect: the flash is pulled 100 units back along the ray
      // toward the muzzle (AnimatedPlane(30, 200, 0, -100, 0)).
      _powAt.diff(result.origin, result.endPoint);
      const d = _powAt.length();
      if (d > 1) {
        _powAt.scale(100 / d);
        _powAt.add(result.endPoint);
      } else {
        _powAt.copy(result.endPoint);
      }
      hitEffects.spawnSheet('pow_Railgun', _powAt, 200, (16 / 30) * 1000);
    }
    if (result.staticHit) {
      if (hitEffects.hasSheet(`expl_${turret}`)) {
        hitEffects.spawnSheet(`expl_${turret}`, result.endPoint, 220, 450);
      } else if (turret === 'Thunder') {
        // Thunder shells blow up with the generic fire explosion
        hitEffects.spawnTankHit(result.endPoint);
      } else {
        hitEffects.spawnStaticHit(result.endPoint);
      }
    }
    for (const hit of result.hits) {
      if (hitEffects.hasSheet(`expl_${turret}`)) {
        hitEffects.spawnSheet(`expl_${turret}`, hit.position, 260, 450);
      } else {
        hitEffects.spawnTankHit(hit.position);
      }
      // One reverse lookup per hit: the roster indexes physics tank ->
      // GameTank, replacing four linear scans over the battle.
      const victim = roster.ofTank(hit.tank);
      {
        const shooter = getShooter();
        if (shooter != null && victim != null && victim !== shooter) {
          statusEffects.markHit(victim, shooter, deps.getNow());
        }
        // A hit on US rattles the camera harder than our own recoil
        if (victim?.isLocal === true) {
          shakeCamera(SHAKE_HIT);
        }
      }
      // Firebird sets the victim alight; Freeze chills it and drains its
      // weapon gauge (see StatusEffects.ignite/chill for the ported rules).
      const statusHere = deps.statusAuthority == null || deps.statusAuthority(getShooter());
      if (turret === 'Firebird' && victim != null && statusHere) {
        statusEffects.ignite(victim, deps.getNow());
      }
      if (turret === 'Freeze' && victim != null && statusHere) {
        statusEffects.chill(victim, deps.getNow());
      }
      if (hit.lethal) {
        const shooter = getShooter();
        victim?.audio?.playDeath();
        hitEffects.spawnExplosion(hit.tank.getBody().state.position);
        if (victim != null) {
          detonateWreck(victim);
        }
        if (victim != null) {
          battleScore.recordDeath({ victim, killer: shooter, cause: 'weapon' });
        }
      }
    }
  };

  return { onChargeFor, onShotFor, detonateWreck };
}
