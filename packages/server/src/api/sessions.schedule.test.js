import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from './sessions.js';
import { projects, sessions, modelProviders, messages } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service (needed by sessions-patch.js)
vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  propagatePrUrlToParent: vi.fn(),
}));

// Mock prStatusService (needed by sessions-patch.js)
vi.mock('../services/prStatusService.js', () => ({
  checkSessionCiStatusNow: vi.fn().mockResolvedValue(false),
}));

// Mock summaryBroadcast (needed by sessions-patch.js)
vi.mock('../services/summaryBroadcast.js', () => ({
  broadcastSummaryUpdate: vi.fn(),
}));

describe('Sessions API - POST /:id/schedule', () => {
  let app;
  let project;
  let session;
  let openaiProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
    openaiProvider = null;
  });

  afterEach(() => {
    if (openaiProvider) {
      try {
        modelProviders.delete(openaiProvider.id);
      } catch {
        // Test cleanup only.
      }
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('schedules an idle session with prompt and future scheduledAt', async () => {
    const scheduledAt = Date.now() + 3600000; // 1 hour from now
    const prompt = 'Continue the analysis from where we left off';

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    expect(response.body.status).toBe('scheduled');
    expect(response.body.scheduledAt).toBe(scheduledAt);
    expect(response.body.pendingPrompt).toBe(prompt);
    expect(response.body.pendingModel).toBeNull();

    const stored = sessions.getById(session.id);
    expect(stored.status).toBe('scheduled');
    expect(stored.scheduledAt).toBe(scheduledAt);
    expect(stored.pendingPrompt).toBe(prompt);
  });

  it('accepts an ISO 8601 scheduledAt string and normalizes to epoch ms', async () => {
    const futureMs = Date.now() + 3600000;
    const isoString = new Date(futureMs).toISOString();
    const prompt = 'Resume work';

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt, scheduledAt: isoString })
      .expect(200);

    expect(typeof response.body.scheduledAt).toBe('number');
    expect(response.body.scheduledAt).toBe(futureMs);
  });

  it('sets pendingModel when a valid model is provided', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'opus',
      })
      .expect(200);

    expect(response.body.pendingModel).toBe('opus');
    expect(sessions.getById(session.id).pendingModel).toBe('opus');
  });

  it('returns 400 for a cross-kind model switch on a started session', async () => {
    openaiProvider = modelProviders.create({
      name: 'OpenAI Schedule Test',
      baseUrl: 'https://api.openai.schedule',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'gpt-schedule-cross-kind',
      displayName: 'GPT Schedule Cross Kind',
      tier: 'custom',
    });

    messages.create(session.id, 'assistant', 'Started response');

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'gpt-schedule-cross-kind',
      })
      .expect(400);

    expect(response.body.error).toBe('CROSS_KIND_MODEL_SWITCH');
    expect(sessions.getById(session.id).pendingModel).toBeNull();
  });

  it('broadcasts SESSION_STATUS and SESSION_UPDATED on success', async () => {
    const scheduledAt = Date.now() + 3600000;

    await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt })
      .expect(200);

    // SESSION_STATUS broadcast
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.SESSION_STATUS,
      expect.objectContaining({ sessionId: session.id, status: 'scheduled' }),
    );

    // SESSION_UPDATED broadcast to session subscribers
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id }),
    );

    // SESSION_UPDATED broadcast to project subscribers
    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id }),
    );
  });

  // ── Validation failures ─────────────────────────────────────────────────────

  it('returns 404 for unknown session id', async () => {
    await request(app)
      .post('/api/sessions/nonexistent-id/schedule')
      .send({ prompt: 'Hello', scheduledAt: Date.now() + 3600000 })
      .expect(404);
  });

  it('returns 400 when prompt is missing', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when prompt is empty string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: '   ', scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when prompt is not a string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 42, scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when scheduledAt is missing', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue' })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when scheduledAt is in the past', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: Date.now() - 1000 })
      .expect(400);

    expect(response.body.error).toMatch(/future/i);
  });

  it('returns 400 when scheduledAt is invalid (non-finite number)', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: Infinity })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when scheduledAt is an unparseable string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: 'not-a-date' })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when model is an invalid model id', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'definitely-not-a-real-model-id-xyz',
      })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });
});
