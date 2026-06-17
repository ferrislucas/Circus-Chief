import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, modelProviders, messages } from '../database.js';

// Mock websocket so PATCH/start don't try to reach real subscribers.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager so any start path doesn't spawn real agent processes.
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
  continueSessionWithExistingMessage: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
}));

// Import after mocks.
import sessionsRouter from './sessions.js';

/**
 * Regression: a session's `agent_type` and `model` must stay the same "kind".
 *
 * Production bug (session 9a2bacff / b4ab2ff2): a Codex session had its model
 * switched to a Claude model on a not-yet-started (waiting) session. The model
 * change persisted but `agent_type` was left as `codex`. When the scheduler
 * later started it, the Codex adapter was handed a Claude model and the backend
 * rejected it ("model not supported when using Codex with a ChatGPT account").
 *
 * These tests reproduce that sequence through the real PATCH route and define
 * success: switching a draft/waiting session to a model of a different kind must
 * re-derive `agent_type` (and keep provider/pendingModel consistent), so the
 * value the scheduler/run path trusts always matches the model.
 */
describe('Cross-kind agent/model drift on model change', () => {
  let app;
  let project;
  let openaiProvider;
  let anthropicProvider;

  const OPENAI_MODEL = 'gpt-drift-test';
  const CLAUDE_SONNET = 'claude-sonnet-drift-test';
  const CLAUDE_OPUS = 'claude-opus-drift-test';

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Drift Test Project', '/tmp/drift-test');

    openaiProvider = modelProviders.create({
      name: 'OpenAI Drift Test',
      baseUrl: 'https://api.openai.drift',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: OPENAI_MODEL,
      displayName: 'GPT Drift',
      tier: 'custom',
    });

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Drift Test',
      baseUrl: 'https://api.anthropic.drift',
      authToken: 'key-a',
      kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: CLAUDE_SONNET,
      displayName: 'Claude Sonnet Drift',
      tier: 'sonnet',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: CLAUDE_OPUS,
      displayName: 'Claude Opus Drift',
      tier: 'opus',
    });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  /** Create a waiting (not-yet-started) Codex session, mirroring a scheduled follow-up. */
  function createWaitingCodexSession() {
    const session = sessions.create(project.id, 'Drift Session', 'Initial prompt', {
      model: OPENAI_MODEL,
      providerId: openaiProvider.id,
      status: 'waiting',
    });
    // Mirror a scheduled session that hasn't produced any assistant turn yet.
    sessions.update(session.id, { pendingModel: OPENAI_MODEL });
    return sessions.getById(session.id);
  }

  it('sanity: a session created with an OpenAI model derives agentType "codex"', () => {
    const session = createWaitingCodexSession();
    expect(session.agentType).toBe('codex');
  });

  it('re-derives agentType to "claude-code" when a waiting Codex session switches to a Claude model', async () => {
    const session = createWaitingCodexSession();
    expect(session.agentType).toBe('codex');

    // Exactly what the frontend does on a model switch for a waiting session:
    // PATCH model + providerId + pendingModel (see stores updateSessionModel).
    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({
        model: CLAUDE_SONNET,
        providerId: anthropicProvider.id,
        pendingModel: CLAUDE_SONNET,
      })
      .expect(200);

    const updated = sessions.getById(session.id);

    // The model change must be persisted...
    expect(updated.model).toBe(CLAUDE_SONNET);
    expect(updated.pendingModel).toBe(CLAUDE_SONNET);
    expect(updated.providerId).toBe(anthropicProvider.id);

    // ...AND agent_type must follow the model kind. This is the value the
    // scheduler/run path trusts when it builds the agent adapter.
    // FAILS before the fix (stays 'codex' -> Codex adapter + Claude model -> 400).
    expect(updated.agentType).toBe('claude-code');
  });

  it('does not flip agentType for a same-kind model change (sonnet -> opus)', async () => {
    // Start from a Claude (waiting) session.
    const session = sessions.create(project.id, 'Claude Drift Session', 'Initial prompt', {
      model: CLAUDE_SONNET,
      providerId: anthropicProvider.id,
      status: 'waiting',
    });
    expect(sessions.getById(session.id).agentType).toBe('claude-code');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_OPUS, pendingModel: CLAUDE_OPUS })
      .expect(200);

    expect(sessions.getById(session.id).agentType).toBe('claude-code');
  });

  it('rejects a cross-kind model change on a started session (has assistant messages) with 400', async () => {
    // Start from a running Claude session that has an assistant message.
    const session = sessions.create(project.id, 'Started Claude Session', 'Initial prompt', {
      model: CLAUDE_SONNET,
      providerId: anthropicProvider.id,
      status: 'running',
    });
    // Add an assistant message to simulate a started session.
    messages.create(session.id, 'assistant', 'Hello, I am Claude.');

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: OPENAI_MODEL, providerId: openaiProvider.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    // The session must NOT have been mutated.
    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(CLAUDE_SONNET);
    expect(unchanged.agentType).toBe('claude-code');
  });

  it('does not block same-kind model change on a started session', async () => {
    const session = sessions.create(project.id, 'Started Claude Same-kind', 'Initial prompt', {
      model: CLAUDE_SONNET,
      providerId: anthropicProvider.id,
      status: 'running',
    });
    messages.create(session.id, 'assistant', 'Hello!');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_OPUS })
      .expect(200);

    expect(sessions.getById(session.id).model).toBe(CLAUDE_OPUS);
    expect(sessions.getById(session.id).agentType).toBe('claude-code');
  });
});

describe('Gemini kind coverage — cross-kind PATCH re-derivation', () => {
  let app;
  let project;
  let anthropicProvider;
  let googleProvider;

  const CLAUDE_MODEL = 'claude-gemini-test';
  const GEMINI_MODEL = 'gemini-gemini-test';

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Gemini Drift Project', '/tmp/gemini-drift');

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Gemini Test',
      baseUrl: 'https://api.anthropic.gemini',
      authToken: 'key-a',
      kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: CLAUDE_MODEL,
      displayName: 'Claude Gemini Test',
      tier: 'sonnet',
    });

    googleProvider = modelProviders.create({
      name: 'Google Gemini Test',
      baseUrl: 'https://generativelanguage.googleapis.com',
      authToken: 'key-g',
      kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, {
      modelId: GEMINI_MODEL,
      displayName: 'Gemini Test Model',
      tier: 'custom',
    });
  });

  afterEach(() => {
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  it('re-derives agentType to "gemini" when a waiting Claude session switches to a Gemini model', async () => {
    const session = sessions.create(project.id, 'Claude to Gemini', 'Initial prompt', {
      model: CLAUDE_MODEL,
      providerId: anthropicProvider.id,
      status: 'waiting',
    });
    expect(sessions.getById(session.id).agentType).toBe('claude-code');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GEMINI_MODEL, providerId: googleProvider.id, pendingModel: GEMINI_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(GEMINI_MODEL);
    expect(updated.agentType).toBe('gemini');
  });

  it('re-derives agentType to "claude-code" when a waiting Gemini session switches to a Claude model', async () => {
    const session = sessions.create(project.id, 'Gemini to Claude', 'Initial prompt', {
      model: GEMINI_MODEL,
      providerId: googleProvider.id,
      status: 'waiting',
    });
    expect(sessions.getById(session.id).agentType).toBe('gemini');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL, providerId: anthropicProvider.id, pendingModel: CLAUDE_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(CLAUDE_MODEL);
    expect(updated.agentType).toBe('claude-code');
  });
});
