import { spawn } from 'child_process';
import { createMuseExecProtocol } from '../agents/adapters/museExecProtocol.js';
import { createRobustEnv } from './nodeSpawnHelper.js';

/**
 * Meta (`muse exec`) probe toolkit: process mechanics shared by the
 * provider connection test. Lives here (not in providerTestService.js) so
 * that file stays under the project's max-lines budget.
 */

/**
 * Grace period between the probe timeout's SIGTERM and its SIGKILL
 * escalation (finding #2). Overridable via `deps.probeKillGraceMs` in
 * tests; the adapter's `shutdownGraceMs` is the twin mechanism for real
 * turns (see MuseExecAdapter's armEscalation).
 */
const PROBE_KILL_GRACE_MS = 2_000;

/**
 * Default spawn for the Meta connection test. Plain `spawn` with a robust
 * env (Node on PATH) — no E2E capture hook: E2E Muse coverage is out of
 * scope until the adapter has E2E fixtures. Detached on POSIX so a timeout
 * can signal the whole process group (round-3 finding #10).
 */
export function defaultMuseTestSpawn({ command, args, cwd, env }) {
  return spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: createRobustEnv(env),
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
}

/**
 * Kill a timed-out meta probe, group first (round-3 finding #10): `muse
 * exec` can leave grandchildren behind a direct `child.kill`, so signal the
 * process group the detached spawn created. Falls back to `child.kill` when
 * there is no group to signal (no pid, Windows, already reaped). The group
 * kill is injectable via `deps.killProcessGroup` for tests. Pass
 * `force=true` for the SIGKILL escalation after the grace period.
 */
export function killMuseTestProcess(child, killProcessGroup, force = false) {
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  const killGroup = killProcessGroup || ((pid, sig) => process.kill(pid, sig));
  if (child?.pid && process.platform !== 'win32') {
    try {
      killGroup(-child.pid, signal);
      return;
    } catch {
      // No group to signal — fall through to the direct kill.
    }
  }
  try { child.kill(signal); } catch { /* ignore */ }
}

/**
 * Schedule the SIGKILL escalation for a probe child that survives the
 * timeout's SIGTERM (finding #2). Returns the timer so the caller can clear
 * it when the child exits on its own. Unref'd so a lingering escalation
 * never holds the server event loop open.
 */
export function scheduleProbeKillEscalation(child, deps = {}) {
  const timer = setTimeout(
    () => killMuseTestProcess(child, deps.killProcessGroup, true),
    deps.probeKillGraceMs ?? PROBE_KILL_GRACE_MS,
  );
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Track the probe child's stdout strictness (finding #6): collects the
 * validated terminal record like the adapter does, and marks the stream
 * invalid when parsing fails — including a trailing partial JSON record
 * after a valid terminal, which `protocol.end()` rejects on stdout close.
 */
export function createProbeStreamTracker(protocol = createMuseExecProtocol()) {
  const state = { terminal: null, outputValid: true };
  return {
    state,
    onData(d) {
      if (!state.outputValid) return;
      try {
        for (const item of protocol.push(d)) {
          if (item?.kind === 'terminal') state.terminal = item;
        }
      } catch {
        state.outputValid = false;
      }
    },
    onClose() {
      if (!state.outputValid) return;
      try {
        for (const item of protocol.end()) {
          if (item?.kind === 'terminal') state.terminal = item;
        }
      } catch {
        state.outputValid = false;
      }
    },
  };
}

/**
 * Build the headless `muse exec` argv for the Meta connection test (pure).
 *
 * No no-cost probe exists: `muse auth` only stores keys (verified against
 * `muse --help` — there is no `auth status` equivalent), so the test stays
 * one minimal billed `exec` turn. Sandbox stays ON (default); no session
 * log is written. Throws when no working directory is set — falling back
 * to the server cwd would test the wrong directory.
 *
 * @param {Object} config - `{ workingDirectory, defaultSonnetModel }`.
 * @returns {{ command: string, args: string[], cwd: string, model: string }}
 */
export function buildMuseTestArgs(config) {
  if (!config?.workingDirectory) {
    const error = new Error('A working directory is required to test the Muse connection.');
    error.code = 'MISSING_WORKING_DIRECTORY';
    throw error;
  }
  // Last-resort-only fallback (finding #9): always prefer the configured
  // model — this test turn is billed — the literal exists solely so a
  // model-less provider can still probe binary presence + auth.
  const model = config.defaultSonnetModel || 'muse-spark-1.3';
  return {
    command: process.env.MUSE_BIN || 'muse',
    args: ['exec', '--json', '--no-session-log', '--workspace', config.workingDirectory, '--model', model, 'Hi'],
    cwd: config.workingDirectory,
    model,
  };
}
