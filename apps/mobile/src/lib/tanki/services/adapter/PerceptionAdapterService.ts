// Builds the read-only world view a bot thinks against (model/Perception):
// the adapter between the battle's live objects and lib/engine, which never
// touches GameTank or physics bodies. All queries are live closures over the
// battle state, so one perception per actor lasts the whole battle. Nothing
// here is mode-specific: flags are exposed when the mode has them,
// strategies decide what they mean.
import { Vector3 } from '../../../../engine/math/Vector3';
import { RayHit } from '../../../../engine/physics/collision/types/RayHit';
import type { TankActor } from '../../../../classes/TankActor';
import type { BotPerception, FlagView, SelfView, TankView } from '../../../../model/Perception';
import type { SupplyKind, Vec3Like } from '../../../../model/TankCommand';
import type { TeamType } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type BattleStateService from '../battle/BattleStateService';
import type FlagModeService from '../mode/FlagModeService';
import type ModeRuleService from '../mode/ModeRuleService';
import type ScoreService from '../battle/ScoreService';

const _from = new Vector3();
const _dir = new Vector3();
const _hit = new RayHit();
const _local = new Vector3();

export class PerceptionAdapterService {
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);
  private readonly modeRuleService = inject<ModeRuleService>(TYPES.modeRuleService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);

  private readonly views = new Map<string, TankView>();
  private readonly baseSpeeds = new Map<string, number>();

  public forget = (actorId: string): void => {
    this.views.delete(actorId);
    this.baseSpeeds.delete(actorId);
  };

  public clear = (): void => {
    this.views.clear();
    this.baseSpeeds.clear();
  };

  /** A persistent, live view of one actor (cached per battle). */
  public view = (actor: TankActor): TankView => {
    let view = this.views.get(actor.id);
    if (view == null) {
      view = this.createView(actor);
      this.views.set(actor.id, view);
    }
    return view;
  };

  public build = (actor: TankActor): BotPerception => {
    const state = this.battleStateService;
    const self = this.createSelfView(actor);
    const perception: BotPerception = {
      get now() {
        return state.timeMs;
      },
      get mode() {
        return state.config.mode;
      },
      get flagRules() {
        return this.mode === 'ctf' ? 'ctf' : this.mode === 'assault' ? 'assault' : null;
      },
      self,
      tanks: () => state.actors().filter((a) => a !== actor).map((a) => this.view(a)),
      enemies: () =>
        state
          .actors()
          .filter((a) => a !== actor && this.modeRuleService.hostile(actor.gameTank.tank.team, a.gameTank.tank.team))
          .map((a) => this.view(a)),
      allies: () =>
        state
          .actors()
          .filter((a) => a !== actor && !this.modeRuleService.hostile(actor.gameTank.tank.team, a.gameTank.tank.team))
          .map((a) => this.view(a)),
      hasLineOfSight: (from, to) => this.hasLineOfSight(from, to),
      canSee: (from, target) => this.canSee(actor, from, target),
      flags: () => this.flagViews(),
      spawnCentroid: (team) => this.spawnCentroid(team),
      groundHeightAt: (x, y, fromZ, depth = 2000) => this.groundHeightAt(x, y, fromZ, depth),
    };
    return perception;
  };

  // --- internals -----------------------------------------------------------

  private createView(actor: TankActor): TankView {
    const tank = actor.gameTank.tank;
    const body = tank.getBody();
    const flagMode = this.flagModeService;
    const baseSpeed = tank.getMaxSpeedSmoother().getTargetValue();
    this.baseSpeeds.set(actor.id, baseSpeed);
    const baseSpeeds = this.baseSpeeds;
    const scoreService = this.scoreService;
    return {
      id: actor.id,
      turret: actor.gameTank.turretName,
      get team() {
        return tank.team;
      },
      get alive() {
        return !tank.isDead();
      },
      // Read LIVE on every access: the body's state vectors are replaced
      // (spawn placement, state swaps), so a captured reference goes stale.
      get position() {
        return body.state.position;
      },
      get velocity() {
        return body.state.velocity;
      },
      get health() {
        return tank.health;
      },
      get maxHealth() {
        return tank.maxHealth;
      },
      halfWidth: actor.gameTank.hullSize.x / 2,
      maxSpeed: baseSpeed,
      get buffed() {
        const base = baseSpeeds.get(actor.id) ?? Infinity;
        return (
          tank.outgoingDamageMultiplier > 1 ||
          tank.incomingDamageMultiplier < 1 ||
          tank.getMaxSpeedSmoother().getTargetValue() > base * 1.05
        );
      },
      get carriesFlag() {
        return flagMode.carriedBy(actor.gameTank);
      },
      get heading() {
        return tank.getTankDirection();
      },
      get upright() {
        return body.baseMatrix.m22 > 0.5;
      },
      get frags() {
        return scoreService.fragsOf(actor.gameTank);
      },
    };
  }

  private createSelfView(actor: TankActor): SelfView {
    const base = this.view(actor);
    const gameTank = actor.gameTank;
    const body = gameTank.tank.getBody();
    const supplies = actor.supplies;
    const weaponRange = this.modeRuleService.weaponRange(gameTank.turretName);
    const firesOnRelease = this.modeRuleService.firesOnRelease(gameTank.turretName);
    const now = (): number => this.battleStateService.timeMs;
    return {
      ...base,
      // Spread copies the getters' VALUES; re-declare the live ones.
      get team() {
        return base.team;
      },
      get alive() {
        return base.alive;
      },
      get health() {
        return base.health;
      },
      get maxHealth() {
        return base.maxHealth;
      },
      get buffed() {
        return base.buffed;
      },
      get carriesFlag() {
        return base.carriesFlag;
      },
      get position() {
        return base.position;
      },
      get velocity() {
        return base.velocity;
      },
      get frags() {
        return base.frags;
      },
      get heading() {
        return base.heading;
      },
      get upright() {
        return base.upright;
      },
      headingErrorTo(point: Vec3Like): number {
        _local.reset(point.x - body.state.position.x, point.y - body.state.position.y, point.z - body.state.position.z);
        body.baseMatrix.transformVectorInverse(_local.clone(), _local);
        return Math.atan2(-_local.x, _local.y);
      },
      turretErrorTo(point: Vec3Like): number {
        _local.reset(point.x, point.y, point.z);
        return gameTank.turretErrorTo(_local);
      },
      gunElevationTo(point: Vec3Like): number {
        _local.reset(point.x - body.state.position.x, point.y - body.state.position.y, point.z - body.state.position.z);
        body.baseMatrix.transformVectorInverse(_local.clone(), _local);
        return Math.atan2(_local.z, Math.max(Math.hypot(_local.x, _local.y), 0.001));
      },
      muzzle(out: Vec3Like): Vec3Like {
        gameTank.getMuzzleWorldPosition(_from);
        out.x = _from.x;
        out.y = _from.y;
        out.z = _from.z;
        return out;
      },
      get weaponStatus() {
        return gameTank.weapon.getStatus(now());
      },
      weaponRange,
      firesOnRelease,
      supplyReady(kind: SupplyKind): boolean {
        return supplies.isReady(kind);
      },
    };
  }

  private hasLineOfSight(from: Vec3Like, to: Vec3Like): boolean {
    _from.reset(from.x, from.y, from.z);
    _dir.reset(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = _dir.length();
    if (distance < 1) {
      return true;
    }
    _dir.scale(1 / distance);
    const detector = this.battleStateService.physics.getCollisionDetector();
    const blocked = detector.raycastStatic(_from, _dir, 0xffff, distance, null, _hit);
    _hit.clear();
    return !blocked;
  }

  /** First thing on the ray must be the target's own body (tanks block too). */
  private canSee(actor: TankActor, from: Vec3Like, target: TankView): boolean {
    const targetActor = this.battleStateService.actor(target.id);
    if (targetActor == null) {
      return false;
    }
    _from.reset(from.x, from.y, from.z);
    const to = target.position;
    _dir.reset(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = _dir.length();
    if (distance < 1) {
      return true;
    }
    _dir.scale(1 / distance);
    const ownBody = actor.gameTank.tank.getBody();
    const targetBody = targetActor.gameTank.tank.getBody();
    const detector = this.battleStateService.physics.getCollisionDetector();
    const hasHit = detector.raycast(
      _from,
      _dir,
      0xffff,
      distance + 100,
      { considerBody: (body) => body !== ownBody },
      _hit,
    );
    const visible = hasHit && _hit.shape?.body === targetBody;
    _hit.clear();
    return visible;
  }

  private groundHeightAt(x: number, y: number, fromZ: number, depth: number): number | null {
    _from.reset(x, y, fromZ);
    _dir.reset(0, 0, -1);
    const detector = this.battleStateService.physics.getCollisionDetector();
    const hit = detector.raycastStatic(_from, _dir, 0xffff, depth, null, _hit);
    const z = hit ? _hit.position.z : null;
    _hit.clear();
    return z;
  }

  private flagViews(): { red: FlagView; blue: FlagView } | null {
    const ctf = this.flagModeService.mode;
    if (ctf == null) {
      return null;
    }
    const view = (team: 'red' | 'blue'): FlagView => {
      const flag = ctf.flags[team];
      const carrier = flag.carrier != null ? this.battleStateService.actorOf(flag.carrier) : null;
      return {
        team,
        state: flag.state,
        position: flag.position,
        basePosition: flag.basePosition,
        carrierId: carrier?.id ?? null,
      };
    };
    return { red: view('red'), blue: view('blue') };
  }

  private spawnCentroid(team: TeamType): Vec3Like | null {
    const points = this.battleStateService.mapStage.spawnPoints.filter((p) => p.type === team);
    if (points.length === 0) {
      return null;
    }
    const sum = { x: 0, y: 0, z: 0 };
    for (const p of points) {
      sum.x += p.position.x;
      sum.y += p.position.y;
      sum.z += p.position.z;
    }
    return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
  }
}

export default PerceptionAdapterService;
