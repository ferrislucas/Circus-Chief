import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../src/database.js';

// Mock websocket
vi.mock('../src/websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

// Import after mocking
import sessionsRouter from '../src/api/sessions.js';
import { broadcastToProject } from '../src/websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

describe('Sessions API - Star Endpoint', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  describe('POST /api/sessions/:id/star', () => {
    it('stars an unstarred session', async () => {
      expect(session.starred).toBe(false);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      expect(res.body.id).toBe(session.id);
      expect(res.body.starred).toBe(true);
    });

    it('unstars a starred session (toggles)', async () => {
      sessions.update(session.id, { starred: true });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      expect(res.body.starred).toBe(false);
    });

    it('broadcasts SESSION_UPDATED to project subscribers', async () => {
      await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          projectId: project.id,
          sessionId: session.id,
          session: expect.objectContaining({
            id: session.id,
            starred: true,
          }),
        })
      );
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/api/sessions/non-existent-id/star')
        .expect(404);

      expect(res.body.error).toBe('Session not found');
    });

    it('updates database correctly', async () => {
      await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.starred).toBe(true);
    });

    it('can toggle star status multiple times', async () => {
      // Star it
      let res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);
      expect(res.body.starred).toBe(true);

      // Unstar it
      res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);
      expect(res.body.starred).toBe(false);

      // Star it again
      res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);
      expect(res.body.starred).toBe(true);
    });

    it('works with archived sessions', async () => {
      sessions.update(session.id, { archived: true });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      expect(res.body.archived).toBe(true);
      expect(res.body.starred).toBe(true);
    });

    it('preserves other session properties when starring', async () => {
      const originalName = 'Test Session';
      const originalStatus = session.status;

      await request(app)
        .post(`/api/sessions/${session.id}/star`)
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.name).toBe(originalName);
      expect(updated.status).toBe(originalStatus);
      expect(updated.id).toBe(session.id);
    });
  });
});
