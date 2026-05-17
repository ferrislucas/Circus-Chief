import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from './sessions.js';
import { projects, sessions, sessionSummaries } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service
vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  propagatePrUrlToParent: vi.fn(),
}));

// Mock prStatusService (needed because sessions-patch.js imports checkSessionCiStatusNow)
vi.mock('../services/prStatusService.js', () => ({
  checkSessionCiStatusNow: vi.fn().mockResolvedValue(false),
}));

// Mock summaryBroadcast (needed because sessions-patch.js imports broadcastSummaryUpdate)
vi.mock('../services/summaryBroadcast.js', () => ({
  broadcastSummaryUpdate: vi.fn(),
}));

describe('Sessions API - PR URL Endpoint', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('PATCH /sessions/:id - prUrl field', () => {
    it('sets prUrl with valid GitHub PR URL', async () => {
      const prUrl = 'https://github.com/owner/repo/pull/123';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl })
        .expect(200);

      expect(response.body.prUrl).toBe(prUrl);
      expect(response.body.prUrlAutoLinkDisabled).toBe(false);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBe(prUrl);
      expect(updated.prUrlAutoLinkDisabled).toBe(false);
    });

    it('updates prUrl with different valid PR URL', async () => {
      // First set a PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/1' })
        .expect(200);

      // Update to a new PR URL
      const newPrUrl = 'https://github.com/another-org/another-repo/pull/999';
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: newPrUrl })
        .expect(200);

      expect(response.body.prUrl).toBe(newPrUrl);
    });

    it('clears prUrl when set to null', { timeout: 10000 }, async () => {
      // First set a PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/123' })
        .expect(200);

      // Clear the PR URL with null
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: null })
        .expect(200);

      expect(response.body.prUrl).toBeNull();
      expect(response.body.prUrlAutoLinkDisabled).toBe(true);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBeNull();
      expect(updated.prUrlAutoLinkDisabled).toBe(true);
    });

    it('clears prUrl when set to empty string', async () => {
      // First set a PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/123' })
        .expect(200);

      // Clear the PR URL with empty string
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: '' })
        .expect(200);

      expect(response.body.prUrl).toBeNull();
      expect(response.body.prUrlAutoLinkDisabled).toBe(true);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBeNull();
      expect(updated.prUrlAutoLinkDisabled).toBe(true);
    });

    it('defaults prUrlAutoLinkDisabled to false for new sessions', () => {
      const created = sessions.getById(session.id);
      expect(created.prUrlAutoLinkDisabled).toBe(false);
    });

    it('re-enables auto linking when manually setting a valid PR URL after clearing', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: null })
        .expect(200);

      const prUrl = 'https://github.com/owner/repo/pull/456';
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl })
        .expect(200);

      expect(response.body.prUrl).toBe(prUrl);
      expect(response.body.prUrlAutoLinkDisabled).toBe(false);

      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBe(prUrl);
      expect(updated.prUrlAutoLinkDisabled).toBe(false);
    });

    it('does not modify prUrlAutoLinkDisabled when prUrl is not included in request', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: null })
        .expect(200);

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ thinkingEnabled: true })
        .expect(200);

      expect(response.body.prUrl).toBeNull();
      expect(response.body.prUrlAutoLinkDisabled).toBe(true);

      const updated = sessions.getById(session.id);
      expect(updated.prUrlAutoLinkDisabled).toBe(true);
    });

    it('rejects invalid PR URL format', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/issues/123' })
        .expect(400);

      expect(response.body.error).toContain('Invalid PR URL format');
    });

    it('rejects non-GitHub PR URLs', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://gitlab.com/owner/repo/pull/123' })
        .expect(400);

      expect(response.body.error).toContain('Invalid PR URL format');
    });

    it('rejects PR URLs with extra path segments', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/123/files' })
        .expect(400);

      expect(response.body.error).toContain('Invalid PR URL format');
    });

    it('rejects non-string prUrl values', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 123 })
        .expect(400);

      expect(response.body.error).toContain('prUrl must be a string or null');
    });

    it('accepts PR URL with complex owner/repo names', async () => {
      const prUrl = 'https://github.com/my-org-name/my-repo-123/pull/9999';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl })
        .expect(200);

      expect(response.body.prUrl).toBe(prUrl);
    });

    it('does not modify prUrl when not included in request', async () => {
      // First set a PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/123' })
        .expect(200);

      // Update something else (thinkingEnabled) without including prUrl
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ thinkingEnabled: true })
        .expect(200);

      // prUrl should still be set
      expect(response.body.prUrl).toBe('https://github.com/owner/repo/pull/123');
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .patch(`/api/sessions/${fakeId}`)
        .send({ prUrl: 'https://github.com/owner/repo/pull/123' })
        .expect(404);
    });

    it('can combine prUrl update with other fields', async () => {
      const prUrl = 'https://github.com/owner/repo/pull/123';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          prUrl,
          thinkingEnabled: true
        })
        .expect(200);

      expect(response.body.prUrl).toBe(prUrl);
      expect(response.body.thinkingEnabled).toBe(true);
    });
  });

  describe('PR state reset on reassociation', () => {
    const prUrlA = 'https://github.com/owner/repo/pull/1';
    const prUrlB = 'https://github.com/another-org/another-repo/pull/999';

    // Import mocks for assertion
    let broadcastSummaryUpdate;
    let checkSessionCiStatusNow;

    beforeEach(async () => {
      // Dynamic import to get the mocked functions
      const summaryBroadcast = await import('../services/summaryBroadcast.js');
      broadcastSummaryUpdate = summaryBroadcast.broadcastSummaryUpdate;
      const prStatusService = await import('../services/prStatusService.js');
      checkSessionCiStatusNow = prStatusService.checkSessionCiStatusNow;
    });

    it('resets PR state when prUrl changes to a different URL', async () => {
      // Set initial PR URL and create summary with merged state
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      sessionSummaries.upsert(session.id, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'merged',
        prMerged: true,
        ciStatus: 'success',
        ciFailures: ['test-1'],
        hasMergeConflicts: false,
      });

      // Change to a different PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlB })
        .expect(200);

      // Verify PR state was reset in the DB
      const summary = sessionSummaries.getBySessionId(session.id);
      expect(summary.prState).toBeNull();
      expect(summary.prMerged).toBe(false);
      expect(summary.ciStatus).toBeNull();
      expect(summary.ciFailures).toEqual([]);
      expect(summary.hasMergeConflicts).toBe(false);
    });

    it('does not reset PR state when prUrl is set for the first time', async () => {
      // Create summary with no PR fields
      sessionSummaries.upsert(session.id, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
      });

      // Set PR URL for the first time
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      // Verify summary was not modified (no reset needed for first-time set)
      const summary = sessionSummaries.getBySessionId(session.id);
      expect(summary.prState).toBeNull();
      expect(summary.prMerged).toBeFalsy(); // null in SQLite when never set
      expect(summary.shortSummary).toBe('Test');
    });

    it('resets PR state when prUrl is cleared (set to null)', async () => {
      // Set initial PR URL and create summary with merged state
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      sessionSummaries.upsert(session.id, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'merged',
        prMerged: true,
      });

      // Clear the PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: null })
        .expect(200);

      // Verify PR state was reset
      const summary = sessionSummaries.getBySessionId(session.id);
      expect(summary.prMerged).toBe(false);
      expect(summary.prState).toBeNull();
    });

    it('broadcasts summary update when PR state is reset', async () => {
      // Set initial PR URL and create summary with merged state
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      sessionSummaries.upsert(session.id, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'merged',
      });

      // Change to a different PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlB })
        .expect(200);

      // Verify broadcastSummaryUpdate was called with reset state
      expect(broadcastSummaryUpdate).toHaveBeenCalledWith(
        session.id,
        project.id,
        expect.objectContaining({
          prState: null,
        })
      );
    });

    it('triggers immediate PR status check when prUrl is set to a new value', async () => {
      // Set initial PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      // Change to a different PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlB })
        .expect(200);

      // Verify checkSessionCiStatusNow was called
      expect(checkSessionCiStatusNow).toHaveBeenCalledWith(session.id);
    });

    it('triggers immediate PR status check when prUrl is set for the first time', async () => {
      // Session has no prUrl initially
      // Set PR URL for the first time
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      // Verify checkSessionCiStatusNow was called
      expect(checkSessionCiStatusNow).toHaveBeenCalledWith(session.id);
    });

    it('does not trigger PR status check when prUrl is cleared', async () => {
      // Set initial PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: prUrlA })
        .expect(200);

      checkSessionCiStatusNow.mockClear();

      // Clear the PR URL
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ prUrl: null })
        .expect(200);

      // Verify checkSessionCiStatusNow was NOT called
      expect(checkSessionCiStatusNow).not.toHaveBeenCalled();
    });
  });
});
