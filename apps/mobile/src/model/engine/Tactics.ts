// Team-level knowledge and roles. A bot does not see the whole battle: it
// sees what its turret has line of sight to, and what its teammates have
// reported. Roles are handed out by the squad's auction, once a second.
import type { TankView } from '../Perception';
import type { Vec3Like } from '../TankCommand';
import type { CostLayer } from './Nav';

export type SquadRole = 'carrier' | 'escortFront' | 'escortRear' | 'interceptor' | 'defender' | 'hunter';

/** Where and when an enemy was last seen by anyone on the team. */
export interface Sighting {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Sim time of the sighting. */
  at: number;
  /** Who saw it. */
  byId: string;
}

export interface KnownEnemy {
  view: TankView;
  /** Last reported position (the live one only while `visible`). */
  lastSeen: Vec3Like;
  ageMs: number;
  /** This bot has line of sight right now. */
  visible: boolean;
}

/** What a strategy may ask its team. Built per bot per decision. */
export interface TeamContext {
  /** Enemies anyone on the team saw within the sighting memory, nearest first. */
  knownEnemies(): KnownEnemy[];
  roleOf(id: string): SquadRole;
  /** Where an escort should be right now (ahead of or behind the carrier). */
  escortPoint(role: 'escortFront' | 'escortRear', out: Vec3Like): boolean;
  /** Where to cut off the enemy carrier. */
  interceptPoint(out: Vec3Like): boolean;
  /** Path-cost layer that steers around known enemies (carriers, medics). */
  threatLayer(): CostLayer | null;
  /** Cover near home looking toward the enemy, one per defender slot. */
  defencePost(slot: number, out: Vec3Like): boolean;
  /** Cover beside the enemy's likely route between the bases. */
  ambushPost(out: Vec3Like): boolean;
  /**
   * Routes from `from` to `to` between the bases: the shortest first, then
   * one that keeps a corridor away from it (when the map has one). Cached
   * per battle; the arrays are shared, never mutate them.
   */
  flagRoutes(from: Vec3Like, to: Vec3Like): Vec3Like[][];
  /** Narrow places on the shortest route from `from` to `to`, in route order (empty when the route is open all along). */
  chokepoints(from: Vec3Like, to: Vec3Like): Vec3Like[];
}

/** How long a sighting counts as knowledge. */
export const SIGHTING_TTL_MS = 6000;
