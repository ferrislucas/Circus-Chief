/**
 * Reproduction test: session creation against a hung git remote.
 *
 * A tiny TCP "blackhole" server accepts the connection and then stays silent.
 * git connects, sends its request, and blocks reading a reply that never comes.
 * Everything that can hang — the real git subprocess, real sockets, real
 * worktree creation, the real DB, the real POST /api/projects/:id/sessions
 * route — runs unmocked.
 *
 * Only two boundaries are mocked:
 *   - broadcastToProject  (no live WebSocket server in this test)
 *   - sessionManager.runSession  (we never want to spawn a real agent)
 *
 * The test keeps the fetch timeout short (via GIT_FETCH_TIMEOUT_MS) so it
 * completes in well under its own 15 s budget.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import net from 'net';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Keep the best-effort fetch timeout short so the test runs fast.
// The Step 2 implementation reads GIT_FETCH_TIMEOUT_MS at call time.
process.env.GIT_FETCH_TIMEOUT_MS = '1500';

// Also cap the overall startup timeout so the test doesn't wait 60 s if
// something else hangs.
process.env.SESSION_STARTUP_TIMEOUT_MS = '8000';

// Mock ONLY the two boundaries that are unrelated to the git-hang path.
vi.mock('../websocket.js', () => ({ broadcastToProject: vi.fn() }));
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

import projectsRouter from './projects.js';
import { projects, sessions } from '../database.js';

describe('Session startup against a hung git remote', () => {
  let app;
  let projectDir;
  let projectId;
  let blackhole;
  const openSockets = [];

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);

    // A real "blackhole" remote: accepts the TCP connection, then never replies.
    // git connects, sends its git:// request, and blocks reading — until the
    // fetch timeout kills the subprocess.
    blackhole = net.createServer((socket) => {
      openSockets.push(socket); // hold open; write nothing, never end
    });
    await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
    const port = blackhole.address().port;

    // A real local git repo whose origin points at the blackhole.
    projectDir = mkdtempSync(join(tmpdir(), 'git-hang-test-'));
    execSync('git init', { cwd: projectDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: projectDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projectDir, stdio: 'ignore' });
    execSync('git commit --allow-empty -m init', { cwd: projectDir, stdio: 'ignore' });
    // git:// protocol blocks purely on a TCP read — no TLS/auth handshake —
    // making the hang deterministic and fast to reproduce.
    execSync(`git remote add origin git://127.0.0.1:${port}/repo.git`, {
      cwd: projectDir,
      stdio: 'ignore',
    });

    projectId = projects.create('Hung Remote Project', projectDir).id;
  });

  afterEach(async () => {
    for (const socket of openSockets) socket.destroy();
    openSockets.length = 0;
    await new Promise((resolve) => blackhole.close(resolve));
    if (projectDir && existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('completes a bounded create-session request against an unresponsive origin', async () => {
    const started = Date.now();

    // worktree git mode triggers the real `git fetch origin`, which blocks on
    // the blackhole until the fetch timeout kills the subprocess.
    //
    // startImmediately:false keeps the assertion below meaningful: git setup
    // still runs (working-directory resolution always fetches in worktree mode),
    // but the agent launcher (mocked) is never invoked. The session settles into
    // `waiting` once setup completes — a deterministic non-`starting` end state.
    const res = await request(app)
      .post(`/api/projects/${projectId}/sessions`)
      .send({
        prompt: 'hello',
        gitMode: 'worktree',
        gitBranch: 'feat/hang-test',
        startImmediately: false,
      });

    const elapsed = Date.now() - started;

    // The core assertion: the request COMPLETES. On unfixed code it hangs
    // forever and this test fails by exceeding its own 15 s timeout.
    expect([201, 504]).toContain(res.status);

    // The fetch timed out (~1.5 s) and control was returned promptly.
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(12000);

    // The session must not be left stuck in 'starting'.
    const sessionId = res.body?.id ?? res.body?.session?.id
      ?? sessions.getByProjectId(projectId)[0]?.id;
    if (sessionId) {
      expect(sessions.getById(sessionId).status).not.toBe('starting');
    }
  }, 15000);
});
