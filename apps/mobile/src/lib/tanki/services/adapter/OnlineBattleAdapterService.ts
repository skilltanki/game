// The BattleBridge (src/model/online) over the live battle: how lib/online
// reads and writes the engine without knowing it (CLAUDE.md rule 11, as
// NavWorldAdapterService / PerceptionAdapterService do for the bots).
//
// Replication, not control: a replica's POSE (position, orientation,
// velocities, turret angle) is state the owner publishes and this adapter
// writes straight into the body — the same way spawnAtPoint teleports a
// tank. Everything a player DOES still goes TankCommand → CommandBuffer →
// TankDriverService (rule 4): the owner's commands reach the replica through
// RemoteControlService.
//
// Damage: the engine's one damage sink (engine/weapon/DamageSink.ts) is
// pointed at this adapter for the battle; the interceptor the netcode
// installs decides whether a report is applied here (the host, its own
// weapons) or becomes a claim / is dropped.
import { Vector3 } from '../../../../engine/math/Vector3';
import { applyDamageLocally, setDamageApplier, type DamageReport } from '../../../../engine/weapon/DamageSink';
import type { GameTank } from '../../../../engine/game/GameTank';
import type { Tank } from '../../../../engine/tank/Tank';
import { WEAPON_SPECS } from '../../../../engine/weapon/WeaponSpecs';
import type { BattleBridge, DamageClaim, DamageVerdict, FlagEventInfo, WeaponLimits } from '../../../../model/online/BattleBridge';
import type { OnlineSeat, ScoreRowWire, WirePose, WireVec3 } from '../../../../model/online/wire';
import type { TankCommand } from '../../../../model/TankCommand';
import type { DeathCause } from '../../../../model/BattleEvents';
import type { TeamType } from '../../../../model/BattleConfig';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from '../base/LoggerService';
import type BattleStateService from '../battle/BattleStateService';
import type BattleEventService from '../battle/BattleEventService';
import type BattleSessionService from '../battle/BattleSessionService';
import type TankSpawnService from '../battle/TankSpawnService';
import type RespawnService from '../battle/RespawnService';
import type ScoreService from '../battle/ScoreService';
import type ClockService from '../battle/ClockService';
import type CombatService from '../battle/CombatService';
import type EffectsService from '../battle/EffectsService';
import type FlagModeService from '../mode/FlagModeService';
import type ControlRegistryService from '../control/ControlRegistryService';

export class OnlineBattleAdapterService implements BattleBridge {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  private readonly battleStateService = inject<BattleStateService>(TYPES.battleStateService);
  private readonly battleEventService = inject<BattleEventService>(TYPES.battleEventService);
  private readonly battleSessionService = inject<BattleSessionService>(TYPES.battleSessionService);
  private readonly tankSpawnService = inject<TankSpawnService>(TYPES.tankSpawnService);
  private readonly respawnService = inject<RespawnService>(TYPES.respawnService);
  private readonly scoreService = inject<ScoreService>(TYPES.scoreService);
  private readonly clockService = inject<ClockService>(TYPES.clockService);
  private readonly combatService = inject<CombatService>(TYPES.combatService);
  private readonly effectsService = inject<EffectsService>(TYPES.effectsService);
  private readonly flagModeService = inject<FlagModeService>(TYPES.flagModeService);
  private readonly controlRegistryService = inject<ControlRegistryService>(TYPES.controlRegistryService);

  /** Bots whose brains run on this machine (the host's), by actor id. */
  private readonly ownedBots = new Set<string>();
  private interceptor: ((claim: DamageClaim) => DamageVerdict) | null = null;
  private offDeath: (() => void) | null = null;
  private offFlag: (() => void) | null = null;
  private armed = false;

  /** Points the engine's damage sink here for this battle. */
  public create = (): BattleBridge => {
    setDamageApplier(this.applier);
    this.clockService.setRemoteMode(!this.isHostClock());
    this.ownedBots.clear();
    for (const actor of this.battleStateService.actors()) {
      if (actor.isBot) this.ownedBots.add(actor.id);
    }
    // Burn / freeze: set here only by the weapons this machine drives, and only on the host (the peers' hits come as claims).
    this.combatService.setStatusAuthority((shooter) => {
      const online = this.battleStateService.config.online;
      if (online == null || online.hostId !== online.localPeerId) return false;
      const id = shooter != null ? this.battleStateService.actorOf(shooter)?.id ?? null : null;
      return id != null && this.owns(id);
    });
    this.armed = true;
    return this;
  };

  /** Back to single-player damage; every hook off. */
  public dispose = (): void => {
    if (!this.armed) return;
    this.armed = false;
    setDamageApplier(applyDamageLocally);
    this.combatService.setStatusAuthority(null);
    this.ownedBots.clear();
    this.setDamageInterceptor(null);
    this.setOnDeath(null);
    this.setOnFlag(null);
    this.setOnSuicide(null);
    this.flagModeService.setAuthority(true);
    this.clockService.setRemoteMode(false);
  };

  // --- identity -------------------------------------------------------------------

  public get localId(): string {
    return this.battleStateService.local.id;
  }

  public tankIds = (): string[] => this.battleStateService.actors().map((a) => a.id);

  public has = (id: string): boolean => this.battleStateService.actor(id) != null;

  public teamOf = (id: string): TeamType => this.gameTank(id).tank.team;

  public isDead = (id: string): boolean => this.gameTank(id).tank.isDead();

  public healthOf = (id: string): number => this.gameTank(id).tank.health;

  public incarnationOf = (id: string): number => this.gameTank(id).incarnation;

  public setIncarnation = (id: string, inc: number): void => {
    this.gameTank(id).incarnation = inc;
  };

  public heightOf = (id: string): number => this.gameTank(id).tank.getBody().state.position.z;

  public killZ = (): number => this.battleStateService.mapStage.killZ;

  public turretOf = (id: string): string => this.gameTank(id).turretName;

  /** The weapon's balance figures with slack: a gaussian roll tops out above `damage`, poses lag the shooter by a step or two. */
  public weaponLimits = (id: string): WeaponLimits => {
    const gt = this.gameTank(id);
    const spec = WEAPON_SPECS[gt.turretName];
    const buff = Math.max(1, gt.tank.outgoingDamageMultiplier);
    const ROLL = 1.35;
    if (spec == null) return { maxPerHit: 300 * buff, minIntervalMs: 100, maxRange: Infinity, multiTarget: true, selfHealFraction: 0 };
    switch (spec.kind) {
      case 'hitscan':
        return { maxPerHit: spec.damage * ROLL * buff, minIntervalMs: spec.reloadTime * 0.7, maxRange: spec.maxRange ?? Infinity, multiTarget: true, selfHealFraction: 0 };
      case 'projectile':
        return { maxPerHit: spec.damage * ROLL * buff, minIntervalMs: spec.reloadTime * 0.7, maxRange: spec.maxRange, multiTarget: spec.splash != null, selfHealFraction: 0 };
      case 'stream':
        return { maxPerHit: Math.max(spec.damagePerTick, spec.healPerTick ?? 0) * ROLL * buff, minIntervalMs: spec.tickInterval * 0.7, maxRange: spec.maxRange, multiTarget: true, selfHealFraction: spec.selfHealFraction ?? 0 };
      case 'shaft':
        return { maxPerHit: spec.maxDamage * ROLL * buff, minIntervalMs: 250, maxRange: Infinity, multiTarget: true, selfHealFraction: 0 };
    }
  };

  public distanceBetween = (a: string, b: string): number => {
    const pa = this.gameTank(a).tank.getBody().state.position;
    const pb = this.gameTank(b).tank.getBody().state.position;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
  };

  public ownedIds = (): string[] => this.battleStateService.actors().filter((a) => a.isLocal || this.ownedBots.has(a.id)).map((a) => a.id);

  public owns = (id: string): boolean => {
    const actor = this.battleStateService.actor(id);
    return actor != null && (actor.isLocal || this.ownedBots.has(id));
  };

  // --- the stream -------------------------------------------------------------------

  public commandOf = (id: string): TankCommand | null => this.battleStateService.actor(id)?.lastCommand ?? null;

  public readPose = (id: string): WirePose | null => {
    const actor = this.battleStateService.actor(id);
    if (actor == null) return null;
    const gt = actor.gameTank;
    const { position: p, orientation: o, velocity: v, angularVelocity: av } = gt.tank.getBody().state;
    return {
      inc: gt.incarnation,
      p: [r(p.x), r(p.y), r(p.z)],
      o: [r4(o.w), r4(o.x), r4(o.y), r4(o.z)],
      v: [r(v.x), r(v.y), r(v.z)],
      av: [r4(av.x), r4(av.y), r4(av.z)],
      tr: r4(gt.tank.turretController.getDirection()),
    };
  };

  /**
   * The teleport gotcha (desktop net/protocol.ts applyWireBody): orientation
   * too, then calcDerivedData. `blend` < 1 closes that fraction of the gap
   * (position lerp, orientation nlerp) so a 15 Hz feed slides instead of
   * twitching; the velocities and the turret are always the owner's.
   */
  public applyPose = (id: string, pose: WirePose, blend: number): void => {
    const gt = this.gameTank(id);
    const body = gt.tank.getBody();
    const { position: p, orientation: o } = body.state;
    const k = Math.max(0, Math.min(1, blend));
    if (k >= 1) {
      p.reset(pose.p[0], pose.p[1], pose.p[2]);
      o.reset(pose.o[0], pose.o[1], pose.o[2], pose.o[3]);
    } else {
      p.reset(p.x + (pose.p[0] - p.x) * k, p.y + (pose.p[1] - p.y) * k, p.z + (pose.p[2] - p.z) * k);
      // Nearest arc: flip the target when the dot product is negative.
      let [tw, tx, ty, tz] = pose.o;
      if (o.w * tw + o.x * tx + o.y * ty + o.z * tz < 0) {
        tw = -tw;
        tx = -tx;
        ty = -ty;
        tz = -tz;
      }
      o.reset(o.w + (tw - o.w) * k, o.x + (tx - o.x) * k, o.y + (ty - o.y) * k, o.z + (tz - o.z) * k);
    }
    o.normalize();
    body.state.velocity.reset(pose.v[0], pose.v[1], pose.v[2]);
    body.state.angularVelocity.reset(pose.av[0], pose.av[1], pose.av[2]);
    body.calcDerivedData();
    gt.tank.turretController.setDirectionImmediate(pose.tr);
  };

  public freezeReplica = (id: string): void => {
    const body = this.gameTank(id).tank.getBody();
    body.state.velocity.reset(0, 0, 0);
    body.state.angularVelocity.reset(0, 0, 0);
    body.calcDerivedData();
  };

  // --- replicas of the host's decisions ---------------------------------------------

  public setHealth = (id: string, hp: number): void => {
    const tank = this.gameTank(id).tank;
    if (tank.isDead()) return;
    tank.health = Math.max(0, Math.min(tank.maxHealth, hp));
  };

  public kill = (victimId: string, killerId: string | null, cause: DeathCause): void => {
    const victim = this.gameTank(victimId);
    if (victim.tank.isDead()) return;
    // As the engine's own lethal hit does: a dead tank has no health left (the host's `health 0` comes after and setHealth skips the dead).
    victim.tank.health = 0;
    victim.tank.kill();
    this.presentDeath(victim, killerId != null ? this.battleStateService.actor(killerId)?.gameTank ?? null : null, cause);
  };

  public respawnAt = (id: string, inc: number, p: WireVec3, rz: number): void => {
    const gt = this.gameTank(id);
    gt.incarnation = inc;
    this.respawnService.system.respawnAt(gt, { type: gt.tank.team, position: new Vector3(p[0], p[1], p[2]), rotationZ: rz });
  };

  public setStats = (rows: ScoreRowWire[], red: number, blue: number): void => {
    const score = this.scoreService.score;
    for (const row of rows) {
      const actor = this.battleStateService.actor(row.id);
      if (actor != null) score.setStats(actor.gameTank, row.frags, row.deaths);
    }
    score.setTeamScore(red, blue);
  };

  public setClock = (msLeft: number | null): void => {
    this.clockService.setRemote(msLeft);
  };

  public applyFlag = (event: FlagEventInfo): void => {
    const by = event.byId != null ? this.battleStateService.actor(event.byId)?.gameTank ?? null : null;
    this.flagModeService.applyRemote(event.kind, event.flag, by);
  };

  public applyStatus = (id: string, kind: 'burn' | 'freeze'): void => {
    const gt = this.gameTank(id);
    const now = this.battleStateService.timeMs;
    if (kind === 'burn') {
      this.effectsService.status.ignite(gt, now);
    } else {
      // The gauge drain belongs to the victim's own machine; everyone else only shows the slow.
      this.effectsService.status.chill(gt, now, gt.isLocal);
    }
  };

  public finish = (reason: 'time' | 'left'): void => {
    this.battleSessionService.finish(reason);
  };

  // --- the host's decisions -------------------------------------------------------------

  public applyDamage = (claim: DamageClaim): boolean => {
    const target = this.battleStateService.actor(claim.targetId)?.gameTank;
    if (target == null) return false;
    const source = claim.sourceId != null ? this.battleStateService.actor(claim.sourceId)?.gameTank ?? null : null;
    if (source != null && source !== target && !claim.heal) {
      // The frag for a drowning / self-destruct goes to the last attacker (engine/logic/combat.ts does this for local hits).
      this.effectsService.status.markHit(target, source, this.battleStateService.timeMs);
    }
    const lethal = applyDamageLocally({ source: source?.tank ?? null, target: target.tank, amount: claim.amount, splash: claim.splash, heal: claim.heal });
    if (lethal) {
      this.presentDeath(target, source, 'weapon');
    }
    return lethal;
  };

  public creditFor = (victimId: string): string | null => {
    const victim = this.gameTank(victimId);
    const killer = this.respawnService.system.creditFor(victim);
    return killer != null ? this.battleStateService.actorOf(killer)?.id ?? null : null;
  };

  public pickSpawn = (id: string): { p: WireVec3; rz: number } => {
    const spawn = this.respawnService.system.pickNextSpawn(this.gameTank(id));
    return { p: [r(spawn.position.x), r(spawn.position.y), r(spawn.position.z)], rz: r4(spawn.rotationZ) };
  };

  public clockMsLeft = (): number | null => this.clockService.msLeft;

  public readScore = (): { rows: ScoreRowWire[]; red: number; blue: number } => {
    const team = this.scoreService.teamScore;
    return { rows: this.scoreService.rows().map((row) => ({ id: row.actorId, frags: row.frags, deaths: row.deaths })), red: team.red, blue: team.blue };
  };

  public readFlags = (): { flag: 'red' | 'blue'; carrier: string | null }[] => {
    const ctf = this.flagModeService.mode;
    if (ctf == null) return [];
    return (['red', 'blue'] as const).map((flag) => {
      const carrier = ctf.flags[flag].carrier;
      return { flag, carrier: carrier != null ? this.battleStateService.actorOf(carrier)?.id ?? null : null };
    });
  };

  public setFlagAuthority = (on: boolean): void => {
    this.flagModeService.setAuthority(on);
  };

  public setClockAuthority = (on: boolean): void => {
    this.clockService.setRemoteMode(!on);
  };

  // --- hooks -------------------------------------------------------------------------------

  public setDamageInterceptor = (interceptor: ((claim: DamageClaim) => DamageVerdict) | null): void => {
    this.interceptor = interceptor;
  };

  public setOnDeath = (hook: ((victimId: string, killerId: string | null, cause: DeathCause) => void) | null): void => {
    this.offDeath?.();
    this.offDeath = null;
    if (hook == null) return;
    this.offDeath = this.battleEventService.on('death', (e) => hook(e.victimId, e.killerId, e.cause));
  };

  public setOnFlag = (hook: ((event: FlagEventInfo) => void) | null): void => {
    this.offFlag?.();
    this.offFlag = null;
    if (hook == null) return;
    this.offFlag = this.battleEventService.on('flag', (e) => hook({ kind: e.kind, flag: e.flag, byId: e.byId }));
  };

  public setOnSuicide = (hook: (() => void) | null): void => {
    this.respawnService.setNetwork(hook == null ? null : { sendSuicide: hook });
  };

  // --- the roster -------------------------------------------------------------------------

  public addRemote = async (seat: OnlineSeat): Promise<void> => {
    if (this.has(seat.peerId)) return;
    const mode = this.battleStateService.config.mode;
    const teams = mode === 'tdm' || mode === 'ctf' || mode === 'assault';
    const actor = await this.tankSpawnService.spawn({
      id: seat.peerId,
      name: seat.name,
      team: teams ? (seat.team ?? 'red') : 'dm',
      loadout: { hull: seat.hull, turret: seat.turret, paint: seat.paint ?? undefined, modification: 'M0' },
      control: 'remote',
    });
    const spawns = this.battleStateService.mapStage.spawnPoints;
    if (spawns.length > 0) actor.gameTank.spawnAt(spawns);
    this.battleEventService.emit('roster', { actorId: seat.peerId, joined: true });
  };

  public removeActor = (id: string): void => {
    const actor = this.battleStateService.actor(id);
    if (actor == null) return;
    this.ownedBots.delete(id);
    this.tankSpawnService.despawn(actor);
    this.battleEventService.emit('roster', { actorId: id, joined: false });
  };

  public takeOverBot = async (id: string): Promise<void> => {
    const actor = this.battleStateService.actor(id);
    if (actor == null || this.ownedBots.has(id)) return;
    this.ownedBots.add(id);
    const difficulty = this.battleStateService.config.online?.botDifficulty ?? 'normal';
    await this.controlRegistryService.replace(actor, this.tankSpawnService.botSource(actor, difficulty));
    this.loggerService.log('bot taken over', id, difficulty);
  };

  public releaseBot = async (id: string): Promise<void> => {
    const actor = this.battleStateService.actor(id);
    if (actor == null || !this.ownedBots.has(id)) return;
    this.ownedBots.delete(id);
    await this.controlRegistryService.replace(actor, this.tankSpawnService.remoteSource(actor));
    this.loggerService.log('bot released', id);
  };

  // --- internals ----------------------------------------------------------------------------

  /** The battle's damage applier: the netcode's interceptor decides, this applies. */
  private applier = (report: DamageReport): boolean => {
    const interceptor = this.interceptor;
    if (interceptor == null || !this.battleStateService.running) {
      return applyDamageLocally(report);
    }
    const targetId = this.idOf(report.target);
    if (targetId == null) return applyDamageLocally(report);
    const sourceId = report.source != null ? this.idOf(report.source) : null;
    const verdict = interceptor({ sourceId, targetId, amount: report.amount, splash: report.splash === true, heal: report.heal === true });
    return verdict === 'local' ? applyDamageLocally(report) : false;
  };

  /** Wreck, sound, kill log and score: what the weapon path does on a lethal hit (engine/logic/combat.ts). */
  private presentDeath(victim: GameTank, killer: GameTank | null, cause: DeathCause): void {
    victim.audio?.playDeath();
    const position = victim.tank.getBody().state.position;
    this.effectsService.effects.hitEffects.spawnExplosion(position);
    if (cause !== 'drown') {
      this.combatService.detonateWreck(victim);
    }
    this.scoreService.score.recordDeath({ victim, killer: killer != null && killer !== victim ? killer : null, cause });
  }

  private isHostClock(): boolean {
    const online = this.battleStateService.config.online;
    return online != null && online.hostId === online.localPeerId;
  }

  private idOf(tank: Tank): string | null {
    const gameTank = this.battleStateService.roster.ofTank(tank);
    return gameTank != null ? this.battleStateService.actorOf(gameTank)?.id ?? null : null;
  }

  private gameTank(id: string): GameTank {
    const actor = this.battleStateService.actor(id);
    if (actor == null) {
      throw new Error(`no actor "${id}" in this battle`);
    }
    return actor.gameTank;
  }
}

/** Two decimals of a sim unit (a hundredth of a centimetre) is plenty on the wire. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export default OnlineBattleAdapterService;
