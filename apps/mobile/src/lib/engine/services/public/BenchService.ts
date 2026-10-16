// Counters for the bot benchmark. The battle (lib/tanki) feeds deaths and
// flag events in; the engine's own services feed stuck episodes, path
// requests and think time; the report is what a run prints.
import type { BenchConfig, BenchReport } from '../../../../model/engine/Bench';

export class BenchService {
  private config: BenchConfig | null = null;
  private startedWall = 0;
  private gridBuildMs = 0;
  private gridNodes = 0;
  private deathsByCause: Record<string, number> = {};
  private flagEvents: Record<string, number> = {};
  private capturesByTeam: Record<string, number> = {};
  private stuckEvents = 0;
  private pathRequests = 0;
  private pathFailures = 0;
  private tickCount = 0;
  private tickTotalMs = 0;
  private tickMaxMs = 0;

  public get active(): boolean {
    return this.config != null;
  }

  public begin = (config: BenchConfig): void => {
    this.config = config;
    this.startedWall = performance.now();
    this.gridBuildMs = 0;
    this.gridNodes = 0;
    this.deathsByCause = {};
    this.flagEvents = {};
    this.capturesByTeam = {};
    this.stuckEvents = 0;
    this.pathRequests = 0;
    this.pathFailures = 0;
    this.tickCount = 0;
    this.tickTotalMs = 0;
    this.tickMaxMs = 0;
  };

  public end = (): void => {
    this.config = null;
  };

  public recordGrid = (nodes: number, buildMs: number): void => {
    this.gridNodes = nodes;
    this.gridBuildMs = buildMs;
  };

  public recordDeath = (cause: string): void => {
    this.deathsByCause[cause] = (this.deathsByCause[cause] ?? 0) + 1;
  };

  public recordFlag = (kind: string, team: string | null): void => {
    this.flagEvents[kind] = (this.flagEvents[kind] ?? 0) + 1;
    if (kind === 'delivered' && team != null) {
      this.capturesByTeam[team] = (this.capturesByTeam[team] ?? 0) + 1;
    }
  };

  public recordStuck = (): void => {
    this.stuckEvents++;
  };

  public recordPathRequest = (ok: boolean): void => {
    this.pathRequests++;
    if (!ok) this.pathFailures++;
  };

  public recordTick = (ms: number): void => {
    this.tickCount++;
    this.tickTotalMs += ms;
    if (ms > this.tickMaxMs) this.tickMaxMs = ms;
  };

  public report = (simMs: number): BenchReport => ({
    config: this.config ?? { mode: 'dm', mapId: '', bots: 0, seconds: 0, seed: 0, difficulty: 'normal' },
    simMs,
    wallMs: Math.round(performance.now() - this.startedWall),
    gridBuildMs: Math.round(this.gridBuildMs),
    gridNodes: this.gridNodes,
    drownings: this.deathsByCause.drown ?? 0,
    deathsByCause: { ...this.deathsByCause },
    flagEvents: { ...this.flagEvents },
    capturesByTeam: { ...this.capturesByTeam },
    stuckEvents: this.stuckEvents,
    pathRequests: this.pathRequests,
    pathFailures: this.pathFailures,
    avgTickMs: this.tickCount > 0 ? Number((this.tickTotalMs / this.tickCount).toFixed(3)) : 0,
    maxTickMs: Number(this.tickMaxMs.toFixed(3)),
  });
}

export default BenchService;
