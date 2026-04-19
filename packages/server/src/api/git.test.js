import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';

// Mock gitService before importing the router
vi.mock('../services/gitService.js', () => ({
  detectWorktreePath: vi.fn(),
}));

import gitRouter from './git.js';
import * as gitService from '../services/gitService.js';

describe('Git API', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/git', gitRouter);
  });

  describe('GET /api/git/detect-worktree-path', () => {
    it('returns 400 when directory query param is missing', async () => {
      const { default: request } = await import('supertest');
      const res = await request(app).get('/api/git/detect-worktree-path');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('directory query parameter is required');
    });

    it('returns detected worktree path for a valid directory', async () => {
      gitService.detectWorktreePath.mockResolvedValue({
        worktreePath: '/some/repo/.worktrees',
        source: 'detected',
      });

      const { default: request } = await import('supertest');
      const res = await request(app).get('/api/git/detect-worktree-path?directory=/some/repo');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        worktreePath: '/some/repo/.worktrees',
        source: 'detected',
      });
      expect(gitService.detectWorktreePath).toHaveBeenCalledWith('/some/repo');
    });

    it('returns default worktree path when no external worktrees exist', async () => {
      gitService.detectWorktreePath.mockResolvedValue({
        worktreePath: '/some/repo/.worktrees',
        source: 'default',
      });

      const { default: request } = await import('supertest');
      const res = await request(app).get('/api/git/detect-worktree-path?directory=/some/repo');

      expect(res.status).toBe(200);
      expect(res.body.source).toBe('default');
    });

    it('returns 500 when gitService throws an error', async () => {
      gitService.detectWorktreePath.mockRejectedValue(new Error('Something went wrong'));

      const { default: request } = await import('supertest');
      const res = await request(app).get('/api/git/detect-worktree-path?directory=/some/repo');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Something went wrong');
    });
  });
});
