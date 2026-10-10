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

function groupIsAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(POSIX)('teardownProbeChild owned process group (live fixture)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runHostFixture(mode, killGraceMs = 300) {
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
      await teardownProbeChild({
        child,
        closeReadline,
        killGraceMs,
        killProcessGroup: (pid, signal) => {
          signals.push([pid, signal]);
          process.kill(pid, signal);
        },
      });
      return { descendantPid, hostPid: child.pid, signals, closeReadline };
    } finally {
      try {
        if (child.pid && groupIsAlive(child.pid)) process.kill(-child.pid, 'SIGKILL');
      } catch { /* already reaped */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('kills an ignoring descendant after its host exits first', async () => {
    const { descendantPid, hostPid, signals, closeReadline } = await runHostFixture('early-exit');

    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(deliveredSignals(signals).every((signal) => signal === 'SIGTERM' || signal === 'SIGKILL')).toBe(true);
    expect(() => process.kill(descendantPid, 0)).toThrow();
    expect(groupIsAlive(hostPid)).toBe(false);
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);

  it('escalates a hanging host and descendant to SIGKILL', async () => {
    const { descendantPid, hostPid, signals, closeReadline } = await runHostFixture('hang');

    expect(deliveredSignals(signals)[0]).toBe('SIGTERM');
    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(() => process.kill(descendantPid, 0)).toThrow();
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);

  it('reaps survivors when the host exits during the grace period', async () => {
    const { descendantPid, hostPid, signals, closeReadline } = await runHostFixture('delayed-exit');

    expect(deliveredSignals(signals)).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -hostPid)).toBe(true);
    expect(() => process.kill(descendantPid, 0)).toThrow();
    expect(closeReadline).toHaveBeenCalledTimes(1);
  }, 15000);
});
