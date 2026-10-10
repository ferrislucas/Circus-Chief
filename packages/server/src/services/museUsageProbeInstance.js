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

export function startMuseUsageProbe({
  intervalMs = MUSE_USAGE_PROBE_HEARTBEAT_MS,
  createProbe = null,
  sessionRepository = sessions,
  ...probeDeps
} = {}) {
  stopMuseUsageProbe();
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

export function stopMuseUsageProbe() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const probe = activeProbe;
  activeProbe = null;
  activeDeps = null;
  try {
    void probe?.stop?.()?.catch?.(() => {});
  } catch { /* non-critical */ }
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
