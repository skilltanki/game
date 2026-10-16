// What a strategy tells the rest of the brain to do this tick.
import type { Vec3Like } from './TankCommand';
import type { TankView } from './Perception';

export type BotRole = 'attacker' | 'defender' | 'hunter';

export type Objective =
  /** Close in on a tank and shoot it; `mobile` = keep shuffling sideways at the hold distance instead of standing (persona). */
  | { kind: 'hunt'; target: TankView; mobile?: boolean }
  /** Drive to a point; shoot whatever shows up on the way when `engage`. */
  | { kind: 'goto'; point: Vec3Like; engage: boolean; arriveRadius: number }
  /** Stay around a point; fight anything that comes within `radius`. */
  | { kind: 'hold'; point: Vec3Like; radius: number }
  /** No target: wander. */
  | { kind: 'roam' };
