import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

vi.mock('../services/gitService.js', () => ({
  getSessionGitStatus: vi.fn(),
}));

import sessionsRouter from './sessions.js';
import * as gitService from '../services/gitService.js';

describe('Sessions API - Git Status Endpoint', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test-repo');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  it('returns git status for the project working directory', async () => {
    gitService.getSessionGitStatus.mockResolvedValue({
      currentBranch: 'feature',
      upstreamBranch: 'origin/feature',
      hasUpstream: true,
      localChangeCount: 0,
      aheadCount: 0,
      behindCount: 0,
      syncStatus: 'clean',
      fetched: false,
    });

    const res = await request(app)
      .get(`/api/sessions/${session.id}/git-status`)
      .expect(200);

    expect(gitService.getSessionGitStatus).toHaveBeenCalledWith('/tmp/test-repo', { fetch: false });
    expect(res.body.workingDirectory).toBe('/tmp/test-repo');
    expect(res.body.syncStatus).toBe('clean');
  });

  it('passes fetch=true when requested', async () => {
    gitService.getSessionGitStatus.mockResolvedValue({ syncStatus: 'behind', fetched: true });

    await request(app)
      .get(`/api/sessions/${session.id}/git-status?fetch=true`)
      .expect(200);

    expect(gitService.getSessionGitStatus).toHaveBeenCalledWith('/tmp/test-repo', { fetch: true });
  });

  it('uses the session worktree when available', async () => {
    sessions.update(session.id, { gitWorktree: '/tmp/session-worktree' });
    gitService.getSessionGitStatus.mockResolvedValue({ syncStatus: 'clean', fetched: false });

    const res = await request(app)
      .get(`/api/sessions/${session.id}/git-status`)
      .expect(200);

    expect(gitService.getSessionGitStatus).toHaveBeenCalledWith('/tmp/session-worktree', { fetch: false });
    expect(res.body.workingDirectory).toBe('/tmp/session-worktree');
  });

  it('returns a controlled error when git status fails', async () => {
    gitService.getSessionGitStatus.mockRejectedValue(new Error('Not a git repository'));

    const res = await request(app)
      .get(`/api/sessions/${session.id}/git-status`)
      .expect(500);

    expect(res.body.error).toBe('Not a git repository');
  });
});
