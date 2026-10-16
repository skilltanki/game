// Headless-ish benchmark of the bots: a battle of bots only, driven by the
// normal battle loop, with counters of what matters (drownings, captures,
// stuck events, path failures, think time).
import type { BattleModeId } from '../BattleConfig';

export interface BenchConfig {
  mode: BattleModeId;
  mapId: string;
  bots: number;
  seconds: number;
  seed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  /** Enemy side's difficulty when it differs (balance runs: `?enemyDifficulty=`). */
  enemyDifficulty?: 'easy' | 'normal' | 'hard';
}

export interface BenchReport {
  config: BenchConfig;
  /** Simulated milliseconds the bench ran. */
  simMs: number;
  /** Wall-clock milliseconds the bench took. */
  wallMs: number;
  gridBuildMs: number;
  gridNodes: number;
  drownings: number;
  deathsByCause: Record<string, number>;
  flagEvents: Record<string, number>;
  capturesByTeam: Record<string, number>;
  stuckEvents: number;
  pathRequests: number;
  pathFailures: number;
  /** Think time per bot per tick, ms. */
  avgTickMs: number;
  maxTickMs: number;
}
