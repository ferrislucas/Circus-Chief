import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager so POST /start doesn't try to spawn real Claude processes
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
  continueSessionWithExistingMessage: vi.fn(),
}));

// Mock summary service
vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  onSessionActivity: vi.fn(),
}));

// Import after mocks
import sessionsRouter from './sessions.js';
import { runSession } from '../services/sessionManager.js';

describe('Sessions API - pendingModel Field', () => {
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

  describe('PATCH /sessions/:id - pendingModel field', () => {
    it('sets pendingModel to a valid model string', async () => {
      const pendingModel = 'sonnet';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel })
        .expect(200);

      expect(response.body.pendingModel).toBe(pendingModel);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBe(pendingModel);
    });

    it('updates pendingModel to a different model', async () => {
      // First set a model
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: 'haiku' })
        .expect(200);

      // Update to a new model
      const newPendingModel = 'opus';
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: newPendingModel })
        .expect(200);

      expect(response.body.pendingModel).toBe(newPendingModel);
    });

    it('clears pendingModel when set to null', async () => {
      // First set a pendingModel
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: 'sonnet' })
        .expect(200);

      // Clear the pendingModel with null
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: null })
        .expect(200);

      expect(response.body.pendingModel).toBeNull();

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBeNull();
    });

    it('does not modify pendingModel when not included in request', async () => {
      // First set a pendingModel
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: 'opus' })
        .expect(200);

      // Update something else (thinkingEnabled) without including pendingModel
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ thinkingEnabled: true })
        .expect(200);

      // pendingModel should still be set
      expect(response.body.pendingModel).toBe('opus');
    });

    it('does not affect other fields when only updating pendingModel', async () => {
      const originalModel = session.model;
      const originalThinkingEnabled = session.thinkingEnabled;

      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: 'haiku' })
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.model).toBe(originalModel);
      expect(updated.thinkingEnabled).toBe(originalThinkingEnabled);
      expect(updated.pendingModel).toBe('haiku');
    });

    it('can combine pendingModel update with other fields', async () => {
      const pendingModel = 'sonnet';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          pendingModel,
          thinkingEnabled: true
        })
        .expect(200);

      expect(response.body.pendingModel).toBe(pendingModel);
      expect(response.body.thinkingEnabled).toBe(true);
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .patch(`/api/sessions/${fakeId}`)
        .send({ pendingModel: 'sonnet' })
        .expect(404);
    });

    it('accepts any valid string as pendingModel (no validation)', async () => {
      // pendingModel accepts any string, just like the model field
      const customModel = 'custom-model-name';

      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: customModel })
        .expect(200);

      expect(response.body.pendingModel).toBe(customModel);
    });
  });

  describe('POST /sessions/:id/schedule - pendingModel field', () => {
    beforeEach(() => {
      // Set a pending prompt so scheduling is allowed
      sessions.update(session.id, {
        pendingPrompt: 'Follow-up prompt',
        status: 'waiting'
      });
    });

    it('sets pendingModel when scheduling a session', async () => {
      const scheduledAt = Date.now() + 3600000; // 1 hour from now
      const pendingModel = 'opus';

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          scheduledAt,
          pendingModel
        })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      expect(response.body.pendingModel).toBe(pendingModel);

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBe(pendingModel);
    });

    it('schedules without pendingModel when not provided', async () => {
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      // pendingModel should remain null if not set
      expect(response.body.pendingModel).toBeNull();
    });

    it('updates existing pendingModel when scheduling', async () => {
      // First set a pendingModel
      sessions.update(session.id, { pendingModel: 'haiku' });

      const scheduledAt = Date.now() + 3600000;
      const newPendingModel = 'sonnet';

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          scheduledAt,
          pendingModel: newPendingModel
        })
        .expect(200);

      expect(response.body.pendingModel).toBe(newPendingModel);
    });

    it('can combine pendingModel with other scheduling options', async () => {
      const scheduledAt = Date.now() + 3600000;
      const pendingModel = 'opus';

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          scheduledAt,
          pendingModel,
          autoRescheduleEnabled: true,
          rescheduleDelayMinutes: 30
        })
        .expect(200);

      expect(response.body.pendingModel).toBe(pendingModel);
      expect(response.body.autoRescheduleEnabled).toBe(true);
      expect(response.body.rescheduleDelayMinutes).toBe(30);
    });

    it('returns 404 for non-existent session when scheduling', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .post(`/api/sessions/${fakeId}/schedule`)
        .send({
          scheduledAt: Date.now() + 3600000,
          pendingModel: 'sonnet'
        })
        .expect(404);
    });

    it('returns 400 when trying to schedule without pendingPrompt', async () => {
      // Clear the pending prompt
      sessions.update(session.id, { pendingPrompt: null });

      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          scheduledAt,
          pendingModel: 'sonnet'
        })
        .expect(400);

      expect(response.body.error).toContain('pendingPrompt must be set');
    });

    it('clears pendingModel when set to null during scheduling', async () => {
      // First set a pendingModel
      sessions.update(session.id, { pendingModel: 'sonnet' });

      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          scheduledAt,
          pendingModel: null
        })
        .expect(200);

      expect(response.body.pendingModel).toBeNull();
    });
  });

  describe('POST /api/sessions/:id/start - pendingModel fallback', () => {
    beforeEach(() => {
      vi.mocked(runSession).mockClear();
      vi.mocked(runSession).mockResolvedValue(undefined);
    });

    it('uses session.pendingModel when no model in request body', async () => {
      sessions.update(session.id, { pendingModel: 'claude-opus-4-6-20250616' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      // model is now inside the options object (4th argument)
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('claude-opus-4-6-20250616');
    });

    it('uses req.body.model over session.pendingModel when both exist', async () => {
      sessions.update(session.id, { pendingModel: 'claude-opus-4-6-20250616' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ model: 'claude-sonnet-4-5-20251219' })
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('claude-sonnet-4-5-20251219');
    });

    it('falls back to session.model when pendingModel is null', async () => {
      sessions.update(session.id, { model: 'claude-opus-4-6-20250616', pendingModel: null });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('claude-opus-4-6-20250616');
    });

    it('passes null model to runSession when no model is set anywhere', async () => {
      // session.model and session.pendingModel are null by default
      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBeNull();
    });

    it('clears pendingModel after session is started', async () => {
      sessions.update(session.id, { pendingModel: 'claude-opus-4-6-20250616' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBeNull();
    });
  });
});
