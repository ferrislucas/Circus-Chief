import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from './sessions.js';
import { projects, sessions } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service
vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  onSessionActivity: vi.fn(),
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

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBe(prUrl);
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

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBeNull();
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

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.prUrl).toBeNull();
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
});
