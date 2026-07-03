import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, modelProviders } from '../database.js';

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

    it('rejects invalid pendingModel values', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ pendingModel: 'not-a-real-model' })
        .expect(400);

      expect(response.body.error).toContain('Invalid pendingModel id "not-a-real-model"');
      expect(response.body.error).toContain('Valid model ids are:');
      expect(response.body.error).toContain('opus');
    });
  });

  describe('POST /sessions/:id/schedule - model field', () => {
    // The schedule endpoint takes prompt + scheduledAt + optional model directly
    // in the request body. model becomes pendingModel on the session.

    it('sets pendingModel when scheduling a session with model field', async () => {
      const scheduledAt = Date.now() + 3600000; // 1 hour from now
      const model = 'opus';

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          prompt: 'Continue the work',
          scheduledAt,
          model,
        })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      expect(response.body.pendingModel).toBe(model);
      expect(response.body.pendingPrompt).toBe('Continue the work');

      // Verify it was persisted
      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBe(model);
    });

    it('schedules without pendingModel when model not provided and no pendingModel exists', async () => {
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ prompt: 'Continue', scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      // pendingModel should be null if not set
      expect(response.body.pendingModel).toBeNull();
    });

    it('preserves existing pendingModel when scheduling without model', async () => {
      sessions.update(session.id, { pendingModel: 'opus' });
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ prompt: 'Continue', scheduledAt })
        .expect(200);

      expect(response.body.status).toBe('scheduled');
      expect(response.body.pendingModel).toBe('opus');

      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBe('opus');
    });

    it('overwrites existing pendingModel when scheduling with model', async () => {
      // First set a pendingModel
      sessions.update(session.id, { pendingModel: 'haiku' });

      const scheduledAt = Date.now() + 3600000;
      const newModel = 'sonnet';

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          prompt: 'Continue',
          scheduledAt,
          model: newModel,
        })
        .expect(200);

      expect(response.body.pendingModel).toBe(newModel);
    });

    it('returns 404 for non-existent session when scheduling', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .post(`/api/sessions/${fakeId}/schedule`)
        .send({
          prompt: 'Continue',
          scheduledAt: Date.now() + 3600000,
          model: 'sonnet',
        })
        .expect(404);
    });

    it('returns 400 when prompt is missing', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ scheduledAt: Date.now() + 3600000 })
        .expect(400);

      expect(response.body.error).toMatch(/prompt/i);
    });

    it('rejects invalid model when scheduling', async () => {
      const scheduledAt = Date.now() + 3600000;

      const response = await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({
          prompt: 'Continue',
          scheduledAt,
          model: 'not-a-real-model',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid model id "not-a-real-model"');
    });
  });

  describe('POST /api/sessions/:id/start - pendingModel fallback', () => {
    beforeEach(() => {
      vi.mocked(runSession).mockClear();
      vi.mocked(runSession).mockResolvedValue(undefined);
    });

    it('uses session.pendingModel when no model in request body', async () => {
      sessions.update(session.id, { pendingModel: 'opus' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      // model is now inside the options object (4th argument)
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('opus');
    });

    it('uses req.body.model over session.pendingModel when both exist', async () => {
      sessions.update(session.id, { pendingModel: 'opus' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ model: 'sonnet' })
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('sonnet');
    });

    it('falls back to session.model when pendingModel is null', async () => {
      sessions.update(session.id, { model: 'opus', pendingModel: null });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('opus');
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
      sessions.update(session.id, { pendingModel: 'opus' });

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.pendingModel).toBeNull();
    });

    it('renders Liquid in the draft start prompt when renderLiquid is true', async () => {
      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({
          prompt: 'Review {{ workspace.name }} from {{ workspace.name }}',
          renderLiquid: true,
        })
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      expect(vi.mocked(runSession).mock.calls[0][1]).toBe('Review Test Session from Test Session');
    });

    it('leaves Liquid literal in the draft start prompt when renderLiquid is not set', async () => {
      const prompt = 'Keep {{ workspace.name }} literal';

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ prompt })
        .expect(200);

      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      expect(vi.mocked(runSession).mock.calls[0][1]).toBe(prompt);
    });

    it('rejects invalid request model', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ model: 'not-a-real-model' })
        .expect(400);

      expect(response.body.error).toContain('Invalid model id "not-a-real-model"');
      expect(vi.mocked(runSession)).not.toHaveBeenCalled();
    });

    it('rejects invalid pendingModel fallback', async () => {
      sessions.update(session.id, { pendingModel: 'not-a-real-model' });

      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Invalid model id "not-a-real-model"');
      expect(vi.mocked(runSession)).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/sessions/:id/start - cross-kind draft start regression', () => {
    let openaiProvider;

    beforeEach(() => {
      vi.mocked(runSession).mockClear();
      vi.mocked(runSession).mockResolvedValue(undefined);

      // Register an OpenAI-kind provider + model so resolveAgentTypeFromModel
      // can resolve 'gpt-4o-draft-start' to agentType 'codex'.
      openaiProvider = modelProviders.create({
        name: 'OpenAI Draft Start Provider',
        baseUrl: 'https://api.openai.example',
        authToken: 'key-o',
        kind: 'openai',
      });
      modelProviders.addModel(openaiProvider.id, {
        modelId: 'gpt-4o-draft-start',
        displayName: 'GPT 4o Draft Start',
        tier: 'custom',
      });
    });

    afterEach(() => {
      try {
        modelProviders.delete(openaiProvider.id);
      } catch {
        /* noop */
      }
    });

    it('allows claude-code draft to start with codex model and persists agentType', async () => {
      // Create a waiting draft session with claude-code agentType and Claude model
      const claudeDraft = sessions.create(project.id, 'Claude Draft', 'hi', {
        agentType: 'claude-code',
        model: 'claude-sonnet',
      });
      sessions.update(claudeDraft.id, { status: 'waiting' });

      const res = await request(app)
        .post(`/api/sessions/${claudeDraft.id}/start`)
        .send({ model: 'gpt-4o-draft-start' })
        .expect(200);

      // Should succeed (no CROSS_KIND_MODEL_SWITCH error)
      expect(res.body.error).toBeUndefined();
      expect(res.body.success).toBe(true);

      // runSession should have been called with the codex model
      expect(vi.mocked(runSession)).toHaveBeenCalledOnce();
      const optionsArg = vi.mocked(runSession).mock.calls[0][3];
      expect(optionsArg.model).toBe('gpt-4o-draft-start');

      // Persisted session should have the codex model, codex agentType, and cleared pendingModel
      const updated = sessions.getById(claudeDraft.id);
      expect(updated.model).toBe('gpt-4o-draft-start');
      expect(updated.agentType).toBe('codex');
      expect(updated.pendingModel).toBeNull();

      // Clean up
      try { sessions.delete(claudeDraft.id); } catch { /* noop */ }
    });
  });
});
