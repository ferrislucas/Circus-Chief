import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  generateSummary: vi.fn().mockResolvedValue('mock summary'),
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  onSessionActivity: vi.fn(),
}));

// Mock diffService
vi.mock('../services/diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue({
    staged: 'mock staged diff',
    unstaged: 'mock unstaged diff',
    untracked: 'mock untracked diff',
  }),
  getChangesBranch: vi.fn().mockResolvedValue({
    staged: 'mock branch staged diff',
    unstaged: 'mock branch unstaged diff',
    untracked: 'mock branch untracked diff',
  }),
}));

// Mock gitService
vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn().mockResolvedValue('origin/main'),
}));

// Import after mocks
import sessionsRouter from './sessions.js';
import { getChanges, getChangesBranch } from '../services/diffService.js';
import { getOriginDefaultBranch } from '../services/gitService.js';

describe('Sessions API - Changes Endpoint', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test project and session
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt');
  });

  describe('GET /api/sessions/:id/changes', () => {
    it('returns local changes for session', async () => {
      getChanges.mockResolvedValue({
        staged: 'file changes staged',
        unstaged: 'file changes unstaged',
        untracked: 'new files',
      });

      const res = await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        staged: 'file changes staged',
        unstaged: 'file changes unstaged',
        untracked: 'new files',
      });
    });

    it('uses project working directory by default', async () => {
      getChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(getChanges).toHaveBeenCalledWith('/tmp/test');
    });

    it('prefers session gitWorktree over project working directory', async () => {
      sessions.update(session.id, { gitWorktree: '/custom/worktree' });

      getChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(getChanges).toHaveBeenCalledWith('/custom/worktree');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent/changes');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('returns error when git operation fails', async () => {
      getChanges.mockRejectedValue(new Error('Git command failed'));

      const res = await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Git command failed');
    });

    it('handles empty changes', async () => {
      getChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const res = await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        staged: '',
        unstaged: '',
        untracked: '',
      });
    });

    it('supports branch comparison query parameters', async () => {
      getChangesBranch.mockResolvedValue({
        staged: 'branch staged',
        unstaged: 'branch unstaged',
        untracked: 'branch untracked',
      });

      // Send request with branch comparison parameters
      const res = await request(app)
        .get(`/api/sessions/${session.id}/changes`)
        .query({ compareMode: 'branch', branch: 'origin/main' });

      // Should return branch comparison changes
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        staged: 'branch staged',
        unstaged: 'branch unstaged',
        untracked: 'branch untracked',
      });

      // Verify getChangesBranch was called with directory and branch
      expect(getChangesBranch).toHaveBeenCalledWith('/tmp/test', 'origin/main');
    });

    it('includes all three change types in response', async () => {
      getChanges.mockResolvedValue({
        staged: 'staged content',
        unstaged: 'unstaged content',
        untracked: 'untracked content',
      });

      const res = await request(app).get(`/api/sessions/${session.id}/changes`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('staged');
      expect(res.body).toHaveProperty('unstaged');
      expect(res.body).toHaveProperty('untracked');
    });
  });

  describe('Branch comparison support', () => {
    it('falls back to local changes when compareMode=branch without branch parameter', async () => {
      getChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      // Send request with branch comparison mode but no branch specified
      const res = await request(app)
        .get(`/api/sessions/${session.id}/changes`)
        .query({ compareMode: 'branch' });

      // Should succeed and use local changes as fallback
      expect(res.status).toBe(200);

      // Verify only local changes were requested (no branch parameter)
      expect(getChanges).toHaveBeenCalledWith('/tmp/test');
    });

    it('provides default-branch endpoint to fetch the repository default branch', async () => {
      getOriginDefaultBranch.mockResolvedValue('origin/main');

      const res = await request(app).get(`/api/sessions/${session.id}/default-branch`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ branch: 'origin/main' });
      expect(getOriginDefaultBranch).toHaveBeenCalledWith('/tmp/test');
    });
  });
});
