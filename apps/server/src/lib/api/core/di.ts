// The di-kit activator of the backend. Everything in lib/api registers through
// provide() (core/provide.ts) and is reached through inject() (index.ts).
// Services are stateless: a Worker isolate is created and evicted freely and
// a Durable Object owns its own state, so a service never keeps request,
// room or binding state in a field — it receives them as arguments.
import { createActivator } from 'di-kit';

export const { provide, inject, init } = createActivator('skilltanki-api');
