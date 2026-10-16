// The ONLY view of the static map that lib/engine (bot navigation) may see.
// It is implemented by an adapter in lib/tanki over the engine's physics
// (raycasts into the collision kd-tree); lib/engine itself never imports
// the engine, so the same navigation can later run in a Web Worker or on
// a server against a proxy of this interface.
import type { Vec3Like } from '../TankCommand';

export interface Box3Like {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** What a vertical probe found under a point. */
export interface GroundHit {
  /** Height of the surface hit. */
  z: number;
  /** Z component of the surface normal: 1 = flat, 0 = vertical wall. */
  normalZ: number;
}

export interface StaticWorld {
  /** Union of every static shape's bounding box. */
  readonly bounds: Box3Like;
  /** Below this height a tank has left the map (drowned / fallen off). */
  readonly killZ: number;
  /** Gravity magnitude, sim units per s^2 (positive). */
  readonly gravity: number;
  /**
   * Nearest static surface straight DOWN from (x, y, fromZ) within `depth`.
   * false = nothing (water, the void off the map's edge).
   */
  raycastDown(x: number, y: number, fromZ: number, depth: number, out: GroundHit): boolean;
  /** True when nothing static lies straight UP from (x, y, z) within `height`. */
  headroom(x: number, y: number, z: number, height: number): boolean;
  /** True when an axis-aligned box centred at (cx, cy, cz) with half extents overlaps static geometry. */
  probeBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean;
  /** True when nothing static blocks the segment a -> b. */
  lineOfSight(a: Vec3Like, b: Vec3Like): boolean;
}
