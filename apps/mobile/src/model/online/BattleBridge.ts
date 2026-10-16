// How the online module reaches the battle without knowing the engine
// (CLAUDE.md rule 11, as for the bots): lib/tanki implements this over the
// live GameTanks (OnlineBattleAdapterService) and hands it to
// online.netBattleService.start(). Everything here is ids and plain numbers.
//
// Two kinds of calls: the ones every peer makes for its REPLICAS (apply a
// pose, set a health value, kill, respawn at a given point) and the ones only
// the HOST makes to decide things (apply damage for real, pick a spawn,
// credit a frag, read the clock).
import type { TankCommand } from '../TankCommand';
import type { DeathCause } from '../BattleEvents';
import type { TeamType } from '../BattleConfig';
import type { OnlineSeat, WirePose, WireVec3, ScoreRowWire } from './wire';

/** A weapon's damage report on this machine, before anyone applied it. */
export interface DamageClaim {
  /** Actor id of the shooter; null for world damage. */
  sourceId: string | null;
  targetId: string;
  amount: number;
  splash: boolean;
  heal: boolean;
}

/**
 * What the bridge's damage interceptor answers: 'local' applies the hit on
 * this machine as usual (the host), 'drop' swallows it (a replica's weapon
 * firing on an observer, or a claim that went to the host instead).
 */
export type DamageVerdict = 'local' | 'drop';

/** What one hit of a tank's weapon can plausibly be, for the host's check of a claim. */
export interface WeaponLimits {
  /** Upper bound of hit points one hit may take (the roll's top, the supply buff, a margin). */
  maxPerHit: number;
  /** Two separate shots cannot come closer than this (reload / stream tick, with slack). */
  minIntervalMs: number;
  /** Beyond this distance (sim units, with slack) the weapon cannot reach. */
  maxRange: number;
  /** One shot may hit several tanks (penetration, splash, a cone). */
  multiTarget: boolean;
  /** Vampirism (Isida): the fraction of the damage dealt that heals the shooter; 0 for every other turret. */
  selfHealFraction: number;
}

export interface FlagEventInfo {
  kind: 'taken' | 'dropped' | 'returned' | 'delivered';
  flag: 'red' | 'blue';
  byId: string | null;
}

export interface BattleBridge {
  /** Actor id of this machine's own tank (= its peerId). */
  readonly localId: string;
  /** Every actor in the battle, local included. */
  tankIds(): string[];
  has(id: string): boolean;
  teamOf(id: string): TeamType;
  isDead(id: string): boolean;
  healthOf(id: string): number;
  incarnationOf(id: string): number;
  setIncarnation(id: string, inc: number): void;
  /** Sim height of a tank; below killZ() it has left the world. */
  heightOf(id: string): number;
  killZ(): number;
  turretOf(id: string): string;
  weaponLimits(id: string): WeaponLimits;
  /** Distance between two tanks' bodies, sim units. */
  distanceBetween(a: string, b: string): number;
  /** The tanks THIS machine drives: its own, plus the bots when it is the host. */
  ownedIds(): string[];
  owns(id: string): boolean;

  // --- the stream --------------------------------------------------------------
  /** The command an owned tank applied on the latest step (null before the first). */
  commandOf(id: string): TankCommand | null;
  readPose(id: string): WirePose | null;
  /**
   * Moves a replica toward the owner's pose: `blend` 1 snaps (position and
   * orientation set outright), a fraction closes that much of the gap; the
   * velocities and the turret are always taken as published.
   */
  applyPose(id: string, pose: WirePose, blend: number): void;
  /** The owner went quiet: hold the replica still where it stands. */
  freezeReplica(id: string): void;

  // --- replicas of the host's decisions ---------------------------------------
  setHealth(id: string, hp: number): void;
  /** The tank dies here: wreck, sound, kill log, score (the host already decided). */
  kill(victimId: string, killerId: string | null, cause: DeathCause): void;
  respawnAt(id: string, inc: number, p: WireVec3, rz: number): void;
  setStats(rows: ScoreRowWire[], red: number, blue: number): void;
  setClock(msLeft: number | null): void;
  applyFlag(event: FlagEventInfo): void;
  /** Burn / freeze on a tank by the host's word (the local tank's gauge drains on a freeze). */
  applyStatus(id: string, kind: 'burn' | 'freeze'): void;
  finish(reason: 'time' | 'left'): void;

  // --- the host's decisions ------------------------------------------------------
  /** Applies damage for real; true when it killed (the death itself is then recorded through the death hook). Marks the attacker for frag credit. */
  applyDamage(claim: DamageClaim): boolean;
  /** The frag for a death no weapon caused (drowning, self-destruct). */
  creditFor(victimId: string): string | null;
  /** A spawn point for this tank, picked here (the host's pick is the one everybody uses). */
  pickSpawn(id: string): { p: WireVec3; rz: number };
  clockMsLeft(): number | null;
  /** The frag table and the team score, for `score` / `sync`. */
  readScore(): { rows: ScoreRowWire[]; red: number; blue: number };
  readFlags(): { flag: 'red' | 'blue'; carrier: string | null }[];
  /** Host only: the flag rules run here (pickups, deliveries); replicas only replay. */
  setFlagAuthority(on: boolean): void;
  /** Host only: the battle clock counts here (from the old host's last value after a migration); replicas show the host's. */
  setClockAuthority(on: boolean): void;

  // --- hooks (set through methods: di-kit accessors drop field writes) ----------
  /** Every weapon's damage report on this machine goes through here first. */
  setDamageInterceptor(interceptor: ((claim: DamageClaim) => DamageVerdict) | null): void;
  /** Every death recorded on this machine (host: its own decisions; replica: the host's messages). */
  setOnDeath(hook: ((victimId: string, killerId: string | null, cause: DeathCause) => void) | null): void;
  /** Flag events the local rules produced (host only, see setFlagAuthority). */
  setOnFlag(hook: ((event: FlagEventInfo) => void) | null): void;
  /** The local self-destruct hold completed: the host decides. */
  setOnSuicide(hook: (() => void) | null): void;

  // --- the roster -----------------------------------------------------------------
  /** A peer joined mid-battle: a replica for it. */
  addRemote(seat: OnlineSeat): Promise<void>;
  /** A peer left: its tank goes. */
  removeActor(id: string): void;
  /** This machine became the host: the bot's brain runs here from now on (ControlRegistryService.replace). */
  takeOverBot(id: string): Promise<void>;
  /** This machine is no longer the host: the bot is a replica again. */
  releaseBot(id: string): Promise<void>;
}
