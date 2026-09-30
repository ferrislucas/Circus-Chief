import { logMuseLifecycle } from './museLifecycle.js';

/**
 * Close the owned `muse serve` host, force-terminating it when the
 * graceful close hangs past the shutdown budget. Never lets a hung
 * client implementation stall the failed-turn path indefinitely.
 */
export async function closeMuseHost({ client, pid, context, shutdownGraceMs, forceTerminateHost, sdkVersion }) {
  let graceTimer;
  let graceful = true;
  const closePromise = Promise.resolve().then(() => client.close());
  // A client implementation is allowed to hang during its graceful close.
  // Never let that make the failed-turn path hang indefinitely.
  closePromise.catch(() => undefined);
  try {
    await Promise.race([
      closePromise,
      new Promise((resolve) => {
        graceTimer = setTimeout(() => {
          graceful = false;
          resolve();
        }, shutdownGraceMs);
      }),
    ]);
    if (!graceful) {
      context.markShutdown('forced');
      await Promise.resolve(forceTerminateHost(client, pid)).catch((err) => {
        console.warn(`[MuseAdapter] Failed to force-terminate Muse host ${pid}: ${err?.message || err}`);
      });
    } else {
      context.markShutdown('graceful');
    }
  } catch (err) {
    context.markShutdown('close-error');
    console.warn(`[MuseAdapter] Error closing Muse host: ${err?.message || err}`);
  } finally {
    clearTimeout(graceTimer);
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: pid, museSessionId: context.sessionId, sdkVersion, cliVersion: context.cliVersion, timings: context.timings, phase: `shutdown-${context.shutdown || 'unknown'}` });
  }
}

export function forceTerminateMuseHost(client, pid) {
  if (typeof client.forceTerminate === 'function') return client.forceTerminate();
  if (typeof client.kill === 'function') return client.kill('SIGKILL');
  if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err) {
      if (err?.code !== 'ESRCH') throw err;
    }
  }
}
