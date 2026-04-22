import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PW_SH = resolve(HERE, '..', '..', '..', 'scripts', 'pw.sh');

/**
 * Integration test for pw.sh's server-reuse sanity check.
 *
 * The reuse path in detect_or_start_server calls parse_server_info_field to
 * compare the server's dbPath and schedulerRunning against what pw.sh
 * expects. A worktree server started manually (without VCR_MODE) would
 * have the wrong DB and a running scheduler; the reuse path must refuse
 * such a server.
 *
 * We don't spin up a real Circus Chief server for this — that would be
 * slow and flaky. Instead we stand up a trivial mock /api/server-info
 * responder and call pw.sh's helper functions from a hermetic shell
 * wrapper (no other pw.sh top-level logic runs).
 */
describe('pw.sh server-reuse verification', () => {
  let server;
  let port;
  let infoPayload;
  let tmpDir;
  let helperScript;

  beforeAll(() => {
    // Extract just the helper functions from pw.sh so sourcing them doesn't
    // run the whole script.
    const pwshSrc = readFileSync(PW_SH, 'utf-8');
    const extract = (name) => {
      const startRe = new RegExp(`^${name}\\(\\) \\{$`, 'm');
      const startMatch = pwshSrc.match(startRe);
      if (!startMatch) throw new Error(`Could not find ${name} in pw.sh`);
      const fromStart = pwshSrc.slice(startMatch.index);
      const endMatch = fromStart.match(/^\}$/m);
      if (!endMatch) throw new Error(`Could not find end of ${name}`);
      return fromStart.slice(0, endMatch.index + 1);
    };

    tmpDir = mkdtempSync(join(tmpdir(), 'cc-pwsh-reuse-'));
    helperScript = join(tmpDir, 'helpers.sh');
    const parseFn = extract('parse_server_info_field');
    const verifyFn = extract('verify_server_isolation');
    const setupFn = extract('setup_isolated_test_db');

    writeFileSync(
      helperScript,
      `#!/bin/bash\nprint_error() { echo "ERROR: $1" >&2; }\nprint_info() { echo "INFO: $1" >&2; }\nprint_warning() { echo "WARN: $1" >&2; }\n${parseFn}\n${verifyFn}\n${setupFn}\n`,
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/server-info') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(infoPayload));
      } else if (req.url === '/api/projects') {
        res.setHeader('content-type', 'application/json');
        res.end('[]');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  afterEach(() => {
    return new Promise((r) => server.close(r));
  });

  // Use async spawn (not spawnSync) because spawnSync blocks the event loop,
  // which would prevent the in-process mock HTTP server from responding to
  // the curl call inside verify_server_isolation, causing a deadlock.
  //
  // Options:
  //   usePackageServer: sets USE_PACKAGE_SERVER=true to exercise the
  //                     package-server branch (which only verifies the
  //                     server's dbPath isn't the home DB).
  //   home:             override HOME so the "is home DB" check is
  //                     deterministic across developer/CI machines.
  const runVerify = (expectedDbPath, serverPort, opts = {}) =>
    new Promise((resolve) => {
      const usePkg = opts.usePackageServer ? 'true' : 'false';
      const home = opts.home ?? '/home/testuser';
      const child = spawn(
        'bash',
        [
          '-c',
          `source "${helperScript}" && HOME="${home}" USE_PACKAGE_SERVER="${usePkg}" DB_PATH="${expectedDbPath}" verify_server_isolation "${serverPort}"`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('exit', (status) => resolve({ status, stdout, stderr }));
    });

  it('accepts a server whose dbPath matches and scheduler is stopped', async () => {
    infoPayload = {
      cwd: '/whatever',
      dbPath: '/tmp/expected.db',
      vcrMode: 'replay',
      schedulerRunning: false,
    };
    const result = await runVerify('/tmp/expected.db', port);
    expect(result.status).toBe(0);
  });

  it('rejects a server with a mismatched dbPath (e.g. the home DB)', async () => {
    infoPayload = {
      cwd: '/whatever',
      dbPath: '/home/user/.circuschief/circuschief.db',
      vcrMode: null,
      schedulerRunning: false,
    };
    const result = await runVerify('/tmp/expected.db', port);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unexpected DB');
  });

  it('rejects a server whose scheduler is running even if dbPath matches', async () => {
    infoPayload = {
      cwd: '/whatever',
      dbPath: '/tmp/expected.db',
      vcrMode: null,
      schedulerRunning: true,
    };
    const result = await runVerify('/tmp/expected.db', port);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Scheduler');
  });

  describe('USE_PACKAGE_SERVER path', () => {
    // The package server picks its own DB path inside an INSTALL_DIR tempdir,
    // so we don't require an exact match — only that it isn't the user's
    // real home DB, and that the scheduler is disabled.
    it('accepts a server whose dbPath is a tempdir (not the home DB)', async () => {
      infoPayload = {
        cwd: '/whatever',
        dbPath: '/tmp/circuschief-package-test.abc/circuschief.db',
        vcrMode: 'replay',
        schedulerRunning: false,
      };
      // expectedDbPath is ignored on the package path; pass '' to prove it.
      const result = await runVerify('', port, {
        usePackageServer: true,
        home: '/home/testuser',
      });
      expect(result.status).toBe(0);
      // Expect the helper to have printed the DB_PATH it exported.
      expect(result.stderr).toContain('DB_PATH set to:');
      expect(result.stderr).toContain('/tmp/circuschief-package-test.abc/circuschief.db');
    });

    it('rejects a package server pointed at the home DB', async () => {
      infoPayload = {
        cwd: '/whatever',
        dbPath: '/home/testuser/.circuschief/circuschief.db',
        vcrMode: 'replay',
        schedulerRunning: false,
      };
      const result = await runVerify('', port, {
        usePackageServer: true,
        home: '/home/testuser',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('home DB');
    });

    it('rejects a package server that reports no dbPath', async () => {
      infoPayload = {
        cwd: '/whatever',
        dbPath: null,
        vcrMode: 'replay',
        schedulerRunning: false,
      };
      const result = await runVerify('', port, {
        usePackageServer: true,
        home: '/home/testuser',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('no dbPath');
    });

    it('rejects a package server whose scheduler is running', async () => {
      infoPayload = {
        cwd: '/whatever',
        dbPath: '/tmp/circuschief-package-test.abc/circuschief.db',
        vcrMode: 'replay',
        schedulerRunning: true,
      };
      const result = await runVerify('', port, {
        usePackageServer: true,
        home: '/home/testuser',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Scheduler');
    });
  });

  // setup_isolated_test_db has a small branch that was easy to get wrong:
  // when USE_PACKAGE_SERVER=true we MUST clear a stale caller-provided
  // DB_PATH, otherwise the dev-server isolation path would spuriously
  // win (and verify_server_isolation would then fail with a confusing
  // "unexpected DB" error after the package server reported its own path).
  describe('setup_isolated_test_db', () => {
    // Env vars must be set in the surrounding shell (not as a single-command
    // prefix) so DB_PATH survives into the subsequent echo — otherwise the
    // "preserves caller-provided DB_PATH" assertion can't be observed.
    // We use the 'UNSET' sentinel to distinguish unset from empty.
    const runSetup = (env) =>
      new Promise((resolve) => {
        const { DB_PATH: callerDb, ...rest } = env;
        const envAssignments = Object.entries(rest)
          .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
          .join('; ');
        const dbAssignment =
          callerDb === undefined || callerDb === 'UNSET'
            ? ''
            : `export DB_PATH=${JSON.stringify(callerDb)};`;
        const child = spawn(
          'bash',
          [
            '-c',
            `source "${helperScript}"; ${envAssignments}; ${dbAssignment} setup_isolated_test_db && echo "DB_PATH=\${DB_PATH-UNSET}"`,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('exit', (status) => resolve({ status, stdout, stderr }));
      });

    it('defaults DB_PATH to worktree .circuschief-test.db when unset', async () => {
      const fakeRoot = mkdtempSync(join(tmpdir(), 'cc-setup-test-'));
      try {
        const result = await runSetup({
          PROJECT_ROOT: fakeRoot,
          USE_PACKAGE_SERVER: 'false',
          DB_PATH: '',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`DB_PATH=${fakeRoot}/.circuschief-test.db`);
      } finally {
        rmSync(fakeRoot, { recursive: true, force: true });
      }
    });

    it('preserves a caller-provided DB_PATH on the dev-server path', async () => {
      const fakeRoot = mkdtempSync(join(tmpdir(), 'cc-setup-test-'));
      try {
        const result = await runSetup({
          PROJECT_ROOT: fakeRoot,
          USE_PACKAGE_SERVER: 'false',
          DB_PATH: '/some/caller/path.db',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('DB_PATH=/some/caller/path.db');
      } finally {
        rmSync(fakeRoot, { recursive: true, force: true });
      }
    });

    it('clears DB_PATH when USE_PACKAGE_SERVER=true', async () => {
      const fakeRoot = mkdtempSync(join(tmpdir(), 'cc-setup-test-'));
      try {
        const result = await runSetup({
          PROJECT_ROOT: fakeRoot,
          USE_PACKAGE_SERVER: 'true',
          DB_PATH: '/stale/value.db',
        });
        expect(result.status).toBe(0);
        // DB_PATH should be unset (our sentinel) — NOT the stale value,
        // and NOT the dev-server default either.
        expect(result.stdout).toContain('DB_PATH=UNSET');
        expect(result.stdout).not.toContain('/stale/value.db');
        expect(result.stdout).not.toContain('.circuschief-test.db');
      } finally {
        rmSync(fakeRoot, { recursive: true, force: true });
      }
    });
  });
});
