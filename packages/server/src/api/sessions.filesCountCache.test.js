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
import sessionsRouter, { invalidateFilesCountCache } from './sessions.js';
import * as gitService from '../services/gitService.js';

describe('Sessions API - Files Count Caching', () => {
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

    // Invalidate the cache for our session to ensure clean state between tests
    invalidateFilesCountCache(session.id);
  });

  describe('cache miss (first request)', () => {
    it('calls git service on first request and returns the result', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(5);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledTimes(1);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache hit (repeated request within TTL)', () => {
    it('returns cached result without calling git service again', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      // First request - populates cache
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledTimes(1);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(5);
      // Git service should NOT be called again
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledTimes(1);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);
    });

    it('returns same count from cache as from original request', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(42);

      const first = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      const second = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(first.body.count).toBe(second.body.count);
      expect(second.body.count).toBe(42);
    });
  });

  describe('cache expiry', () => {
    it('calls git service again after cache TTL expires', async () => {
      vi.useFakeTimers();

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      // First request - populates cache
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);

      // Advance time past the 60-second TTL
      vi.advanceTimersByTime(61_000);

      // Update the mock to return a different value
      gitService.getModifiedFilesCount.mockResolvedValue(10);

      // Third request - cache should be expired, git service called again
      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(10);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('invalidateFilesCountCache', () => {
    it('forces a fresh git call after invalidation', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      // First request - populates cache
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateFilesCountCache(session.id);

      gitService.getModifiedFilesCount.mockResolvedValue(8);

      // Next request should call git service again
      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(8);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(2);
    });

    it('does not affect cache for other sessions', async () => {
      const session2 = sessions.create(project.id, 'Test Session 2', 'Test prompt 2');

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(5);

      // Populate cache for both sessions
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      gitService.getModifiedFilesCount.mockResolvedValue(3);
      await request(app)
        .get(`/api/sessions/${session2.id}/files-count`)
        .expect(200);

      // Invalidate only session 1
      invalidateFilesCountCache(session.id);

      // Clear mocks to track new calls
      gitService.getOriginDefaultBranch.mockClear();
      gitService.getModifiedFilesCount.mockClear();
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(99);

      // Session 2 should still be cached (no git call)
      const res2 = await request(app)
        .get(`/api/sessions/${session2.id}/files-count`)
        .expect(200);
      expect(res2.body.count).toBe(3);
      expect(gitService.getModifiedFilesCount).not.toHaveBeenCalled();

      // Session 1 should re-fetch from git
      const res1 = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);
      expect(res1.body.count).toBe(99);
      expect(gitService.getModifiedFilesCount).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache does not cache errors', () => {
    it('does not cache failed requests', async () => {
      gitService.getOriginDefaultBranch.mockRejectedValue(new Error('Not a git repository'));

      // First request - fails
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(500);

      // Reset to succeed
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      gitService.getModifiedFilesCount.mockResolvedValue(7);

      // Second request - should call git service again (failure was not cached)
      const res = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      expect(res.body.count).toBe(7);
      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledTimes(2);
    });
  });

  describe('per-session cache isolation', () => {
    it('caches different counts for different sessions', async () => {
      const session2 = sessions.create(project.id, 'Session 2', 'prompt');

      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');

      // First session gets count 5
      gitService.getModifiedFilesCount.mockResolvedValue(5);
      await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);

      // Second session gets count 10
      gitService.getModifiedFilesCount.mockResolvedValue(10);
      await request(app)
        .get(`/api/sessions/${session2.id}/files-count`)
        .expect(200);

      // Clear mocks
      gitService.getOriginDefaultBranch.mockClear();
      gitService.getModifiedFilesCount.mockClear();

      // Both should return their cached values without calling git
      const res1 = await request(app)
        .get(`/api/sessions/${session.id}/files-count`)
        .expect(200);
      const res2 = await request(app)
        .get(`/api/sessions/${session2.id}/files-count`)
        .expect(200);

      expect(res1.body.count).toBe(5);
      expect(res2.body.count).toBe(10);
      expect(gitService.getOriginDefaultBranch).not.toHaveBeenCalled();
      expect(gitService.getModifiedFilesCount).not.toHaveBeenCalled();
    });
  });
});
