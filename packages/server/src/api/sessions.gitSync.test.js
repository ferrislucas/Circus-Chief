import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn(),
  getSessionGitStatus: vi.fn(),
  pushSessionBranch: vi.fn(),
  pullSessionBranch: vi.fn(),
}));

import sessionsRouter from './sessions.js';
import * as gitService from '../services/gitService.js';

describe('Sessions API - Git synchronization', () => {
  let app;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
    const project = projects.create('Git sync project', '/tmp/git-sync-repo');
    session = sessions.create(project.id, 'Git sync session', 'Test prompt');
  });

  it('passes an explicitly confirmed dirty pull through to the Git service', async () => {
    gitService.pullSessionBranch.mockResolvedValue({
      operation: 'pull',
      branch: 'feature',
      upstream: 'origin/feature',
      summary: 'Pulled origin/feature.',
      gitStatus: { localChangeCount: 1, behindCount: 0 },
    });

    const response = await request(app)
      .post(`/api/sessions/${session.id}/git/pull`)
      .send({})
      .expect(200);

    expect(gitService.pullSessionBranch).toHaveBeenCalledWith('/tmp/git-sync-repo');
    expect(response.body).toMatchObject({ operation: 'pull', gitStatus: { localChangeCount: 1 } });
  });
});
