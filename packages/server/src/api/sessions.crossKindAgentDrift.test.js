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

vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

// Import after mocks.
import sessionsRouter from './sessions.js';
import { continueSession } from '../services/sessionManager.js';
import { resolveAgentTypeFromModel } from '../services/sessionProvider.js';
import { SchedulerService } from '../services/schedulerService.js';

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

  it('allows an in-scope cross-kind model change on a started session and re-derives agentType (FR2)', async () => {
    // Start from a running Claude session that has an assistant message.
    const session = sessions.create(project.id, 'Started Claude Session', 'Initial prompt', {
      model: CLAUDE_SONNET,
      providerId: anthropicProvider.id,
      status: 'running',
    });
    // Add an assistant message to simulate a started session.
    messages.create(session.id, 'assistant', 'Hello, I am Claude.');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: OPENAI_MODEL, providerId: openaiProvider.id })
      .expect(200);

    // The model change is persisted AND agent_type follows the model kind.
    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(OPENAI_MODEL);
    expect(updated.agentType).toBe('codex');
    expect(updated.providerId).toBe(openaiProvider.id);
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

/**
 * RED (plan Phase 1, FR1/FR2/FR9): in-place cross-provider switch on
 * STARTED sessions (has ≥1 assistant message) for in-scope kinds
 * (claude-code ↔ codex ↔ muse). Gemini stays blocked everywhere, and the
 * non-interactive schedule path stays strict.
 */
describe('Started-session in-scope cross-kind switch (FR1/FR2/FR9)', () => {
  let app;
  let project;
  let openaiProvider;
  let anthropicProvider;
  let metaProvider;
  let googleProvider;

  const GPT_MODEL = 'gpt-xkind-test';
  const CLAUDE_MODEL = 'claude-xkind-test';
  const MUSE_MODEL = 'muse-xkind-test';
  const GEMINI_MODEL = 'gemini-xkind-test';

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('XKind Started Project', '/tmp/xkind-started-test');

    openaiProvider = modelProviders.create({
      name: 'OpenAI XKind', baseUrl: 'https://api.openai.xkind', authToken: 'key-o', kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL, displayName: 'GPT XKind', tier: 'custom' });

    anthropicProvider = modelProviders.create({
      name: 'Anthropic XKind', baseUrl: 'https://api.anthropic.xkind', authToken: 'key-a', kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_MODEL, displayName: 'Claude XKind', tier: 'sonnet' });

    metaProvider = modelProviders.create({
      name: 'Meta XKind', baseUrl: null, authToken: null, kind: 'meta',
    });
    modelProviders.addModel(metaProvider.id, { modelId: MUSE_MODEL, displayName: 'Muse XKind', tier: 'custom' });

    googleProvider = modelProviders.create({
      name: 'Google XKind', baseUrl: 'https://generativelanguage.xkind', authToken: 'key-g', kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, { modelId: GEMINI_MODEL, displayName: 'Gemini XKind', tier: 'custom' });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(metaProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  /** Started session: waiting + ≥1 assistant message. */
  function createStartedSession({ name, model, providerId }) {
    const session = sessions.create(project.id, name, 'Initial prompt', {
      model,
      providerId,
      status: 'waiting',
    });
    messages.create(session.id, 'assistant', 'Prior assistant turn.');
    return sessions.getById(session.id);
  }

  it('PATCH model codex→claude-code on a started session persists model + re-derived agentType', async () => {
    const session = createStartedSession({ name: 'Codex Started', model: GPT_MODEL, providerId: openaiProvider.id });
    expect(session.agentType).toBe('codex');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL, providerId: anthropicProvider.id })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(CLAUDE_MODEL);
    expect(updated.agentType).toBe('claude-code');
    expect(updated.providerId).toBe(anthropicProvider.id);
  });

  it('PATCH pendingModel-only codex→claude-code on a started session is rejected and mutates nothing (#2 Option A)', async () => {
    const session = createStartedSession({ name: 'Codex Started Pending', model: GPT_MODEL, providerId: openaiProvider.id });
    expect(session.agentType).toBe('codex');

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: CLAUDE_MODEL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(GPT_MODEL);
    expect(unchanged.pendingModel).toBeNull();
    expect(unchanged.agentType).toBe('codex');
    expect(resolveAgentTypeFromModel(unchanged.model)).toBe(unchanged.agentType);
  });

  it('PATCH pendingModel-only same-kind on a started session is still allowed with agentType unchanged (#2)', async () => {
    const session = createStartedSession({ name: 'Codex Started Same Pending', model: GPT_MODEL, providerId: openaiProvider.id });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: GPT_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.pendingModel).toBe(GPT_MODEL);
    expect(updated.model).toBe(GPT_MODEL);
    expect(updated.agentType).toBe('codex');
  });

  it('PATCH pendingModel-only involving gemini on a started session still 400s and mutates nothing (#2)', async () => {
    const session = createStartedSession({ name: 'Claude Started Gemini Pending', model: CLAUDE_MODEL, providerId: anthropicProvider.id });

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: GEMINI_MODEL });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(CLAUDE_MODEL);
    expect(unchanged.agentType).toBe('claude-code');
    expect(unchanged.pendingModel).toBeNull();
  });

  it('after a rejected pendingModel-only cross-kind PATCH, a plain follow-up turn still runs the old kind (#2)', async () => {
    const session = createStartedSession({ name: 'Codex Follow-up After Reject', model: GPT_MODEL, providerId: openaiProvider.id });

    const patchRes = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: CLAUDE_MODEL });
    expect(patchRes.status).toBe(400);

    const stored = sessions.getById(session.id);
    expect(resolveAgentTypeFromModel(stored.model)).toBe(stored.agentType);

    const msgRes = await request(app)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'plain follow-up' });
    expect(msgRes.status).toBe(200);
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledWith(
      session.id,
      'plain follow-up',
      expect.anything(),
      expect.objectContaining({ model: null, interactive: true }),
    );
  });

  it('PATCH model claude→muse on a started session persists model + re-derived agentType', async () => {
    const session = createStartedSession({ name: 'Claude Started', model: CLAUDE_MODEL, providerId: anthropicProvider.id });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: MUSE_MODEL, providerId: metaProvider.id })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(MUSE_MODEL);
    expect(updated.agentType).toBe('muse');
  });

  it('PATCH model involving gemini on a started session still 400s and mutates nothing', async () => {
    const session = createStartedSession({ name: 'Claude Started Gemini', model: CLAUDE_MODEL, providerId: anthropicProvider.id });

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GEMINI_MODEL, providerId: googleProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(CLAUDE_MODEL);
    expect(unchanged.agentType).toBe('claude-code');
    expect(unchanged.providerId).toBe(anthropicProvider.id);
  });

  it('PATCH model gemini→claude on a started session still 400s and mutates nothing', async () => {
    const session = createStartedSession({ name: 'Gemini Started', model: GEMINI_MODEL, providerId: googleProvider.id });
    expect(session.agentType).toBe('gemini');

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL, providerId: anthropicProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(GEMINI_MODEL);
    expect(unchanged.agentType).toBe('gemini');
  });

  it('POST /message with in-scope cross-kind model on a started session is accepted and dispatched', async () => {
    const session = createStartedSession({ name: 'Codex Msg Started', model: GPT_MODEL, providerId: openaiProvider.id });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'follow-up on new provider', model: CLAUDE_MODEL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledWith(
      session.id,
      'follow-up on new provider',
      expect.anything(),
      expect.objectContaining({ model: CLAUDE_MODEL, interactive: true }),
    );
  });

  it('POST /message with gemini cross-kind model still 400s and dispatches nothing', async () => {
    const session = createStartedSession({ name: 'Claude Msg Started', model: CLAUDE_MODEL, providerId: anthropicProvider.id });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'follow-up', model: GEMINI_MODEL });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');
    expect(continueSession).not.toHaveBeenCalled();
  });

  it('PATCH model + pendingModel of divergent in-scope kinds is rejected and mutates nothing (#2)', async () => {
    const claudeSession = createStartedSession({ name: 'Claude Divergent', model: CLAUDE_MODEL, providerId: anthropicProvider.id });
    const codexSession = createStartedSession({ name: 'Codex Divergent', model: GPT_MODEL, providerId: openaiProvider.id });

    // model resolves to codex-kind while pendingModel resolves to
    // claude-kind: no single agentType can agree with both persisted fields.
    const res = await request(app)
      .patch(`/api/sessions/${claudeSession.id}`)
      .send({ model: GPT_MODEL, pendingModel: CLAUDE_MODEL });
    expect(res.status).toBe(400);

    const unchanged = sessions.getById(claudeSession.id);
    expect(unchanged.model).toBe(CLAUDE_MODEL);
    expect(unchanged.pendingModel).toBeNull();
    expect(unchanged.agentType).toBe('claude-code');
    expect(unchanged.providerId).toBe(anthropicProvider.id);
    // Invariant: persisted model and agentType agree in kind, so a
    // follow-up non-interactive turn runs adapter-kind == model-kind (FR9).
    expect(resolveAgentTypeFromModel(unchanged.model)).toBe(unchanged.agentType);

    // Mirror direction: model claude-kind + pendingModel codex-kind.
    const res2 = await request(app)
      .patch(`/api/sessions/${codexSession.id}`)
      .send({ model: CLAUDE_MODEL, pendingModel: GPT_MODEL });
    expect(res2.status).toBe(400);

    const unchanged2 = sessions.getById(codexSession.id);
    expect(unchanged2.model).toBe(GPT_MODEL);
    expect(unchanged2.pendingModel).toBeNull();
    expect(unchanged2.agentType).toBe('codex');
    expect(resolveAgentTypeFromModel(unchanged2.model)).toBe(unchanged2.agentType);
  });

  it('stale stored model + NO override: POST /message is a same-kind continuation, not a switch (#1 route guard)', async () => {
    const session = createStartedSession({ name: 'Codex Stale Msg', model: GPT_MODEL, providerId: openaiProvider.id });
    // Model renamed after the session started: the stored model id no
    // longer resolves and falls back to 'claude-code'. With no explicit
    // model override the guard must NOT classify this as a cross-kind
    // switch in either direction — the turn continues same-kind.
    sessions.update(session.id, { model: 'stale-renamed-model-xyz' });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'follow-up with no override' });

    expect(res.status).toBe(200);
    expect(continueSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledWith(
      session.id,
      'follow-up with no override',
      expect.anything(),
      expect.objectContaining({ model: null, interactive: true }),
    );
  });

  it('stale stored model on a gemini session + NO override: POST /message must NOT 400 (#1 route guard)', async () => {
    const session = createStartedSession({ name: 'Gemini Stale Msg', model: GEMINI_MODEL, providerId: googleProvider.id });
    expect(session.agentType).toBe('gemini');
    sessions.update(session.id, { model: 'stale-renamed-model-xyz' });

    // Pre-fix this 400s: the stale id falls back to 'claude-code' and the
    // guard reads gemini→claude-code as an out-of-scope switch, bricking a
    // session the user never asked to switch. No override means no switch.
    const res = await request(app)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'follow-up with no override' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(continueSession).toHaveBeenCalledTimes(1);
  });

  it('PATCH cross-kind switch clears a disagreeing stored pendingModel but leaves the schedule intact (PR #1)', async () => {
    const session = createStartedSession({ name: 'Codex Stale Pending', model: GPT_MODEL, providerId: openaiProvider.id });
    expect(session.agentType).toBe('codex');
    // Mirror a schedule-with-model on kind-X: pendingModel + schedule fields
    // persisted together (as POST /schedule does), status scheduled.
    const scheduledAt = Date.now() + 3600000;
    sessions.update(session.id, {
      pendingModel: GPT_MODEL,
      scheduledAt,
      pendingPrompt: 'scheduled follow-up',
      status: 'scheduled',
    });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(CLAUDE_MODEL);
    expect(updated.agentType).toBe('claude-code');
    // Stale kind-X override dropped (pre-fix: still GPT_MODEL, stranding the
    // next scheduled fire); the schedule itself is untouched.
    expect(updated.pendingModel).toBeNull();
    expect(updated.scheduledAt).toBe(scheduledAt);
    expect(updated.pendingPrompt).toBe('scheduled follow-up');
    expect(updated.status).toBe('scheduled');
    expect(resolveAgentTypeFromModel(updated.model)).toBe(updated.agentType);
  });

  it('PATCH cross-kind switch keeps a pendingModel that already agrees with the new kind (PR #1)', async () => {
    const session = createStartedSession({ name: 'Codex Agreeing Pending', model: GPT_MODEL, providerId: openaiProvider.id });
    sessions.update(session.id, { pendingModel: CLAUDE_MODEL });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.agentType).toBe('claude-code');
    expect(updated.pendingModel).toBe(CLAUDE_MODEL);
  });

  it('PATCH same-kind model change keeps a stored same-kind pendingModel (PR #1 control)', async () => {
    const session = createStartedSession({ name: 'Codex Same-kind Pending', model: GPT_MODEL, providerId: openaiProvider.id });
    sessions.update(session.id, { pendingModel: GPT_MODEL });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GPT_MODEL })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.agentType).toBe('codex');
    expect(updated.pendingModel).toBe(GPT_MODEL);
  });

  it('scheduled fire after a cross-kind switch launches with session.model, not the stale pendingModel (PR #1)', async () => {
    const session = createStartedSession({ name: 'Codex Switch Then Fire', model: GPT_MODEL, providerId: openaiProvider.id });
    sessions.update(session.id, {
      pendingModel: GPT_MODEL,
      scheduledAt: Date.now() - 1000,
      pendingPrompt: 'scheduled follow-up',
      pendingInteractive: false,
      status: 'scheduled',
    });

    // Picker switch to kind-Y (the fix point: this must drop the kind-X
    // pendingModel override while keeping the schedule itself).
    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL })
      .expect(200);

    const scheduler = new SchedulerService();
    const stubManager = {
      runSession: vi.fn().mockResolvedValue({ started: true, sessionId: session.id }),
      continueSession: vi.fn().mockResolvedValue({ started: true, sessionId: session.id }),
      continueSessionWithExistingMessage: vi.fn().mockResolvedValue({ started: true, sessionId: session.id }),
    };
    scheduler.initialize(stubManager);

    const result = await scheduler.startScheduledSession({ id: session.id });
    expect(result).toEqual({ claimed: true });

    // System schedule on a session with prior assistant turns takes the
    // continuation path with the post-switch model state: no stranded
    // kind-X model on a kind-Y row, no silent switch-back.
    expect(stubManager.continueSession).toHaveBeenCalledTimes(1);
    expect(stubManager.continueSession).toHaveBeenCalledWith(
      session.id,
      'scheduled follow-up',
      expect.anything(),
      expect.objectContaining({ model: null, interactive: false }),
    );

    const row = sessions.getById(session.id);
    expect(row.model).toBe(CLAUDE_MODEL);
    expect(row.agentType).toBe('claude-code');
    expect(row.pendingModel).toBeNull();
    expect(resolveAgentTypeFromModel(row.model)).toBe(row.agentType);
  });

  it('POST /schedule with in-scope cross-kind model on a started session still 400s (FR9 pin)', async () => {
    const session = createStartedSession({ name: 'Codex Sched Started', model: GPT_MODEL, providerId: openaiProvider.id });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'scheduled follow-up',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        model: CLAUDE_MODEL,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(GPT_MODEL);
    expect(unchanged.pendingModel).not.toBe(CLAUDE_MODEL);
  });
});
