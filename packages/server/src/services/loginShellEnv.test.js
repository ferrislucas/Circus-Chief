import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRobustEnv } from './nodeSpawnHelper.js';

// Finding #5 (test hermeticity): wrap child_process.spawnSync in a recording
// spy that delegates to the real implementation, so the hermeticity test can
// prove the login-shell probe never spawns in the vitest environment.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});
import {
  parseEnvZero,
  parseEnvLines,
  probeLoginShellEnv,
  probeLoginShellEnvAsync,
  refreshLoginShellEnvAsync,
  mergeShellEnv,
  getLoginShellEnv,
  resetLoginShellEnvCache,
  LOGIN_SHELL_TIMEOUT_MS,
  LOGIN_SHELL_ASYNC_TIMEOUT_MS,
  isSshAgentSocketAlive,
  isSshAgentSocketAliveAsync,
  filterDeadSshSocketAsync,
  clearSshLivenessCache,
  staleSshSocketMessage,
} from './loginShellEnv.js';
import {
  checkParitySignals,
  buildParityCredentialError,
  redactEnvForDiagnostics,
  redactSecretsFromText,
} from './parityDiagnostics.js';
import { buildMuseHostEnv } from '../agents/adapters/museHostEnv.js';

function nulEntries(obj) {
  return Buffer.from(`${Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\0')}\0`);
}

function okSpawn(stdout) {
  return { status: 0, stdout, stderr: Buffer.alloc(0), error: undefined };
}

function busySleep(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) { /* spin: simulate a hanging dump */ }
}

describe('loginShellEnv', () => {
  afterEach(() => {
    resetLoginShellEnvCache();
    clearSshLivenessCache();
    vi.restoreAllMocks();
  });

  // Finding #5: the vitest environment disables the login-shell probe
  // (hermeticity). These probe/cache machinery tests exercise the probe
  // itself with injected spawnSync/execFile doubles, so they re-enable it
  // for their own scope only — no real shell is ever spawned.
  async function withProbeEnabled(run) {
    const previous = process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
    resetLoginShellEnvCache();
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL;
      else process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL = previous;
      resetLoginShellEnvCache();
    }
  }

  describe('parseEnvZero', () => {
    it('parses NUL-delimited KEY=VALUE output', () => {
      const parsed = parseEnvZero(nulEntries({ PATH: '/a:/b', SSH_AUTH_SOCK: '/tmp/sock', EMPTY: '' }));
      expect(parsed).toMatchObject({ PATH: '/a:/b', SSH_AUTH_SOCK: '/tmp/sock', EMPTY: '' });
    });

    it('keeps values containing = and skips entries without =', () => {
      const parsed = parseEnvZero(Buffer.from('A=b=c\0NOEQUALS\0D=e\0'));
      expect(parsed).toEqual({ A: 'b=c', D: 'e' });
    });

    it('tolerates trailing NULs and empty input', () => {
      expect(parseEnvZero(Buffer.from('\0\0'))).toEqual({});
      expect(parseEnvZero(Buffer.alloc(0))).toEqual({});
    });
  });

  describe('parseEnvLines', () => {
    it('parses newline-delimited printenv fallback output', () => {
      const parsed = parseEnvLines('PATH=/a:/b\nSSH_AUTH_SOCK=/tmp/sock\nNOEQUALS\n');
      expect(parsed).toEqual({ PATH: '/a:/b', SSH_AUTH_SOCK: '/tmp/sock' });
    });
  });

  describe('probeLoginShellEnv', () => {
    it('returns ok with the parsed env from env -0', () => {
      const spawnSync = vi.fn(() => okSpawn(nulEntries({ PATH: '/shell/bin', SSH_AUTH_SOCK: '/tmp/s' })));
      const result = probeLoginShellEnv({ shell: '/bin/zsh' }, { spawnSync });
      expect(result.ok).toBe(true);
      expect(result.env.PATH).toBe('/shell/bin');
      expect(result.env.SSH_AUTH_SOCK).toBe('/tmp/s');
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(spawnSync.mock.calls[0][0]).toBe('/bin/zsh');
      expect(spawnSync.mock.calls[0][1]).toContain('-lic');
    });

    it('falls back to plain printenv when env -0 yields nothing usable', () => {
      const spawnSync = vi.fn()
        .mockReturnValueOnce({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: undefined })
        .mockReturnValueOnce(okSpawn(Buffer.from('PATH=/fallback/bin\n')));
      const result = probeLoginShellEnv({ shell: '/bin/zsh' }, { spawnSync });
      expect(result.ok).toBe(true);
      expect(result.env.PATH).toBe('/fallback/bin');
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it('returns { ok: false } without throwing on timeout', () => {
      const timeoutErr = new Error('spawnSync timed out');
      timeoutErr.code = 'ETIMEDOUT';
      const spawnSync = vi.fn(() => ({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: timeoutErr }));
      const result = probeLoginShellEnv({ shell: '/bin/zsh', timeoutMs: 50 }, { spawnSync });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/timed out|timeout/i);
    });

    it('returns { ok: false } for a bad shell without throwing', () => {
      const spawnSync = vi.fn(() => { throw new Error('spawn /bin/nope ENOENT'); });
      const result = probeLoginShellEnv({ shell: '/bin/nope' }, { spawnSync });
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    });

    it('returns { ok: false } on nonzero exit without throwing', () => {
      const spawnSync = vi.fn(() => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('boom'), error: undefined }));
      const result = probeLoginShellEnv({ shell: '/bin/false' }, { spawnSync });
      expect(result.ok).toBe(false);
    });

    it('declines on win32 instead of probing', () => {
      const spawnSync = vi.fn(() => okSpawn(nulEntries({ PATH: '/x' })));
      const result = probeLoginShellEnv({ shell: '/bin/zsh' }, { spawnSync, platform: 'win32' });
      expect(result.ok).toBe(false);
      expect(spawnSync).not.toHaveBeenCalled();
    });
  });

  describe('shared probe budget (finding #7)', () => {
    it('gives the printenv retry only the remaining budget, not a fresh one', () => {
      const budgets = [];
      const spawnSync = vi.fn((_shell, _args, options) => {
        budgets.push(options.timeout);
        busySleep(options.timeout); // both dumps hang for their whole budget
        return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      });
      const startedAt = Date.now();
      const result = probeLoginShellEnv({ shell: '/bin/zsh', timeoutMs: 300 }, { spawnSync });
      const elapsed = Date.now() - startedAt;

      expect(result.ok).toBe(false);
      expect(budgets).toHaveLength(2);
      expect(budgets[0]).toBe(300);
      // The retry is bounded by what is left of the ONE overall budget —
      // never a fresh full budget (FRD R-2: probe cost stays ≤2s).
      expect(budgets[1]).toBeLessThan(300);
      expect(elapsed).toBeLessThan(560);
    });

    it('keeps the default overall budget within the 2s FRD bound', () => {
      expect(LOGIN_SHELL_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    });
  });

  describe('probeLoginShellEnvAsync (finding #6)', () => {
    it('uses a tighter per-dump budget than the sync probe', () => {
      expect(LOGIN_SHELL_ASYNC_TIMEOUT_MS).toBeLessThan(LOGIN_SHELL_TIMEOUT_MS);
    });

    it('returns ok with the parsed env from env -0 via execFile', async () => {
      const execFile = vi.fn(async () => ({ stdout: 'PATH=/shell/bin\0SSH_AUTH_SOCK=/tmp/s\0' }));
      const result = await probeLoginShellEnvAsync({ shell: '/bin/zsh' }, { execFile });
      expect(result.ok).toBe(true);
      expect(result.env.PATH).toBe('/shell/bin');
      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile.mock.calls[0][0]).toBe('/bin/zsh');
      expect(execFile.mock.calls[0][1]).toContain('-lic');
    });

    it('falls back to plain printenv when env -0 yields nothing usable', async () => {
      const execFile = vi.fn()
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: 'PATH=/fallback/bin\n' });
      const result = await probeLoginShellEnvAsync({ shell: '/bin/zsh' }, { execFile });
      expect(result.ok).toBe(true);
      expect(result.env.PATH).toBe('/fallback/bin');
      expect(execFile).toHaveBeenCalledTimes(2);
    });

    it('returns { ok: false } without throwing on timeout', async () => {
      const timeoutErr = new Error('Command timed out');
      timeoutErr.killed = true;
      const execFile = vi.fn(async () => { throw timeoutErr; });
      const result = await probeLoginShellEnvAsync({ shell: '/bin/zsh', timeoutMs: 50 }, { execFile });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/timed out|timeout/i);
    });

    it('declines on win32 instead of probing', async () => {
      const execFile = vi.fn(async () => ({ stdout: 'PATH=/x\0' }));
      const result = await probeLoginShellEnvAsync({ shell: '/bin/zsh' }, { execFile, platform: 'win32' });
      expect(result.ok).toBe(false);
      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('refreshLoginShellEnvAsync (finding #6)', () => {
    it('repopulates the process-lifetime cache without blocking spawns', async () => {
      await withProbeEnabled(async () => {
        const execFile = vi.fn(async () => ({ stdout: 'PATH=/fresh/bin\0' }));
        await refreshLoginShellEnvAsync({}, { execFile });
        // The sync reader now serves the refreshed value with no new spawn.
        const spawnSync = vi.fn(() => { throw new Error('must not probe'); });
        const cached = getLoginShellEnv({}, { spawnSync });
        expect(cached.ok).toBe(true);
        expect(cached.env.PATH).toBe('/fresh/bin');
      });
    });
  });

  describe('getLoginShellEnv cache', () => {
    it('probes once per process lifetime (single-flight cache)', async () => {
      await withProbeEnabled(async () => {
        const spawnSync = vi.fn(() => okSpawn(nulEntries({ PATH: '/cached' })));
        const first = getLoginShellEnv({}, { spawnSync });
        const second = getLoginShellEnv({}, { spawnSync });
        expect(first).toBe(second);
        expect(spawnSync).toHaveBeenCalledTimes(1);
      });
    });

    it('caches failures too (no repeated slow probes)', async () => {
      await withProbeEnabled(async () => {
        const spawnSync = vi.fn(() => { throw new Error('nope'); });
        getLoginShellEnv({}, { spawnSync });
        getLoginShellEnv({}, { spawnSync });
        expect(spawnSync).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('mergeShellEnv', () => {
    it('keeps parity keys from the shell while dropping PWD/_/SHLVL', () => {
      const merged = mergeShellEnv({
        shellEnv: {
          PATH: '/shell/bin', SSH_AUTH_SOCK: '/tmp/s', GH_TOKEN: 'TEST_SENTINEL_GH',
          GIT_AUTHOR_NAME: 'Shell User', GPG_TTY: '/dev/ttys0',
          PWD: '/shell/dir', _: '/bin/env', SHLVL: '2',
        },
        baseEnv: {},
      });
      expect(merged.PATH).toContain('/shell/bin');
      expect(merged.SSH_AUTH_SOCK).toBe('/tmp/s');
      expect(merged.GH_TOKEN).toBe('TEST_SENTINEL_GH');
      expect(merged.GIT_AUTHOR_NAME).toBe('Shell User');
      expect(merged.PWD).toBeUndefined();
      expect(merged._).toBeUndefined();
      expect(merged.SHLVL).toBeUndefined();
    });

    it('never overwrites explicit baseEnv values and preserves their PATH order', () => {
      const merged = mergeShellEnv({
        shellEnv: { PATH: '/shell/bin:/shared', GH_TOKEN: 'TEST_SENTINEL_SHELL', HOME: '/shell/home' },
        baseEnv: { PATH: '/explicit/bin:/shared', GH_TOKEN: 'TEST_SENTINEL_EXPLICIT', HOME: '/explicit/home' },
      });
      expect(merged.GH_TOKEN).toBe('TEST_SENTINEL_EXPLICIT');
      expect(merged.HOME).toBe('/explicit/home');
      const parts = merged.PATH.split(':');
      expect(parts.indexOf('/explicit/bin')).toBeLessThan(parts.indexOf('/shell/bin'));
      expect(parts.filter((p) => p === '/shared')).toHaveLength(1);
    });

    it('is idempotent: re-merging never duplicates PATH entries', () => {
      const once = mergeShellEnv({ shellEnv: { PATH: '/a:/b' }, baseEnv: { PATH: '/c' } });
      const twice = mergeShellEnv({ shellEnv: { PATH: '/a:/b' }, baseEnv: { PATH: once.PATH } });
      expect(twice.PATH).toBe(once.PATH);
    });

    it('default timeout budget is bounded', () => {
      expect(LOGIN_SHELL_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    });

    // Finding #11 (FR-3/FR-10): an explicit empty string is a *set* value —
    // the user cleared it on purpose — so the login-shell baseline must not
    // refill it. PATH stays special: an empty PATH is still filled.
    it('keeps an explicit empty string for non-PATH keys (explicit clear wins, finding #11)', () => {
      const merged = mergeShellEnv({
        shellEnv: { GH_TOKEN: 'x', EDITOR: 'vim', HOME: '/shell/home' },
        baseEnv: { GH_TOKEN: '', EDITOR: '' },
      });
      expect(merged.GH_TOKEN).toBe('');
      expect(merged.EDITOR).toBe('');
      expect(merged.HOME).toBe('/shell/home'); // unset → still filled
    });

    it('still fills an empty PATH from the shell (PATH stays special, finding #11)', () => {
      const merged = mergeShellEnv({
        shellEnv: { PATH: '/shell/bin' },
        baseEnv: { PATH: '' },
      });
      expect(merged.PATH).toBe('/shell/bin');
    });
  });

  describe('SSH agent socket liveness (FR-5)', () => {
    it('detects a dead socket path as not alive', () => {
      const probe = isSshAgentSocketAlive('/nonexistent-dir-xyz/agent.sock');
      expect(probe.alive).toBe(false);
      expect(probe.reason).toBeTruthy();
    });

    it('detects a regular file as not-a-socket (real fs)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ssh-file-'));
      try {
        const filePath = join(dir, 'not-a-socket');
        writeFileSync(filePath, 'x');
        const probe = isSshAgentSocketAlive(filePath);
        expect(probe.alive).toBe(false);
        expect(probe.reason).toMatch(/not a socket/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects a live socket via stat (stubbed; socket bind is sandbox-restricted)', () => {
      const probe = isSshAgentSocketAlive('/tmp/agent.sock', {
        statSync: () => ({ isSocket: () => true }),
      });
      expect(probe.alive).toBe(true);
    });

    it('excludes a stale SSH_AUTH_SOCK instead of passing it through silently', () => {
      const env = buildMuseHostEnv(
        { SSH_AUTH_SOCK: '/nonexistent-dir-xyz/agent.sock' },
        { PATH: '/usr/bin:/bin' },
        { shellEnv: {} },
      );
      expect(env.SSH_AUTH_SOCK).toBeUndefined();
    });

    it('keeps a live SSH_AUTH_SOCK', () => {
      const env = buildMuseHostEnv(
        { SSH_AUTH_SOCK: '/tmp/agent.sock' },
        { PATH: '/usr/bin:/bin' },
        { shellEnv: {}, isSshAgentAlive: () => ({ alive: true }) },
      );
      expect(env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock');
    });
  });

  describe('credential parity signals (FR-6, FR-7)', () => {
    it('reports gh-auth ok from a stubbed HOME hosts.yml plus GH_TOKEN', () => {
      const dir = mkdtempSync(join(tmpdir(), 'gh-home-'));
      try {
        mkdirSync(join(dir, '.config', 'gh'), { recursive: true });
        writeFileSync(join(dir, '.config', 'gh', 'hosts.yml'), 'github.com:\n  user: tester\n');
        const signals = checkParitySignals(
          { HOME: dir, GH_TOKEN: 'TEST_SENTINEL_GH', PATH: '/usr/bin:/bin' },
          { skipBinaries: true },
        );
        const gh = signals.find((s) => s.signal === 'gh-auth');
        expect(gh.ok).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reports git-identity ok from GIT_AUTHOR env fixtures', () => {
      const signals = checkParitySignals(
        {
          HOME: tmpdir(), PATH: '/usr/bin:/bin',
          GIT_AUTHOR_NAME: 'Shell User', GIT_AUTHOR_EMAIL: 'shell@example.com',
        },
        { skipBinaries: true },
      );
      const git = signals.find((s) => s.signal === 'git-identity');
      expect(git.ok).toBe(true);
    });

    it('ignores comment lines when reading git identity', () => {
      const dir = mkdtempSync(join(tmpdir(), 'git-home-'));
      try {
        writeFileSync(join(dir, '.gitconfig'), '[user]\n# name = Comment Only\n; email = comment@example.com\n');
        const signals = checkParitySignals({ HOME: dir, PATH: '/usr/bin:/bin' }, { skipBinaries: true });
        expect(signals.find((s) => s.signal === 'git-identity').ok).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('follows include.path when reading git identity', () => {
      const dir = mkdtempSync(join(tmpdir(), 'git-home-'));
      try {
        writeFileSync(join(dir, '.gitconfig'), '[user]\n[include]\npath = ~/identity.inc\n');
        writeFileSync(join(dir, 'identity.inc'), '[user]\nname = Included User\nemail = included@example.com\n');
        const signals = checkParitySignals({ HOME: dir, PATH: '/usr/bin:/bin' }, { skipBinaries: true });
        expect(signals.find((s) => s.signal === 'git-identity').ok).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('redaction (FR-11)', () => {
    it('reports only SET/UNSET plus origin labels, never secret values', () => {
      const summary = redactEnvForDiagnostics(
        { GH_TOKEN: 'TEST_SENTINEL_GH_X1', GITHUB_TOKEN: '', HOME: '/home/u', SSH_AUTH_SOCK: undefined },
        { shellEnv: { GH_TOKEN: 'TEST_SENTINEL_GH_X1' } },
      );
      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain('TEST_SENTINEL_GH_X1');
      expect(summary.GH_TOKEN.state).toBe('SET');
      expect(summary.GH_TOKEN.origin).toBe('login-shell');
      expect(summary.GITHUB_TOKEN.state).toBe('UNSET');
      expect(summary.HOME.state).toBe('SET');
    });

    it('scrubs secret values from free text while leaving other values alone', () => {
      const out = redactSecretsFromText(
        'token=TEST_SENTINEL_TOK_Z9 path=/home/u/bin user=bob',
        { GH_TOKEN: 'TEST_SENTINEL_TOK_Z9', HOME: '/home/u/bin' },
      );
      expect(out).not.toContain('TEST_SENTINEL_TOK_Z9');
      expect(out).toContain('[REDACTED]');
      expect(out).toContain('/home/u/bin');
    });
  });

  describe('actionable credential errors (FR-8)', () => {
    it('names the missing piece plus remediation and leaks no secret value', () => {
      const err = buildParityCredentialError('ssh-agent', { detail: 'TEST_SENTINEL_SECRET_XYZ' });
      expect(err.message).toMatch(/SSH_AUTH_SOCK/);
      expect(err.message).toMatch(/ssh-add|ssh-agent/i);
      expect(err.message).not.toContain('TEST_SENTINEL_SECRET_XYZ');
      expect(err.code).toBeTruthy();
    });
  });

  describe('SSH agent socket connect-test (FR-5)', () => {
    it('reports a dead-but-present socket file as not alive', async () => {
      const { EventEmitter } = await import('events');
      const connect = () => {
        const socket = new EventEmitter();
        socket.destroy = () => {};
        queueMicrotask(() => socket.emit('error', Object.assign(new Error('connect ECONNREFUSED /tmp/stale-agent.sock'), { code: 'ECONNREFUSED' })));
        return socket;
      };
      const probe = await isSshAgentSocketAliveAsync('/tmp/stale-agent.sock', {
        statSync: () => ({ isSocket: () => true }),
        connect,
        timeoutMs: 50,
      });
      expect(probe.alive).toBe(false);
      expect(probe.reason).toMatch(/not accept|refused|reachable/i);
    });

    it('reports a listening socket as alive (real bind)', async () => {
      const { default: net } = await import('net');
      const dir = mkdtempSync(join(tmpdir(), 'ssh-live-'));
      const sockPath = join(dir, 'agent.sock');
      const server = net.createServer(() => {});
      await new Promise((resolve) => server.listen(sockPath, resolve));
      try {
        const probe = await isSshAgentSocketAliveAsync(sockPath, { timeoutMs: 500 });
        expect(probe).toMatchObject({ alive: true });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to stat when no connect implementation is available', async () => {
      const probe = await isSshAgentSocketAliveAsync('/tmp/agent.sock', {
        statSync: () => ({ isSocket: () => true }),
        connect: null,
      });
      expect(probe.alive).toBe(true);
    });
  });

  describe('async liveness cache (finding #8)', () => {
    const SOCK = '/tmp/test-agent.sock';

    it('probes once for consecutive calls with an unchanged socket', async () => {
      const probe = vi.fn(async () => ({ alive: true }));
      const env = { SSH_AUTH_SOCK: SOCK };
      const statSync = () => ({ mtimeMs: 111 });
      const first = await filterDeadSshSocketAsync(env, probe, { statSync });
      const second = await filterDeadSshSocketAsync(env, probe, { statSync });
      expect(probe).toHaveBeenCalledTimes(1);
      expect(first.env).toBe(env);
      expect(second.env).toBe(env);
      expect(second.droppedReason).toBeNull();
    });

    it('re-probes when the socket mtime changes (state change)', async () => {
      let mtimeMs = 111;
      const probe = vi.fn(async () => ({ alive: true }));
      const env = { SSH_AUTH_SOCK: SOCK };
      const statSync = () => ({ mtimeMs });
      await filterDeadSshSocketAsync(env, probe, { statSync });
      mtimeMs = 222;
      await filterDeadSshSocketAsync(env, probe, { statSync });
      expect(probe).toHaveBeenCalledTimes(2);
    });

    it('re-probes after the TTL expires', async () => {
      const probe = vi.fn(async () => ({ alive: true }));
      const env = { SSH_AUTH_SOCK: SOCK };
      const statSync = () => ({ mtimeMs: 111 });
      await filterDeadSshSocketAsync(env, probe, { statSync });
      await filterDeadSshSocketAsync(env, probe, { statSync, ttlMs: 0 });
      expect(probe).toHaveBeenCalledTimes(2);
    });

    it('caches dead results but still drops with the reason on repeat turns', async () => {
      const probe = vi.fn(async () => ({ alive: false, reason: 'socket dead' }));
      const env = { SSH_AUTH_SOCK: SOCK };
      const statSync = () => ({ mtimeMs: 111 });
      const first = await filterDeadSshSocketAsync(env, probe, { statSync });
      const second = await filterDeadSshSocketAsync(env, probe, { statSync });
      expect(probe).toHaveBeenCalledTimes(1);
      for (const result of [first, second]) {
        expect(result.env).not.toHaveProperty('SSH_AUTH_SOCK');
        expect(result.droppedReason).toBe('socket dead');
      }
    });

    it('passes through without probing when SSH_AUTH_SOCK is unset', async () => {
      const probe = vi.fn(async () => ({ alive: true }));
      const result = await filterDeadSshSocketAsync({ PATH: 'x' }, probe);
      expect(probe).not.toHaveBeenCalled();
      expect(result).toEqual({ env: { PATH: 'x' }, droppedReason: null });
    });
  });

  describe('staleSshSocketMessage (finding #13)', () => {
    it('says a session retry is insufficient and a server re-spawn is needed', () => {
      const message = staleSshSocketMessage('socket dead');
      expect(message).toContain('socket dead');
      expect(message).toMatch(/retrying the session is not enough/i);
      expect(message).toMatch(/relaunch the server/i);
    });
  });

  // Finding #5 (test hermeticity): unit tests must never spawn the user's
  // real login shell. The vitest environment runs with the probe disabled
  // (CIRCUS_CHIEF_NO_LOGIN_SHELL=1 set by the test setup, before any module
  // can probe), so env derivation tests exercise fixtures — never `$SHELL -lic`.
  describe('test hermeticity (finding #5)', () => {
    it('runs the vitest environment with the login-shell probe disabled', () => {
      expect(process.env.CIRCUS_CHIEF_NO_LOGIN_SHELL).toBe('1');
    });

    it('short-circuits the probe before any spawn attempt while disabled', () => {
      resetLoginShellEnvCache();
      try {
        const boobyTrapped = vi.fn(() => {
          throw new Error('real login shell spawned inside a unit test');
        });
        const result = getLoginShellEnv({}, { spawnSync: boobyTrapped });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/disabled via CIRCUS_CHIEF_NO_LOGIN_SHELL=1/);
        expect(boobyTrapped).not.toHaveBeenCalled();
      } finally {
        resetLoginShellEnvCache();
      }
    });

    it('records zero login-shell spawns during createRobustEnv(process.env) in the test env', async () => {
      const { spawnSync } = await import('child_process');
      const spawnSyncSpy = vi.mocked(spawnSync);
      resetLoginShellEnvCache();
      spawnSyncSpy.mockClear();
      try {
        const env = createRobustEnv(process.env);
        expect(env.PATH).toBeDefined();
        expect(spawnSyncSpy).not.toHaveBeenCalled();
      } finally {
        resetLoginShellEnvCache();
        spawnSyncSpy.mockClear();
      }
    });
  });
});
