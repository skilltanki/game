// How the process was started and what it is: `--port=N` serves on N;
// `--bootstrap=N1,N2,...` makes this process the supervisor that spawns one
// child per port (bun, the same entry file) and respawns a child that dies;
// `--firstPort` marks the child that runs the periodic sweeper (one per
// deployment is enough). Mirrors airport-monorepo's BootstrapService minus
// the IPC bus: the processes talk through Redis pub/sub instead.
import { parseArgs } from 'node:util';
import { singleshot } from 'functools-kit';

export interface BootstrapArgs {
  bootstrap?: string;
  port?: string;
  firstPort?: boolean;
}

const RESPAWN_DELAY_MS = 1000;

export class BootstrapService {
  private readonly children = new Map<number, ReturnType<typeof Bun.spawn>>();
  /** A shutdown in progress: a child that exits now is not respawned. */
  private stopping = false;

  public getArgs = singleshot((): BootstrapArgs => {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        bootstrap: { type: 'string' },
        port: { type: 'string' },
        firstPort: { type: 'boolean' },
      },
      strict: false,
      allowPositionals: true,
    });
    return values as BootstrapArgs;
  });

  /** The port this process serves on (null for the supervisor). */
  public get port(): number | null {
    const { port } = this.getArgs();
    const value = port != null ? Number(port) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** True for the supervisor process (it serves nothing itself). */
  public get isSupervisor(): boolean {
    return this.getArgs().bootstrap != null;
  }

  /** The one process that runs the sweeper: `--firstPort` (the supervisor gives it to its first child). */
  public get isFirst(): boolean {
    return this.getArgs().firstPort === true;
  }

  public getLoggerKey = singleshot((): string => {
    const { bootstrap, port } = this.getArgs();
    return bootstrap != null ? 'bootstrap' : `port-${port ?? 'none'}`;
  });

  /** The supervisor: one child per port, respawned when it exits. */
  public launch = (ports: number[]): void => {
    ports.forEach((port, index) => this.spawn(port, index === 0));
  };

  /** The supervisor's shutdown: every child gets SIGTERM and is not respawned. */
  public stopChildren = (): void => {
    this.stopping = true;
    for (const [port, child] of this.children) {
      try {
        child.kill('SIGTERM');
      } catch {
        console.warn(`[backend] bootstrap: port ${port} could not be signalled`);
      }
    }
  };

  private spawn(port: number, first: boolean): void {
    const cmd = [process.execPath, Bun.main, `--port=${port}`, ...(first ? ['--firstPort'] : [])];
    const child = Bun.spawn(cmd, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'inherit', 'inherit'],
      onExit: (_proc, code) => {
        if (this.stopping) {
          console.log(`[backend] bootstrap: port ${port} stopped (${code})`);
          return;
        }
        console.warn(`[backend] bootstrap: port ${port} exited (${code}); respawning in ${RESPAWN_DELAY_MS} ms`);
        setTimeout(() => this.spawn(port, first), RESPAWN_DELAY_MS);
      },
    });
    this.children.set(port, child);
    console.log(`[backend] bootstrap: port ${port} pid ${child.pid}${first ? ' (first: sweeper)' : ''}`);
  }
}

export default BootstrapService;
