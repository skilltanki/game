// The bot benchmark page mode: ?bench=ctf&map=island_old_summer&bots=6&seconds=180&seed=1
// Boots the app, starts a battle in which the player's slot is driven by a
// bot too, feeds the battle's deaths and flag events to the engine's
// counters, and after `seconds` of SIM time prints the report as JSON and
// leaves it on globalThis.__bench for a script to read.
import type { BattleConfig, BattleModeId, BotDifficulty } from '../model/BattleConfig';
import type { BenchConfig } from '../model/engine/Bench';

const POLL_MS = 250;
/** Dev server file log (vite.config.ts benchLogPlugin): a heartbeat this often, and the report at the end. */
const HEARTBEAT_MS = 30000;

/** One JSON line to `.bench/events.jsonl` via the dev server; a no-op in production. */
export function benchLog(event: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  const body = JSON.stringify({ at: new Date().toISOString(), ...event });
  void fetch('/__bench', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

export function parseBenchConfig(params: URLSearchParams): BenchConfig {
  const level = (value: string | null): BotDifficulty | null => (value === 'easy' || value === 'normal' || value === 'hard' ? value : null);
  const enemy = level(params.get('enemyDifficulty'));
  return {
    mode: (params.get('bench') || 'ctf') as BattleModeId,
    mapId: params.get('map') ?? 'island_old_summer',
    bots: Number(params.get('bots') ?? 6),
    seconds: Number(params.get('seconds') ?? 180),
    seed: Number(params.get('seed') ?? 1),
    difficulty: level(params.get('difficulty')) ?? 'normal',
    ...(enemy != null ? { enemyDifficulty: enemy } : {}),
  };
}

export async function runBench(config: BenchConfig, canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<void> {
  const { tanki } = await import('../lib/tanki');
  const { engine } = await import('../lib/engine');
  console.info('[bench] config', JSON.stringify(config));
  await tanki.gameFacadeService.boot(canvas, uiRoot);
  tanki.menuService.hide();
  if (new URLSearchParams(location.search).get('debug') === 'nav') {
    tanki.navOverlayService.enable();
  }

  const battle: BattleConfig = {
    mode: config.mode,
    mapId: config.mapId,
    playerName: 'Bench',
    loadout: { hull: 'Hunter', turret: 'Smoky', modification: 'M0' },
    team: 'red',
    bots: config.bots,
    botDifficulty: config.difficulty,
    ...(config.enemyDifficulty != null ? { enemyBotDifficulty: config.enemyDifficulty } : {}),
    seed: config.seed,
  };
  engine.benchService.begin(config);
  await tanki.battleSessionService.start(battle);
  tanki.battleEventService.on('death', (e) => engine.benchService.recordDeath(e.cause));
  tanki.battleEventService.on('flag', (e) => engine.benchService.recordFlag(e.kind, e.byTeam));

  // The player's tank is a bot for the night; the camera still follows it.
  const local = tanki.battleStateService.local;
  await tanki.controlRegistryService.replace(local, engine.botEngineService.createSource({
    id: local.id,
    perception: tanki.perceptionAdapterService.build(local),
    difficulty: config.difficulty,
    seed: config.seed,
  }));
  tanki.hudService.show();

  const tag = `${config.mode}:${config.mapId}#${config.seed}`;
  benchLog({ kind: 'start', tag, config });
  let nextBeat = HEARTBEAT_MS;
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      const state = tanki.battleStateService;
      if (!state.running) {
        window.clearInterval(timer);
        benchLog({ kind: 'abort', tag, simMs: state.timeMs });
        resolve();
        return;
      }
      if (state.timeMs >= nextBeat) {
        nextBeat += HEARTBEAT_MS;
        benchLog({ kind: 'tick', tag, simMs: state.timeMs });
      }
      if (state.timeMs >= config.seconds * 1000) {
        window.clearInterval(timer);
        const report = engine.benchService.report(state.timeMs);
        Object.assign(globalThis, { __bench: report });
        console.info('[bench] report ' + JSON.stringify(report));
        // Any diagnostics a page-side logger left on globalThis.__diag ride along.
        benchLog({ kind: 'report', tag, report, diag: (globalThis as { __diag?: unknown }).__diag ?? null });
        tanki.battleSessionService.finish('time');
        engine.benchService.end();
        resolve();
      }
    }, POLL_MS);
  });
}

// --- navigation-only bench: ?bench=nav&maps=kolhoz_old_summer,deathtrack_old_summer ----

export interface NavBenchReport {
  mapId: string;
  shapes: number;
  gridNodes: number;
  passable: number;
  buildMs: number;
  spawns: number;
  /** Spawn pairs with a complete path / all pairs. */
  reachablePairs: number;
  pairs: number;
  reachableFraction: number;
  /** Spawn points whose nearest passable node is farther than 300 (likely stranded). */
  strandedSpawns: Array<{ type: string; x: number; y: number; z: number; nearest: number }>;
  /** Worst unreachable pairs, a few examples. */
  unreachable: Array<{ from: [number, number, number]; to: [number, number, number] }>;
  pathMsAvg: number;
}

/**
 * Builds the grid for each map and measures spawn-to-spawn reachability.
 * No bots, no battle time: the battle is started with 0 bots, measured,
 * disposed, next map.
 */
export async function runNavBench(mapIds: string[], canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<void> {
  const { tanki } = await import('../lib/tanki');
  const { engine } = await import('../lib/engine');
  await tanki.gameFacadeService.boot(canvas, uiRoot);
  tanki.menuService.hide();
  const reports: NavBenchReport[] = [];
  Object.assign(globalThis, { __navBench: reports, __navBenchDone: false });
  for (const mapId of mapIds) {
    const battle: BattleConfig = {
      mode: 'ctf',
      mapId,
      playerName: 'Bench',
      loadout: { hull: 'Hunter', turret: 'Smoky', modification: 'M0' },
      team: 'red',
      bots: 0,
      botDifficulty: 'normal',
      seed: 1,
    };
    engine.benchService.begin({ mode: 'ctf', mapId, bots: 0, seconds: 0, seed: 1, difficulty: 'normal' });
    try {
      await tanki.battleSessionService.start(battle);
    } catch (error) {
      console.error('[bench nav] failed to load', mapId, error);
      continue;
    }
    const grid = engine.botEngineService.currentGrid;
    const stage = tanki.battleStateService.mapStage;
    const report: NavBenchReport = {
      mapId,
      shapes: stage.staticShapes.length,
      gridNodes: grid?.nodeCount ?? 0,
      passable: 0,
      buildMs: Math.round(engine.benchService.report(0).gridBuildMs),
      spawns: stage.spawnPoints.length,
      reachablePairs: 0,
      pairs: 0,
      reachableFraction: 0,
      strandedSpawns: [],
      unreachable: [],
      pathMsAvg: 0,
    };
    if (grid != null) {
      for (let i = 0; i < grid.nodeCount; i++) {
        if (grid.isPassable(i)) report.passable++;
      }
      const nodes: number[] = [];
      for (const spawn of stage.spawnPoints) {
        const p = spawn.position;
        const node = grid.nearestPassable(p.x, p.y, p.z, 8, 600);
        nodes.push(node);
        const w = { x: 0, y: 0, z: 0 };
        const nearest = node >= 0 ? Math.round(Math.hypot(grid.nodeWorld(node, w).x - p.x, w.y - p.y)) : -1;
        if (node < 0 || nearest > 300) {
          report.strandedSpawns.push({ type: spawn.type, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), nearest });
        }
      }
      let totalMs = 0;
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          report.pairs++;
          if (nodes[a] < 0 || nodes[b] < 0) continue;
          const started = performance.now();
          const path = engine.pathfindingService.findNodes(nodes[a], nodes[b]);
          totalMs += performance.now() - started;
          if (path.status === 'ok') {
            report.reachablePairs++;
          } else if (report.unreachable.length < 6) {
            const pa = stage.spawnPoints[a].position;
            const pb = stage.spawnPoints[b].position;
            report.unreachable.push({ from: [Math.round(pa.x), Math.round(pa.y), Math.round(pa.z)], to: [Math.round(pb.x), Math.round(pb.y), Math.round(pb.z)] });
          }
        }
      }
      report.reachableFraction = report.pairs > 0 ? Number((report.reachablePairs / report.pairs).toFixed(3)) : 1;
      report.pathMsAvg = report.pairs > 0 ? Number((totalMs / report.pairs).toFixed(2)) : 0;
    }
    reports.push(report);
    console.info('[bench nav] ' + JSON.stringify(report));
    tanki.battleSessionService.dispose();
    engine.benchService.end();
  }
  Object.assign(globalThis, { __navBenchDone: true });
}
