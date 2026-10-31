// Every download gets up to LOAD_ATTEMPTS tries before it counts as failed:
// a phone on the move drops requests the server would have answered a second
// later, and one lost texture used to skip a prop or fail the whole battle.
//
// The two routes (see AssetProgress) retry in two ways:
//  - PlayCanvas's own loads (textures, sounds): the engine has it built in —
//    `ResourceLoader.enableRetry(n)` sets `maxRetries` on every handler, and
//    the handlers pass it to Http (XHR) and to the Image fallback, which
//    back off 2^n × 100 ms between tries (capped at 5 s). `installLoadRetry`
//    turns it on. The engine retries any failure, a 404 included.
//  - hand-made fetches (`AssetProgress.trackedFetch`): `withRetry` below, the
//    same back-off. A response that should not change — 404 and the other
//    client errors apart from 408/429 — gets ONE more try after the first
//    back-off (the owner's insurance against an answer invented somewhere
//    between the page and the bucket: the service worker never caches a 404
//    and the worker sends one only for a key missing in R2, but one request
//    200 ms later is cheap), then it is final; the full count of tries is
//    for the network and the server (a throw from fetch, 5xx, 408, 429).
//
// A retry happens inside the download's LoadPool slot, so a flaky file keeps
// its slot while it backs off and never floods the pool with repeats.

import type * as pc from 'playcanvas';

/** Tries per download, the first one included. */
export const LOAD_ATTEMPTS = 5;
/** Tries a download gets when the answer is a client error that should not change (404…): one repeat, then final. */
export const PERMANENT_ATTEMPTS = 2;
/** Back-off before try n (1-based retries): 2^n × 100 ms, as the engine does; capped. */
const RETRY_BASE_MS = 100;
const RETRY_CAP_MS = 5000;

export function retryDelayMs(retry: number): number {
  return Math.min(RETRY_CAP_MS, Math.pow(2, retry) * RETRY_BASE_MS);
}

/** An HTTP answer that will not change on a retry (not found, forbidden, gone…); 408 and 429 are worth another try. */
export class PermanentLoadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PermanentLoadError';
  }
}

export function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Runs `attempt` up to LOAD_ATTEMPTS times. A PermanentLoadError ends it
 * after PERMANENT_ATTEMPTS tries; anything else (a network throw, a server
 * error the attempt turned into an Error) waits the back-off and tries
 * again up to the full count.
 */
export async function withRetry<T>(attempt: () => Promise<T>, label: string, attempts = LOAD_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let n = 1; n <= attempts; n++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if ((error instanceof PermanentLoadError && n >= PERMANENT_ATTEMPTS) || n === attempts) {
        break;
      }
      const delay = retryDelayMs(n);
      console.warn(`load: ${label} failed (try ${n}/${attempts}), retrying in ${delay} ms`, error);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** Turns the engine's own retries on for every asset handler (textures, sounds, …). Call once after the app is created. */
export function installLoadRetry(app: pc.AppBase, attempts = LOAD_ATTEMPTS): void {
  app.loader.enableRetry(attempts - 1);
}
