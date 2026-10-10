import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teardownProbeChild } from './museUsageProbeSupport.js';

const POSIX = process.platform !== 'win32';

function createGroupFake({ pid = 4242 } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn(), destroy: vi.fn() }),
    stderr: { resume: vi.fn(), destroy: vi.fn() },
    kill: vi.fn(),
  });
  if (pid !== undefined) child.pid = pid;
  return child;
}

/**
 * Group-signal double: the owned group stays alive while its descendant
 * ignores SIGTERM, and is gone once it takes SIGKILL. `signal === 0`
 * probes liveness without delivering a signal.
 */
function createGroupDouble() {
  const signals = [];
  let alive = true;
  const killProcessGroup = vi.fn((pid, signal) => {
    signals.push([pid, signal]);
    if (signal === 0) {
      if (!alive) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      return;
    }
    if (signal === 'SIGKILL') alive = false;
  });
  return { signals, killProcessGroup };
}

describe('teardownProbeChild process-group ownership (Issue 15)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(POSIX)('reaps an owned group that outlives its host', async () => {
    const child = createGroupFake();
    const { signals, killProcessGroup } = createGroupDouble();
    const closeReadline = vi.fn();
    const teardown = teardownProbeChild({
      child, closeReadline, killGraceMs: 20, killProcessGroup,
    });
    child.emit('exit', 0);
    await teardown;

    expect(signals.map(([, signal]) => signal)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -child.pid)).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    expect(closeReadline).toHaveBeenCalledTimes(1);
    expect(child.stdout.destroy).toHaveBeenCalledTimes(1);
    expect(child.stderr.destroy).toHaveBeenCalledTimes(1);
  });

  it.runIf(POSIX)('escalates a hanging host and group to SIGKILL', async () => {
    const child = createGroupFake();
    const { signals, killProcessGroup } = createGroupDouble();
    const closeReadline = vi.fn();
    await teardownProbeChild({
      child, closeReadline, killGraceMs: 20, killProcessGroup,
    });

    const delivered = signals.map(([, signal]) => signal);
    expect(delivered[0]).toBe('SIGTERM');
    expect(delivered).toContain('SIGKILL');
    expect(closeReadline).toHaveBeenCalledTimes(1);
  });

  it.runIf(POSIX)('reaps survivors when the host exits during the grace period', async () => {
    const child = createGroupFake();
    const { signals, killProcessGroup } = createGroupDouble();
    const closeReadline = vi.fn();
    const teardown = teardownProbeChild({
      child, closeReadline, killGraceMs: 60, killProcessGroup,
    });
    setTimeout(() => child.emit('exit', 0), 10);
    await teardown;

    expect(signals.map(([, signal]) => signal)).toContain('SIGKILL');
    expect(closeReadline).toHaveBeenCalledTimes(1);
  });

  it('falls back to the direct child when no group exists', async () => {
    const child = createGroupFake({ pid: undefined });
    const killProcessGroup = vi.fn(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    const closeReadline = vi.fn();
    const teardown = teardownProbeChild({
      child, closeReadline, killGraceMs: 20, killProcessGroup,
    });
    child.emit('exit', 0);
    await teardown;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(closeReadline).toHaveBeenCalledTimes(1);
  });

  it('treats a missing group as already cleaned up', async () => {
    const child = createGroupFake();
    const killProcessGroup = vi.fn(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    const closeReadline = vi.fn();
    const teardown = teardownProbeChild({
      child, closeReadline, killGraceMs: 20, killProcessGroup,
    });
    child.emit('exit', 0);
    await teardown;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(closeReadline).toHaveBeenCalledTimes(1);
  });
});

const DESCENDANT_SOURCE = [
  "process.on('SIGTERM', () => {});",
  "require('fs').writeFileSync(process.argv[1], 'ready');",
  'setInterval(() => {}, 250);',
].join(' ');

function hostSource(mode, readyFile, pidFile) {
  // The host blocks until the descendant has installed its SIGTERM handler
  // and signaled readiness, so teardown cannot race descendant startup: any
  // SIGTERM the group takes afterwards is genuinely ignored, not early.
  const spawnDescendant = [
    "const fs = require('fs');",
    "const { spawn: spawnChild } = require('child_process');",
    `const descendant = spawnChild(process.execPath, ['-e', ${JSON.stringify(DESCENDANT_SOURCE)}, ${JSON.stringify(readyFile)}], { stdio: 'ignore' });`,
    'const waitStart = Date.now();',
    `while (!fs.existsSync(${JSON.stringify(readyFile)}) && Date.now() - waitStart < 5000) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));`,
  ].join('\n');
  if (mode === 'hang') {
    return `${spawnDescendant}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 250);`;
  }
  if (mode === 'delayed-exit') {
    return `${spawnDescendant}\nsetTimeout(() => process.exit(0), 30); setInterval(() => {}, 250);`;
  }
  return `${spawnDescendant}\nprocess.exit(0);`;
}

async function waitForDescendantPid(readyFile, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    try {
      const pid = Number.parseInt(readFileSync(readyFile, 'utf8'), 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch { /* not written yet */ }
    if (Date.now() - start >= timeoutMs) throw new Error(`timed out waiting for ${readyFile}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Delivered signals only: `0` entries are liveness probes, not signals. */
function deliveredSignals(signals) {
  return signals.map(([, signal]) => signal).filter((signal) => signal !== 0);
}

/**
 * True while `pid` still names a live process. Only ESRCH (no such process)
 * reads as cleaned up; any other outcome — including EPERM, which proves a
 * process exists that we may not signal — conservatively reads as alive so
 * observation failures can never masquerade as successful cleanup.
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return false;
    return true;
  }
}

/** True while the owned POSIX process group still has live members. */
function isGroupAlive(pid) {
  if (pid === undefined || pid === null || process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    if (err?.code === 'ESRCH') return false;
    return true;
  }
}

/**
 * Verification harness for the live fixtures (Issue 18): rejects
 * pre-recovery observations that show survivors. Recovery in `finally`
 * cleans up afterwards, but it must never be what the assertions credit —
 * a broken teardown masked by recovery has to fail here.
 */
function assertTeardownCleanedUp({ preRecoveryDescendantAlive, preRecoveryGroupAlive }) {
  if (preRecoveryDescendantAlive || preRecoveryGroupAlive) {
    throw new Error(
      `teardown left survivors before recovery: descendantAlive=${preRecoveryDescendantAlive} groupAlive=${preRecoveryGroupAlive}`,
    );
  }
}

describe.runIf(POSIX)('teardownProbeChild owned process group (live fixture)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runHostFixture(mode, killGraceMs = 300, { teardown = teardownProbeChild } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'muse-probe-group-'));
    const readyFile = join(dir, 'descendant.ready');
    const pidFile = join(dir, 'descendant.pid');
    const child = spawn(process.execPath, ['-e', hostSource(mode, readyFile, pidFile)], {
      detached: true,
      stdio: 'ignore',
    });
    const signals = [];
    const closeReadline = vi.fn();
    try {
      const descendantPid = await waitForDescendantPid(pidFile);
      await teardown({
        child,
        closeReadline,
        killGraceMs,
        killProcessGroup: (pid, signal) => {
          signals.push([pid, signal]);
          process.kill(pid, signal);
        },
      });
      // Captured here — after teardown resolves but before the `finally`
      // recovery below — so the caller's assertions credit teardown itself,
      // never the emergency cleanup.
      const preRecoveryDescendantAlive = isPidAlive(descendantPid);
      const preRecoveryGroupAlive = isGroupAlive(child.pid);
      return {
        descendantPid,
        hostPid: child.pid,
        signals,
        closeReadline,
        preRecoveryDescendantAlive,
        preRecoveryGroupAlive,
      };
    } finally {
      try {
        if (child.pid && isGroupAlive(child.pid)) process.kill(-child.pid, 'SIGKILL');
      } catch { /* already reaped */ }
      // Bounded drain: SIGKILL lands asynchronously and zombies still
      // answer signal 0 until reaped, so wait for the owned group to
      // disappear before returning — recovery must leave no owned
      // processes behind, even when teardown was a broken no-op.
      const recoverStart = Date.now();
      while (child.pid && isGroupAlive(child.pid) && Date.now() - recoverStart < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('kills an ignoring descendant after its host exits first', async () => {
    const result = await runHostFixture('early-exit');
    const { hostPid, signals, closeReadline } = result;

    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(deliveredSignals(signals).every((signal) => signal === 'SIGTERM' || signal === 'SIGKILL')).toBe(true);
    // Proves teardown itself reaped the owned processes: captured before
    // the fixture's emergency recovery could mask a broken teardown.
    expect(result.preRecoveryDescendantAlive).toBe(false);
    expect(result.preRecoveryGroupAlive).toBe(false);
    assertTeardownCleanedUp(result);
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);

  it('escalates a hanging host and descendant to SIGKILL', async () => {
    const result = await runHostFixture('hang');
    const { hostPid, signals, closeReadline } = result;

    expect(deliveredSignals(signals)[0]).toBe('SIGTERM');
    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(result.preRecoveryDescendantAlive).toBe(false);
    expect(result.preRecoveryGroupAlive).toBe(false);
    assertTeardownCleanedUp(result);
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);

  it('reaps survivors when the host exits during the grace period', async () => {
    const result = await runHostFixture('delayed-exit');
    const { hostPid, signals, closeReadline } = result;

    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(result.preRecoveryDescendantAlive).toBe(false);
    expect(result.preRecoveryGroupAlive).toBe(false);
    assertTeardownCleanedUp(result);
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);

  it('proves recovery cannot mask a broken teardown (negative control)', async () => {
    // Teardown replaced with a no-op double: the owned processes must still
    // be alive when observed, and the verification harness must reject
    // those observations — even though `finally` cleans them up afterwards.
    const result = await runHostFixture('hang', 300, {
      // Broken-teardown double: deliberately cleans nothing.
      teardown: async () => {},
    });

    expect(result.preRecoveryDescendantAlive).toBe(true);
    expect(result.preRecoveryGroupAlive).toBe(true);
    expect(() => assertTeardownCleanedUp(result)).toThrow();
    // Emergency recovery still leaves no owned processes behind.
    expect(isPidAlive(result.descendantPid)).toBe(false);
    expect(isGroupAlive(result.hostPid)).toBe(false);
  }, 15000);
});
