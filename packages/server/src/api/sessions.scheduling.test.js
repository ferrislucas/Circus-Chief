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

describe('Sessions API - Scheduling PATCH behavior', () => {
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

  describe('PATCH /sessions/:id - scheduledAt field', () => {
    it('auto-promotes to scheduled when scheduledAt is set without status', async () => {
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      expect(response.body.scheduledAt).toBe(scheduledAt);

      const updated = sessions.getById(session.id);
      expect(updated.status).toBe('scheduled');
      expect(updated.scheduledAt).toBe(scheduledAt);
    });

    it('respects explicit status when scheduledAt and status are provided', async () => {
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt, status: 'waiting' })
        .expect(200);

      expect(response.body.status).toBe('waiting');
      expect(response.body.scheduledAt).toBe(scheduledAt);
    });

    it('does not auto-promote when scheduledAt is cleared', async () => {
      sessions.update(session.id, {
        status: 'scheduled',
        scheduledAt: Date.now() + 3600000,
      });

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt: null })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      expect(response.body.scheduledAt).toBeNull();
    });

    it('does not auto-promote a running session', async () => {
      const scheduledAt = Date.now() + 3600000;
      sessions.update(session.id, { status: 'running' });

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('running');
      expect(response.body.scheduledAt).toBe(scheduledAt);
    });

    it('does not auto-promote a starting session', async () => {
      const scheduledAt = Date.now() + 3600000;
      sessions.update(session.id, { status: 'starting' });

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('starting');
      expect(response.body.scheduledAt).toBe(scheduledAt);
    });
  });
});
