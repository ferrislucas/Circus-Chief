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
  onSessionActivity: vi.fn(),
}));

describe('Sessions API - Name & manuallyNamed Endpoint', () => {
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

  describe('PATCH /sessions/:id - name field', () => {
    it('updates session name', async () => {
      const newName = 'Updated Session Name';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ name: newName })
        .expect(200);

      expect(response.body.name).toBe(newName);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.name).toBe(newName);
    });

    it('auto-sets manuallyNamed when name is updated', async () => {
      const newName = 'Custom Name';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ name: newName })
        .expect(200);

      // Should auto-set manuallyNamed to true
      expect(response.body.manuallyNamed).toBe(true);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.manuallyNamed).toBe(true);
    });

    it('respects explicit manuallyNamed: false when updating name', async () => {
      const newName = 'Another Name';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ name: newName, manuallyNamed: false })
        .expect(200);

      // Should respect the explicit false value
      expect(response.body.manuallyNamed).toBe(false);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.manuallyNamed).toBe(false);
    });

    it('sets manuallyNamed without changing name', async () => {
      const originalName = session.name;

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ manuallyNamed: true })
        .expect(200);

      // Name should remain unchanged
      expect(response.body.name).toBe(originalName);
      expect(response.body.manuallyNamed).toBe(true);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.name).toBe(originalName);
      expect(updated.manuallyNamed).toBe(true);
    });

    it('allows clearing manuallyNamed flag', async () => {
      // First set manuallyNamed to true
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ name: 'Custom', manuallyNamed: true })
        .expect(200);

      // Clear the flag
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ manuallyNamed: false })
        .expect(200);

      expect(response.body.manuallyNamed).toBe(false);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.manuallyNamed).toBe(false);
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .patch(`/api/sessions/${fakeId}`)
        .send({ name: 'New Name' })
        .expect(404);
    });

    it('can combine name update with other fields', async () => {
      const newName = 'Updated Name';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          name: newName,
          thinkingEnabled: true
        })
        .expect(200);

      expect(response.body.name).toBe(newName);
      expect(response.body.thinkingEnabled).toBe(true);
      expect(response.body.manuallyNamed).toBe(true); // Auto-set
    });
  });
});
