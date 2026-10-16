// Entry point of packages/backend (bun). Order matters: the supervisor
// decides first whether this process spawns the others; then the server.
import './main/bootstrap';
import './main/hono';
