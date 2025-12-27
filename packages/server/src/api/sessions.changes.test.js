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
}));

// Mock diffService
vi.mock('../services/diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue({
    staged: 'mock staged diff',
    unstaged: 'mock unstaged diff',
    untracked: 'mock untracked diff',
  }),
}));

// Import after mocks
import sessionsRouter from './sessions.js';
import { getChanges } from '../services/diffService.js';

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

    it('ignores branch comparison query parameters (backwards compatibility)', async () => {
      getChanges.mockResolvedValue({
        staged: 'local staged',
        unstaged: 'local unstaged',
        untracked: 'local untracked',
      });

      // Send request with old branch comparison parameters that should be ignored
      const res = await request(app)
        .get(`/api/sessions/${session.id}/changes`)
        .query({ compareMode: 'branch', branch: 'origin/main' });

      // Should still work and return local changes only
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        staged: 'local staged',
        unstaged: 'local unstaged',
        untracked: 'local untracked',
      });

      // Verify getChanges was called with directory, not branch parameters
      expect(getChanges).toHaveBeenCalledWith('/tmp/test');
    });

    it('never attempts branch comparison even with old API format', async () => {
      getChanges.mockResolvedValue({
        staged: 'only local changes',
        unstaged: '',
        untracked: '',
      });

      // Try to force branch comparison with multiple different query formats
      const res = await request(app)
        .get(`/api/sessions/${session.id}/changes`)
        .query({ compareMode: 'branch' })
        .query({ branch: 'origin/develop' });

      expect(res.status).toBe(200);

      // Verify that only getChanges was called (local changes)
      // and no branch comparison function would be called
      expect(getChanges).toHaveBeenCalledTimes(1);
      expect(getChanges).toHaveBeenCalledWith('/tmp/test');

      // The response should only contain local changes
      expect(res.body).toEqual({
        staged: 'only local changes',
        unstaged: '',
        untracked: '',
      });
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

  describe('Branch comparison removal', () => {
    it('endpoint should not support compareMode parameter', async () => {
      getChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      // Send request with branch comparison parameter
      const res = await request(app)
        .get(`/api/sessions/${session.id}/changes`)
        .query({ compareMode: 'branch' });

      // Should still succeed but ignore the parameter
      expect(res.status).toBe(200);

      // Verify only local changes were requested
      expect(getChanges).toHaveBeenCalledWith('/tmp/test');
    });

    it('should not attempt to fetch origin default branch', async () => {
      getChanges.mockResolvedValue({
        staged: 'local',
        unstaged: 'local',
        untracked: 'local',
      });

      await request(app).get(`/api/sessions/${session.id}/changes`);

      // getChanges should be called exactly once (for local changes)
      // No function to get origin default branch should be called
      expect(getChanges).toHaveBeenCalledTimes(1);
    });
  });
});
