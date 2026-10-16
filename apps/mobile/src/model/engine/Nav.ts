// Walkability grid vocabulary. The map is sampled on a square grid of
// columns; each column holds the LEVELS (floors) a tank could stand on,
// stacked by height (a bridge over a road is two levels in one column).
// A node = one level of one column. Edges join nodes of neighbouring
// columns when a tank can drive between them (step, slope, or a drop).
import type { Vec3Like } from '../TankCommand';

export interface NavParams {
  /** Grid pitch, sim units (1 m = 100). */
  cellSize: number;
  /** Largest vertical lip the hull climbs as a step (measured: curbs 15-30, crates 65 are walls). */
  stepUp: number;
  /** Largest drop a node may join one-way (the tank jumps down, cannot come back). */
  stepDown: number;
  /** Steepest rise per horizontal unit an edge may join (50 deg: iran's 46-48 deg stairs are climbable, slowly). */
  maxSlopeTan: number;
  /** Surface normal.z at/above which a level is flat enough to be a floor (38 deg). */
  walkableNormalZ: number;
  /**
   * Surface normal.z between this (49 deg) and walkableNormalZ: a floor,
   * but marginal (cost x3). Measured: a Hunter crawls up a 45-48 deg face
   * at 40-120 u/s and makes it; traction is gone by 60 deg.
   */
  marginalNormalZ: number;
  /** Clear height a level needs above it (the tallest hull plus suspension). */
  tankHeight: number;
  /** Levels closer than this merge (two probes hitting the same floor). */
  minLevelGap: number;
  /** Most levels kept per column (madness stacks ~20 platforms per map, not per column). */
  maxLevels: number;
  /**
   * Nodes closer than this (in cells) to a DROP (void, water, a cliff deeper
   * than stepDown) are impassable: 1 keeps the hull centre >= 150 from the
   * edge, which a 250-wide ramp still allows; the edge cost shaping keeps
   * paths farther away wherever there is room.
   */
  minDropClearance: number;
  /**
   * Nodes closer than this to a WALL (a blocked or higher floor next door)
   * are impassable. Walls only bump, so 1 (never the cell touching it).
   */
  minWallClearance: number;
}

export const DEFAULT_NAV_PARAMS: NavParams = {
  cellSize: 100,
  stepUp: 30,
  stepDown: 250,
  maxSlopeTan: Math.tan((50 * Math.PI) / 180),
  walkableNormalZ: Math.cos((38 * Math.PI) / 180),
  marginalNormalZ: Math.cos((49 * Math.PI) / 180),
  tankHeight: 220,
  minLevelGap: 40,
  maxLevels: 8,
  minDropClearance: 1,
  minWallClearance: 1,
};

/** Node flags (bit set). */
export const NAV_WALKABLE = 1;
export const NAV_MARGINAL = 2;
/** Not enough headroom for a hull. */
export const NAV_LOW = 4;
/**
 * A surface steeper than the marginal limit (a trench wall, an embankment,
 * a rock face): never a floor and skipped by every lookup, recorded only so
 * the clearance pass can tell a wall (steep surface ABOVE the neighbouring
 * floor) from a drop (nothing there, or a surface below). Kolhoz's sunken
 * roads read as drop edges on both sides otherwise, and the drop guard
 * vetoed every move along them.
 */
export const NAV_STEEP = 8;

/** Neighbour directions, in the order edges are stored per node. */
export const NAV_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], // cardinal first
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];
export const NAV_DIR_COUNT = 8;

/** Per-node additive cost multipliers (threats, allies' occupancy...), indexed by node. */
export type CostLayer = Float32Array;

export interface NavBuildProgress {
  /** Columns scanned so far / total. */
  done: number;
  total: number;
}

export interface NavDebugSnapshot {
  cellSize: number;
  /** Node centres with flags and drop clearance (for the dev overlay). */
  nodes: Array<{ x: number; y: number; z: number; flags: number; clearance: number; passable: boolean }>;
  /** Last planned path per bot. */
  paths: Array<{ id: string; points: Vec3Like[] }>;
}
