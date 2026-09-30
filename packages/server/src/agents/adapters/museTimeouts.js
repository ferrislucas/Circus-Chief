/**
 * Timeout budgets and deadline helpers for the Muse adapter's owned-host
 * lifecycle. Extracted from MuseAdapter.js so the adapter stays under the
 * repo's size gates without a file-level eslint-disable.
 */

/** A typed, actionable failure that the session error path can safely surface. */
export class MuseTurnTimeoutError extends Error {
  constructor(phase, timeoutMs, details = {}) {
    super(`Muse turn timed out during ${phase} after ${timeoutMs}ms. The Muse host was closed; retry the turn or cancel it explicitly.`);
    this.name = 'MuseTurnTimeoutError';
    this.code = 'MUSE_TURN_TIMEOUT';
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    Object.assign(this, details);
  }
}

export const DEFAULT_TIMEOUTS = Object.freeze({
  startupMs: 30_000,
  // Own budget for submitting the user turn: large enough for a slow host
  // handshake (well above 45s) but still bounded; also capped per-turn by
  // the remaining turnMs at the call site.
  sendTurnMs: 120_000,
  turnMs: 15 * 60_000,
  shutdownGraceMs: 2_000,
});

/**
 * Race a host-lifecycle promise against a phase budget. On timeout the
 * owned host is closed via `onTimeout` and a MuseTurnTimeoutError throws.
 * A late-resolving promise is handed to `onLateResolve` so an owned
 * process cannot leak.
 */
export async function deadline(promise, { timeoutMs, phase, context, onTimeout, onLateResolve } = {}) {
  let timer;
  let timedOut = false;
  const guarded = Promise.resolve(promise);
  // If a timed-out spawn later resolves, close it so an owned process cannot leak.
  guarded.then((value) => (timedOut ? onLateResolve?.(value) : undefined)).catch(() => undefined);
  try {
    return await Promise.race([
      guarded,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          Promise.resolve(onTimeout?.()).catch(() => undefined);
          reject(new MuseTurnTimeoutError(phase, timeoutMs, { correlationId: context.correlationId }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function timeoutAndClose({ phase, timeoutMs, context, host, controller }) {
  const error = new MuseTurnTimeoutError(phase, timeoutMs, { correlationId: context.correlationId, museSessionId: context.sessionId });
  controller?.abort(error);
  await host.close();
  throw error;
}

/**
 * Remaining overall turn budget. Throws (closing the host) once exhausted.
 */
export async function remainingMuseTurnMs(turnMs, context, host, controller) {
  const remainingMs = turnMs - (Date.now() - context.timings.startedAt);
  if (remainingMs <= 0) await timeoutAndClose({ phase: 'turn', timeoutMs: turnMs, context, host, controller });
  return remainingMs;
}
