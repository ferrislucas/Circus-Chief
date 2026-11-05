import { describe, expect, it, vi } from 'vitest';
import { startWorkAfterEnvironment } from './startupWork.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { warmLoginShellEnv, resetLoginShellEnvCache } from './services/loginShellEnv.js';
import { createRobustEnv } from './services/nodeSpawnHelper.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe('startup work readiness', () => {
  it('starts workers and listening with the snapshot after a spawn failure', async () => {
    const previous = process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    resetLoginShellEnvCache();
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      child.on('error', () => {}); // Contain the error when testing the unfixed implementation.
      queueMicrotask(() => child.emit('error', new Error('spawn EMFILE')));
      return child;
    });
    const environments = [];
    const worker = vi.fn(() => environments.push(createRobustEnv({ PATH: '/explicit', GH_TOKEN: 'explicit-token' })));
    const listen = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await startWorkAfterEnvironment({ warm: warmLoginShellEnv, isShuttingDown: () => false, startLaneWorker: worker, startScheduler: worker, listen });
      expect(worker).toHaveBeenCalledTimes(2);
      expect(listen).toHaveBeenCalledOnce();
      for (const env of environments) {
        expect(env.PATH.split(':')).toContain('/explicit');
        expect(env.GH_TOKEN).toBe('explicit-token');
      }
    } finally {
      warn.mockRestore();
      vi.mocked(spawn).mockReset();
      resetLoginShellEnvCache();
      if (previous === undefined) delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
      else process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL = previous;
    }
  });
  it('delays both delivery workers and listening until warm-up finishes', async () => {
    let finish;
    const warm = () => new Promise((resolve) => { finish = resolve; });
    const startLaneWorker = vi.fn();
    const startScheduler = vi.fn();
    const listen = vi.fn();
    const pending = startWorkAfterEnvironment({ warm, isShuttingDown: () => false, startLaneWorker, startScheduler, listen });
    expect(startLaneWorker).not.toHaveBeenCalled();
    expect(startScheduler).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(startLaneWorker).toHaveBeenCalledOnce();
    expect(startScheduler).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledOnce();
  });

  it('delivers the warmed environment to both workers and preserves explicit values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'startup-env-'));
    const shell = join(dir, 'shell');
    const previous = process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    resetLoginShellEnvCache();
    writeFileSync(shell, `#!${process.execPath}\nsetTimeout(() => process.stdout.write('PATH=/shell-only\\0SSH_AUTH_SOCK=/shell-sock\\0GH_TOKEN=shell-token\\0'), 300);\n`, { mode: 0o755 });
    const environments = [];
    const deliver = () => environments.push(createRobustEnv({ PATH: '/explicit', GH_TOKEN: 'explicit-token' }));
    try {
      const pending = startWorkAfterEnvironment({ warm: () => warmLoginShellEnv({ shell }), isShuttingDown: () => false, startLaneWorker: deliver, startScheduler: deliver, listen: () => {} });
      expect(environments).toHaveLength(0);
      await pending;
      expect(environments).toHaveLength(2);
      for (const env of environments) {
        expect(env.PATH.split(':')).toContain('/shell-only');
        expect(env.SSH_AUTH_SOCK).toBe('/shell-sock');
        expect(env.GH_TOKEN).toBe('explicit-token');
      }
    } finally {
      resetLoginShellEnvCache();
      if (previous === undefined) delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
      else process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not start workers or listen after shutdown during warm-up', async () => {
    let finish;
    let shuttingDown = false;
    const worker = vi.fn();
    const pending = startWorkAfterEnvironment({ warm: () => new Promise((resolve) => { finish = resolve; }), isShuttingDown: () => shuttingDown, startLaneWorker: worker, startScheduler: worker, listen: worker });
    shuttingDown = true;
    finish();
    await pending;
    expect(worker).not.toHaveBeenCalled();
  });
});
