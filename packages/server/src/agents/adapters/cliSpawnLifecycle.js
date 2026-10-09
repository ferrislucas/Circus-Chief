/**
 * Shared CLI subprocess-start lifecycle for the Codex, Gemini, and Muse
 * adapters.
 *
 * Node's `child_process.spawn()` returns a ChildProcess even when the
 * executable or working directory is missing; that failure arrives
 * asynchronously as an `error` event with no preceding `spawn` event.
 * Treating the spawner's return as proof that the provider runner owns the
 * turn therefore fabricates acceptance for processes that never started.
 *
 * Every CLI adapter must {@link awaitCliSpawn|await confirmed start} before
 * reporting provider acceptance, with the start/error/cancellation listeners
 * installed synchronously on the spawner's return — before start can be
 * observed. A pre-start failure is a definitive rejection (the provider was
 * never reached), never acceptance and never an execution failure.
 *
 * Spawner contract: the returned child must be an EventEmitter that emits
 * `spawn` exactly when the OS confirms the process started and `error` when
 * the process fails before start. Real `child_process.spawn` satisfies this;
 * DI fakes must emit `spawn` on their success path and omit it on the
 * pre-start error path.
 */

/**
 * Reap a child whose turn aborted before start: SIGTERM now, SIGKILL after
 * the grace period. A spawned-but-unconfirmed child must still be reaped —
 * the stream lifecycle that would otherwise escalate it never attaches.
 */
function reapAbortedChild(child, graceMs) {
  try {
    child.kill?.('SIGTERM');
  } catch { /* already gone */ }
  if (graceMs == null) return;
  const timer = setTimeout(() => {
    try {
      child.kill?.('SIGKILL');
    } catch { /* already gone */ }
  }, graceMs);
  timer.unref?.();
}

/**
 * Wait for confirmed subprocess start.
 *
 * Resolves with `child` on the first `spawn` event. Rejects with the
 * `error` payload when `error` fires before `spawn`, or when `signal`
 * aborts first (reaping the unconfirmed child with escalation). Listeners
 * are removed on settle, so duplicate or late events after the outcome are
 * ignored. A non-emitter child resolves immediately, preserving the legacy
 * return-contract for exotic DI spawners.
 *
 * @param {Object} child - Spawner return value (real ChildProcess or fake)
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Aborts the wait before start
 * @param {number} [options.killGraceMs] - SIGKILL escalation delay after an
 *   abort reap (default 2000, matching the CLI runners)
 * @returns {Promise<Object>} The confirmed child
 */
export function awaitCliSpawn(child, { signal, killGraceMs = 2000 } = {}) {
  if (!child || typeof child.once !== 'function' || typeof child.removeListener !== 'function') {
    return Promise.resolve(child);
  }
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error
      ? signal.reason
      : new Error('CLI process start was aborted before the subprocess started.');
    return Promise.reject(reason);
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onSpawn = () => {
      cleanup();
      resolve(child);
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => {
      cleanup();
      reapAbortedChild(child, killGraceMs);
      const reason = signal.reason instanceof Error
        ? signal.reason
        : new Error('CLI process start was aborted before the subprocess started.');
      reject(reason);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Map a pre-spawn failure to the adapter's stable not-found error.
 *
 * Only `ENOENT` (missing executable) is remapped, with the adapter's
 * unavailable flag set so later turns short-circuit. Every other pre-start
 * failure propagates unchanged: it is still a definitive pre-start
 * rejection (the provider was never reached), classified downstream by its
 * own code/message.
 *
 * @param {Error} error - Rejection from {@link awaitCliSpawn} or a sync spawn throw
 * @param {Object} mapping
 * @param {string} mapping.notFoundCode - Stable code (e.g. `CODEX_CLI_NOT_FOUND`)
 * @param {string} mapping.notFoundMessage - Human message for the not-found error
 * @param {Function} [mapping.markUnavailable] - Sets the adapter's ENOENT cache
 * @returns {Error} The mapped (or original) error
 */
export function mapPreSpawnError(error, { notFoundCode, notFoundMessage, markUnavailable } = {}) {
  if (error?.code === 'ENOENT') {
    try {
      markUnavailable?.();
    } catch { /* caching must never mask the failure */ }
    const notFound = new Error(notFoundMessage);
    notFound.code = notFoundCode;
    return notFound;
  }
  return error;
}

/**
 * Confirm a spawned CLI child started, mapping pre-start failures.
 * Use for both the synchronous spawner throw and the asynchronous
 * spawn wait so the two paths share one mapping.
 *
 * @param {Object} child - Spawner return value
 * @param {Object} options
 * @param {AbortSignal} [options.signal] - Aborts the wait before start
 * @param {number} [options.killGraceMs] - SIGKILL escalation delay after an
 *   abort reap (passed through to {@link awaitCliSpawn})
 * @param {string} options.notFoundCode
 * @param {string} options.notFoundMessage
 * @param {Function} [options.markUnavailable]
 * @returns {Promise<Object>} The confirmed child
 */
export async function confirmCliSpawn(child, { signal, killGraceMs, notFoundCode, notFoundMessage, markUnavailable }) {
  try {
    await awaitCliSpawn(child, { signal, killGraceMs });
  } catch (err) {
    throw mapPreSpawnError(err, { notFoundCode, notFoundMessage, markUnavailable });
  }
  return child;
}
