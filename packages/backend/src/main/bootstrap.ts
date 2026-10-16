// `--bootstrap=30050,30051,...`: this process is the supervisor — it spawns
// one child per port (the same entry file with `--port`), respawns a child
// that dies, and serves nothing itself (main/hono.ts checks).
import { api } from '../lib/api';

const { bootstrap } = api.bootstrapService.getArgs();
if (bootstrap != null) {
  const ports = bootstrap
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  console.log('[backend] bootstrap: launching', ports);
  api.bootstrapService.launch(ports);
  api.shutdownService.listen();
}
