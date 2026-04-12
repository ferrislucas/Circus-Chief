import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

// Mock gitService
vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn(),
  getModifiedFilesCount: vi.fn(),
}));

// Import after mocking
import sessionsRouter from './sessions.js';
import * as gitService from '../services/gitService.js';

describe('Sessions API - Files Count Endpoint', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test-repo');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  describe('GET /api/sessions/:id/files-count', () => {
    it('returns file count for session without worktree', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(5);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledWith(project.workingDirectory);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledWith(
        project.workingDirectory,
        'origin/main'
      );
    });

    it('uses gitWorktree when available', async () => {
      const worktreePath = '/tmp/worktree-123';
      sessions.update(session.id, { gitWorktree: worktreePath });

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(3);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(3);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledWith(worktreePath);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledWith(
        worktreePath,
        'origin/main'
      );
    });

    it('returns 0 when no files are modified', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(0);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(0);
    });

    it('handles origin/master as default branch', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/master');
      gitService.getModifiedFilesCount.mockResolvedValue(7);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(7);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledWith(
        project.workingDirectory,
        'origin/master'
      );
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .get('/api/sessions/non-existent-id/files-count')
        .expect(404);

      expect(res.body.error).toBe('Session not found');
      expect(gitService.getOriginDefaultBranch).not.toHaveBeenCalled();
      expect(gitService.getModifiedFilesCount).not.toHaveBeenCalled();
    });

    it('returns 500 with count 0 when getOriginDefaultBranch fails', async () => {
      gitService.getOriginDefaultBranch.mockRejectedValue(new Error('Not a git repository'));

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(500);

      expect(res.body.error).toBe('Not a git repository');
      expect(res.body.count).toBe(0);
      expect(gitService.getModifiedFilesCount).not.toHaveBeenCalled();
    });

    it('returns 500 with count 0 when getModifiedFilesCount fails', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockRejectedValue(new Error('Git command failed'));

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(500);

      expect(res.body.error).toBe('Git command failed');
      expect(res.body.count).toBe(0);
    });

    it('returns count 0 when git service returns null', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(null);
    });

    it('works for sessions with different git modes', async () => {
      // Create session with git worktree mode
      sessions.update(session.id, {
        gitMode: 'worktree',
        gitBranch: 'feature-branch',
        gitWorktree: '/tmp/worktree-feature'
      });

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(8);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(8);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledWith('/tmp/worktree-feature');
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledWith(
        '/tmp/worktree-feature',
        'origin/main'
      );
    });

    it('uses project workingDirectory when gitWorktree is null', async () => {
      sessions.update(session.id, { gitWorktree: null });

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(2);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledWith(project.workingDirectory);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledWith(
        project.workingDirectory,
        'origin/main'
      );
    });

    it('calls git service functions in correct order', async () => {
      const callOrder = [];

      gitService.getOriginDefaultBranch.mockImplementation(async () => {
        callOrder.push('getOriginDefaultBranch');
        return 'origin/main';
      });

      gitService.getModifiedFilesCount.mockImplementation(async () => {
        callOrder.push('getModifiedFilesCount');
        return 5;
      });

      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(callOrder).toEqual(['getOriginDefaultBranch', 'getModifiedFilesCount']);
    });
  });
});
