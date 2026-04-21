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

    writeFileSync(
      helperScript,
      `#!/bin/bash\nprint_error() { echo "ERROR: $1" >&2; }\nprint_info() { echo "INFO: $1" >&2; }\n${parseFn}\n${verifyFn}\n`,
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
  const runVerify = (expectedDbPath, serverPort) =>
    new Promise((resolve) => {
      const child = spawn(
        'bash',
        ['-c', `source "${helperScript}" && DB_PATH="${expectedDbPath}" verify_server_isolation "${serverPort}"`],
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
});
