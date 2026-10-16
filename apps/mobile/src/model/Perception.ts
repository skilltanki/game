// What a bot is allowed to know. A read-only view of the battle built by
// BotPerceptionService; brains never touch GameTank or physics bodies, so the
// same brain can later run against a network snapshot or on a server.
import type { Vec3Like } from './TankCommand';
import type { BattleModeId, TeamType } from './BattleConfig';

export interface TankView {
  id: string;
  team: TeamType;
  /** Mounted turret id ('Freeze', 'Railgun', ...): the squad hands out roles by reach. */
  turret: string;
  alive: boolean;
  /** Live reference into the simulation state — read, never write. */
  position: Vec3Like;
  velocity: Vec3Like;
  health: number;
  maxHealth: number;
  /** Half hull width, for angular size estimates. */
  halfWidth: number;
  /** Top speed of the hull without buffs, sim units/s (a Wasp outruns a Mammoth 2:1 — roles use it). */
  maxSpeed: number;
  /** Running an offensive/defensive supply (double damage, armour, nitro). */
  buffed: boolean;
  /** Carrying a flag (CTF/Assault). */
  carriesFlag: 'red' | 'blue' | null;
  /** Hull yaw, radians. */
  heading: number;
  upright: boolean;
  /** Kills this battle (the scoreboard): the top fragger is the threat to focus. */
  frags: number;
}

export type FlagStateView = 'atBase' | 'carried' | 'dropped';

export interface FlagView {
  team: 'red' | 'blue';
  state: FlagStateView;
  /** Where the flag is right now (its foot). */
  position: Vec3Like;
  /** The pedestal. */
  basePosition: Vec3Like;
  carrierId: string | null;
}

export interface SelfView extends TankView {
  /** Hull-space heading error (radians, + = target is to the left) toward a world point. */
  headingErrorTo(point: Vec3Like): number;
  /** Angle the turret still has to traverse to point at `point`. */
  turretErrorTo(point: Vec3Like): number;
  /** Elevation the gun needs toward `point`, radians, relative to the HULL's plane (a tilted hull on a slope aims along it). */
  gunElevationTo(point: Vec3Like): number;
  /** Current-barrel muzzle position. */
  muzzle(out: Vec3Like): Vec3Like;
  /** Weapon readiness 0..1. */
  weaponStatus: number;
  /** Fire range of the mounted weapon, sim units. */
  weaponRange: number;
  /** The weapon fires when the trigger is LET GO (the Shaft: a held trigger is its sniper charge), not while it is held. */
  firesOnRelease: boolean;
  /** Supply availability. */
  supplyReady(kind: import('./TankCommand').SupplyKind): boolean;
}

export interface BotPerception {
  readonly now: number;
  readonly mode: BattleModeId;
  /** 'ctf' | 'assault' | null */
  readonly flagRules: 'ctf' | 'assault' | null;
  readonly self: SelfView;
  tanks(): TankView[];
  enemies(): TankView[];
  allies(): TankView[];
  /** True when nothing static blocks the segment (tanks do not block). */
  hasLineOfSight(from: Vec3Like, to: Vec3Like): boolean;
  /** True when the first thing on the ray from `from` to the target is the target. */
  canSee(from: Vec3Like, target: TankView): boolean;
  /** Flags, when the mode has them. */
  flags(): { red: FlagView; blue: FlagView } | null;
  /** Spawn points of a side, for "where the enemy comes from" heuristics. */
  spawnCentroid(team: TeamType): Vec3Like | null;
  /**
   * Height of the static ground under (x, y), probing down from `fromZ`.
   * null = nothing to stand on within `depth` (water, the void off the map).
   */
  groundHeightAt(x: number, y: number, fromZ: number, depth?: number): number | null;
}
