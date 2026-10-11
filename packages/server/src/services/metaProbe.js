import { spawn } from 'child_process';
import { createMuseExecProtocol } from '../agents/adapters/museExecProtocol.js';
import { createRobustEnv } from './nodeSpawnHelper.js';

/**
 * Meta (`muse exec`) probe toolkit: process mechanics shared by the
 * provider connection test, plus the owned-process-group lifecycle
 * (teardown escalation and forced SIGKILL) for the Muse subscription-usage
 * probe's detached `muse serve` child. The group mechanics live here (not
 * in museUsageProbeSupport.js) so that file stays under the project's
 * max-lines budget.
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
 * Wait for a probe child to exit, resolving false after `timeoutMs` while
 * the caller keeps draining output. Works with real ChildProcess handles
 * and emitter fakes alike.
 */
export function waitForProbeChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.off?.('exit', onExit);
      child.off?.('close', onExit);
    };
    const onExit = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    child.once?.('exit', onExit);
    child.once?.('close', onExit);
  });
}

/**
 * True while the probe's owned POSIX process group still has live members.
 * A missing group (already reaped, Windows, no pid) reads as cleaned up,
 * never as a reason to signal. Liveness is probed with signal `0`, which
 * delivers nothing — only the caller's teardown signals the group.
 */
export function probeGroupAlive(child, killProcessGroup) {
  if (!child?.pid || process.platform === 'win32') return false;
  const signal = killProcessGroup || ((pid, sig) => process.kill(pid, sig));
  try {
    signal(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the owned group to drain, polling liveness on a bounded,
 * `unref`d cadence so an orphaned group never holds the server event loop
 * open past `timeoutMs`. Works with real ChildProcess handles and with
 * group-signal doubles alike.
 */
export function waitForProbeGroupExit(child, timeoutMs, killProcessGroup) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (!probeGroupAlive(child, killProcessGroup)) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      const timer = setTimeout(poll, 10);
      timer.unref?.();
    };
    poll();
  });
}

/**
 * Tear a probe child down with SIGTERM→SIGKILL escalation on hang (FR-7).
 * The direct child's exit (or close) is not proof its group exited: the
 * host can exit before its descendants (MCP servers, launched tools), so an
 * owned group that outlives the host is reaped with the same bounded
 * escalation. Stdout keeps draining through the grace period: stdio is
 * destroyed and the readline closed only after the child and its group exit
 * or are force-killed, so no output is lost and the single-flight guard
 * (held by the caller) covers the whole teardown. Only the probe's owned
 * group (`-child.pid`, which the detached spawn establishes) is ever
 * signaled. Takes the pieces explicitly so the owning class stays under
 * budget.
 */
async function reapProbeGroupChild(child, killGraceMs, killProcessGroup) {
  if (!probeGroupAlive(child, killProcessGroup)) return;
  killMuseTestProcess(child, killProcessGroup);
  const reaped = await waitForProbeGroupExit(child, killGraceMs, killProcessGroup);
  if (reaped) return;
  killMuseTestProcess(child, killProcessGroup, true);
  await waitForProbeGroupExit(child, killGraceMs, killProcessGroup);
}

/**
 * Synchronously SIGKILL the probe's owned process group (Issue 19): the
 * forced-exit path (a repeated signal or the shutdown force timeout) cannot
 * wait for the graceful SIGTERM→SIGKILL escalation above — no timer it
 * schedules could run before the exit that follows. Best-effort and purely
 * synchronous: no timers, no awaits, never throws. Only the owned group
 * (`-child.pid`) is ever signaled, falling back to the direct child when no
 * group exists; a missing child is a safe no-op. The group is signaled even
 * when its host already exited, since descendants outlive the host.
 */
export function forceKillProbeGroup({ child, killProcessGroup }) {
  if (!child) return;
  try {
    killMuseTestProcess(child, killProcessGroup, true);
  } catch { /* forced exit: cleanup failures can never block the exit */ }
}

export async function teardownProbeChild({ child, closeReadline, killGraceMs, killProcessGroup }) {
  try {
    if (child) {
      killMuseTestProcess(child, killProcessGroup);
      const exited = await waitForProbeChildExit(child, killGraceMs);
      if (!exited) {
        killMuseTestProcess(child, killProcessGroup, true);
        await waitForProbeChildExit(child, killGraceMs);
      }
      await reapProbeGroupChild(child, killGraceMs, killProcessGroup);
    }
  } catch { /* teardown never fails the probe */ }
  try {
    child?.stdout?.destroy?.();
    child?.stderr?.destroy?.();
  } catch { /* ignore */ }
  try {
    closeReadline?.();
  } catch { /* ignore */ }
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
