import { modelProviders, sessions, settings } from '../database.js';
import { MuseUsageProbe } from './museUsageProbe.js';
import { getProviderAllowanceObserver } from './providerAllowanceServiceInstance.js';

/**
 * Singleton wiring for the Muse subscription-usage probe (FR-2, FR-4).
 *
 * Active only while Muse agents run: `triggerMuseUsageProbe` fires from the
 * turn-completion path for Muse-kind agent turns, and a fixed 5-minute
 * heartbeat fires only while at least one non-archived Muse-agent session
 * is `starting`/`running`. At all other times the service is fully idle: no
 * process, no timer effects, no traffic. Overlapping probes are serialized
 * by the probe's single-flight guard. Everything here is non-critical and
 * never throws into the turn path.
 */

export const MUSE_USAGE_PROBE_HEARTBEAT_MS = 5 * 60_000;

let activeProbe = null;
let heartbeatTimer = null;
let activeDeps = null;
/**
 * Probes with in-flight graceful cleanup (Issue 19): stop() moves the
 * active probe here instead of dropping it, so a repeated signal or the
 * force timeout can still SIGKILL the owned group, and a restart-displaced
 * probe stays owned until its teardown settles. Entries map probe to its
 * cleanup promise and are removed only after teardown finishes.
 */
const drainingCleanups = new Map();

export function startMuseUsageProbe({
  intervalMs = MUSE_USAGE_PROBE_HEARTBEAT_MS,
  createProbe = null,
  sessionRepository = sessions,
  ...probeDeps
} = {}) {
  void stopMuseUsageProbe();
  activeDeps = { sessionRepository };
  activeProbe = createProbe?.()
    ?? new MuseUsageProbe({
      // The factory itself, not its result: the probe calls it as a
      // zero-argument observer source per attempt (same as the Codex meter).
      getObserver: getProviderAllowanceObserver,
      modelProviders,
      settings,
      ...probeDeps,
    });
  heartbeatTimer = setInterval(() => {
    void heartbeatTick().catch(() => { /* never throws (FR-6) */ });
  }, intervalMs);
  heartbeatTimer.unref?.();
  return activeProbe;
}

/**
 * Graceful singleton shutdown (Issue 19): disables the heartbeat and
 * triggers immediately, then returns a promise that settles only after
 * every owned probe's teardown finishes — the shutdown drain awaits it so
 * the process cannot exit first and orphan a SIGTERM-ignoring group.
 * Draining probes stay owned until teardown settles (including probes
 * displaced by a restart); repeated calls share the in-flight cleanup
 * instead of starting duplicate teardowns. Never rejects.
 */
export function stopMuseUsageProbe() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const probe = activeProbe;
  activeProbe = null;
  activeDeps = null;
  // A probe already draining shares its in-flight cleanup: stop() is never
  // invoked twice for the same drain, so no duplicate teardown can race.
  // (Restarts always activate a fresh probe object, which gets its own
  // entry; the force path additionally covers every known probe.)
  if (probe && !drainingCleanups.has(probe)) {
    // Teardown begins synchronously so shutdown timing never depends on a
    // microtask checkpoint; the tracked promise only observes its result.
    let started;
    try {
      started = Promise.resolve(probe.stop?.());
    } catch {
      started = Promise.resolve();
    }
    // The identity check keeps a stale cleanup from dropping a newer entry
    // for the same probe object.
    const tracked = started.catch(() => {}).finally(() => {
      if (drainingCleanups.get(probe) === tracked) drainingCleanups.delete(probe);
    });
    drainingCleanups.set(probe, tracked);
  }
  if (drainingCleanups.size === 0) return Promise.resolve();
  return Promise.allSettled([...drainingCleanups.values()]).then(() => undefined);
}

/**
 * Synchronous best-effort SIGKILL of every still-owned Muse probe group
 * (Issue 19): the active probe plus all draining probes. Runs on the
 * forced-exit paths (repeated signal, force timeout) alongside the
 * command-runner forced cleanup. Works before the lane-entry drain reaches
 * the probe as well as after stop() began, needs no timers or promises,
 * and never throws.
 */
export function forceStopMuseUsageProbe() {
  const probes = new Set(drainingCleanups.keys());
  if (activeProbe) probes.add(activeProbe);
  for (const probe of probes) {
    try {
      probe?.forceKillOwnedGroup?.();
    } catch { /* forced exit: cleanup failures can never block the exit */ }
  }
}

/**
 * Combine forced-exit cleanups into one synchronous best-effort callback
 * (Issue 19): every cleanup runs even when an earlier one throws, so a
 * failing command-runner kill cannot skip the Muse probe kill and vice
 * versa. Used by the entry point's `forceTerminateAgentChildren` and by
 * shutdown regression tests against that same composition.
 */
export function combineForcedCleanup(...cleanups) {
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch { /* best-effort: one failure cannot skip the rest */ }
    }
  };
}

/**
 * Turn-end entry point: fire-and-forget from the turn-completion path for
 * Muse-kind agent turns. Triggers for other agent types (or unknown
 * sessions) are ignored.
 */
export function triggerMuseUsageProbe(sessionId, { sessionRepository = activeDeps?.sessionRepository ?? sessions } = {}) {
  if (!activeProbe) return;
  try {
    if (sessionId !== undefined) {
      const session = sessionRepository?.getById?.(sessionId);
      if (!session || session.agentType !== 'muse') return;
    }
    void activeProbe.trigger()?.catch?.(() => {});
  } catch { /* allowance telemetry is non-critical (FR-6) */ }
}

/** Heartbeat entry point: probes only while a Muse agent is executing. */
export async function heartbeatTick({ sessionRepository = activeDeps?.sessionRepository ?? sessions } = {}) {
  if (!activeProbe) return;
  let executing = false;
  try {
    executing = sessionRepository?.hasExecutingAgentType?.('muse') ?? false;
  } catch {
    return;
  }
  if (!executing) return;
  try {
    await activeProbe.trigger();
  } catch { /* allowance telemetry is non-critical (FR-6) */ }
}

/** @private Test-only singleton control. */
export function _setActiveMuseUsageProbeForTests(probe, deps = null) {
  activeProbe = probe;
  activeDeps = deps;
}
