import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, modelProviders, messages, modelTiers } from '../database.js';
import { buildTierRef } from '@circuschief/shared';

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

  describe('Model Tier bindings (remediation Work Items 1 & 2)', () => {
    let gptFirstTier;
    let claudeFirstTier;
    let emptyTier;

    beforeEach(() => {
      gptFirstTier = modelTiers.create({
        name: 'PATCH Drift GPT-first Tier',
        members: [{ providerId: openaiProvider.id, modelId: OPENAI_MODEL, position: 0 }],
      });
      claudeFirstTier = modelTiers.create({
        name: 'PATCH Drift Claude-first Tier',
        members: [{ providerId: anthropicProvider.id, modelId: CLAUDE_SONNET, position: 0 }],
      });
      emptyTier = modelTiers.create({ name: 'PATCH Drift Empty Tier', members: [] });
    });

    afterEach(() => {
      try { modelTiers.delete(gptFirstTier.id); } catch { /* noop */ }
      try { modelTiers.delete(claudeFirstTier.id); } catch { /* noop */ }
      try { modelTiers.delete(emptyTier.id); } catch { /* noop */ }
    });

    it('re-derives agentType to "codex" when a waiting Claude session PATCHes to a Codex-first tier', async () => {
      const session = sessions.create(project.id, 'Claude to Tier Session', 'Initial prompt', {
        model: CLAUDE_SONNET,
        providerId: anthropicProvider.id,
        status: 'waiting',
      });
      expect(sessions.getById(session.id).agentType).toBe('claude-code');

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: buildTierRef(gptFirstTier.id) });

      expect(res.status).toBe(200);
      const updated = sessions.getById(session.id);
      expect(updated.model).toBe(buildTierRef(gptFirstTier.id));
      expect(updated.agentType).toBe('codex');
      // The tier's concrete provider is resolved per-run, not persisted here.
      expect(updated.providerId).toBeNull();
    });

    it('normalizes a stray concrete providerId to null when PATCHing to a tier ref', async () => {
      const session = createWaitingCodexSession();

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: buildTierRef(claudeFirstTier.id), providerId: anthropicProvider.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('providerId must be null when model is a tier reference');
    });

    it('allows a started Claude session to PATCH to a Claude-first tier (same kind)', async () => {
      const session = sessions.create(project.id, 'Started Claude Tier Session', 'Initial prompt', {
        model: CLAUDE_SONNET,
        providerId: anthropicProvider.id,
        status: 'running',
      });
      messages.create(session.id, 'assistant', 'Hello, I am Claude.');

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: buildTierRef(claudeFirstTier.id) });

      expect(res.status).toBe(200);
      expect(sessions.getById(session.id).model).toBe(buildTierRef(claudeFirstTier.id));
      expect(sessions.getById(session.id).agentType).toBe('claude-code');
    });

    it('rejects a started Claude session PATCHing to a Codex-first tier (CROSS_KIND_MODEL_SWITCH)', async () => {
      const session = sessions.create(project.id, 'Started Claude Cross-tier Session', 'Initial prompt', {
        model: CLAUDE_SONNET,
        providerId: anthropicProvider.id,
        status: 'running',
      });
      messages.create(session.id, 'assistant', 'Hello, I am Claude.');

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: buildTierRef(gptFirstTier.id) });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

      const unchanged = sessions.getById(session.id);
      expect(unchanged.model).toBe(CLAUDE_SONNET);
      expect(unchanged.agentType).toBe('claude-code');
    });

    it('rejects a PATCH model update naming a tier with no resolvable members', async () => {
      const session = sessions.create(project.id, 'Empty Tier PATCH Session', 'Initial prompt', {
        model: CLAUDE_SONNET,
        providerId: anthropicProvider.id,
        status: 'waiting',
      });

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: buildTierRef(emptyTier.id) });

      expect(res.status).toBe(400);
    });
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

// ── Explicit provider pairs (finding 7) ──────────────────────────────────────
// PATCH and schedule validation must check the EXPLICIT (model, providerId)
// pair the caller selected — not whichever owner a model-id lookup prefers.
// The same model id is registered under providers of different agent kinds,
// so lookup order alone cannot decide compatibility.
describe('Explicit provider pairs on PATCH (finding 7)', () => {
  let app;
  let project;
  let claudeProviderA;
  let claudeProviderB;
  let codexProvider;

  const SHARED_MODEL = 'shared-pair-model';
  const CODEX_ONLY_MODEL = 'codex-only-pair-model';
  const CLAUDE_MODEL = 'claude-pair-model';

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Pair Drift Project', '/tmp/pair-drift');

    claudeProviderA = modelProviders.create({ name: 'Claude Pair A', kind: 'anthropic' });
    claudeProviderB = modelProviders.create({ name: 'Claude Pair B', kind: 'anthropic' });
    codexProvider = modelProviders.create({ name: 'Codex Pair', kind: 'openai' });
    for (const provider of [claudeProviderA, claudeProviderB, codexProvider]) {
      modelProviders.addModel(provider.id, { modelId: SHARED_MODEL, displayName: 'Shared' });
    }
    modelProviders.addModel(codexProvider.id, { modelId: CODEX_ONLY_MODEL, displayName: 'Codex Only' });
    modelProviders.addModel(claudeProviderA.id, { modelId: CLAUDE_MODEL, displayName: 'Claude' });
  });

  afterEach(() => {
    for (const provider of [claudeProviderA, claudeProviderB, codexProvider]) {
      try { modelProviders.delete(provider.id); } catch { /* noop */ }
    }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  function createEstablishedClaudeSession() {
    const session = sessions.create(project.id, 'Established Pair Session', 'Initial prompt', {
      model: SHARED_MODEL,
      providerId: claudeProviderA.id,
      status: 'waiting',
    });
    sessions.update(session.id, { agentType: 'claude-code' });
    messages.create(session.id, 'assistant', 'Prior answer.');
    return sessions.getById(session.id);
  }

  it('accepts a compatible explicit pair regardless of catalog order', async () => {
    const session = createEstablishedClaudeSession();

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: SHARED_MODEL, providerId: claudeProviderB.id })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(SHARED_MODEL);
    expect(updated.providerId).toBe(claudeProviderB.id);
    expect(updated.agentType).toBe('claude-code');
  });

  it('rejects an incompatible explicit pair regardless of catalog order, leaving the record unchanged', async () => {
    const session = createEstablishedClaudeSession();

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: SHARED_MODEL, providerId: codexProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(SHARED_MODEL);
    expect(unchanged.providerId).toBe(claudeProviderA.id);
    expect(unchanged.agentType).toBe('claude-code');
  });

  it('rejects a provider-only switch to an incompatible owner', async () => {
    const session = createEstablishedClaudeSession();

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ providerId: codexProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(SHARED_MODEL);
    expect(unchanged.providerId).toBe(claudeProviderA.id);
  });

  it('rejects when either of two changed pairs is incompatible, committing neither', async () => {
    const session = createEstablishedClaudeSession();

    // Current pair is cross-kind; the pending pair alone is valid. The valid
    // pending selection must not hide the incompatible current change.
    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({
        model: SHARED_MODEL,
        providerId: codexProvider.id,
        pendingModel: CLAUDE_MODEL,
        pendingProviderId: claudeProviderA.id,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(SHARED_MODEL);
    expect(unchanged.providerId).toBe(claudeProviderA.id);
    expect(unchanged.pendingModel ?? null).toBe(null);
    expect(unchanged.agentType).toBe('claude-code');
  });

  it('rejects an incompatible pending pair while leaving the current binding untouched', async () => {
    const session = createEstablishedClaudeSession();

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: CODEX_ONLY_MODEL, pendingProviderId: codexProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(SHARED_MODEL);
    expect(unchanged.providerId).toBe(claudeProviderA.id);
    expect(unchanged.pendingModel ?? null).toBe(null);
  });

  it('derives a draft’s agent kind from its current binding, not a pending selection', async () => {
    const session = sessions.create(project.id, 'Draft Pair Session', 'Initial prompt', {
      model: SHARED_MODEL,
      providerId: claudeProviderA.id,
      status: 'waiting',
    });

    // Drafts stay mutable: a pending-only change is accepted, but it must
    // never redefine the draft's present identity.
    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: CODEX_ONLY_MODEL, pendingProviderId: codexProvider.id })
      .expect(200);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(SHARED_MODEL);
    expect(row.pendingModel).toBe(CODEX_ONLY_MODEL);
    expect(row.agentType).toBe('claude-code');
  });
});

// ── PATCH binding snapshot reconciliation (finding 1) ────────────────────────
// Changing the session's model binding through PATCH must atomically
// reconcile the tier snapshot: a newly selected tier commits its resolved
// candidate, leaving a tier clears both snapshot fields, and an unchanged
// binding preserves its snapshot. Otherwise a follow-up echoing the new tier
// reuses the previous tier's member as if it were the new tier's snapshot.
describe('PATCH binding snapshot reconciliation (finding 1)', () => {
  let app;
  let project;
  let provider;

  const MODEL_A = 'snapshot-model-a';
  const MODEL_B = 'snapshot-model-b';
  const MODEL_C = 'snapshot-model-c';

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Snapshot Project', '/tmp/snapshot-test');
    provider = modelProviders.create({ name: 'Snapshot Provider', kind: 'anthropic' });
    for (const modelId of [MODEL_A, MODEL_B, MODEL_C]) {
      modelProviders.addModel(provider.id, { modelId, displayName: modelId });
    }
  });

  afterEach(() => {
    try { modelProviders.delete(provider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  function createTier(name, modelId) {
    const tier = modelTiers.create({
      name,
      members: [{ providerId: provider.id, modelId, position: 0 }],
    });
    return buildTierRef(tier.id);
  }

  function createEstablishedTierSession(tierRef, resolved) {
    const session = sessions.create(project.id, 'Snapshot Session', 'Initial prompt', {
      model: tierRef,
      providerId: null,
      status: 'waiting',
    });
    sessions.update(session.id, {
      agentType: 'claude-code', resolvedModel: resolved, resolvedProviderId: provider.id,
    });
    messages.create(session.id, 'assistant', 'Prior answer.');
    return sessions.getById(session.id);
  }

  it('replaces the snapshot when the binding moves to a different tier', async () => {
    const highRef = createTier('Snapshot High', MODEL_A);
    const lowRef = createTier('Snapshot Low', MODEL_B);
    const session = createEstablishedTierSession(highRef, MODEL_A);

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: lowRef })
      .expect(200);

    // The reconciled snapshot is committed atomically and returned.
    expect(res.body.model).toBe(lowRef);
    expect(res.body.resolvedModel).toBe(MODEL_B);
    expect(res.body.resolvedProviderId).toBe(provider.id);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(lowRef);
    expect(row.resolvedModel).toBe(MODEL_B);
    expect(row.resolvedProviderId).toBe(provider.id);
  });

  it('clears both snapshot fields when leaving a tier for a concrete model', async () => {
    const highRef = createTier('Snapshot High Concrete', MODEL_A);
    const session = createEstablishedTierSession(highRef, MODEL_A);

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: MODEL_C, providerId: provider.id })
      .expect(200);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(MODEL_C);
    expect(row.resolvedModel ?? null).toBe(null);
    expect(row.resolvedProviderId ?? null).toBe(null);
  });

  it('clears both snapshot fields when the selection is cleared', async () => {
    const highRef = createTier('Snapshot High Clear', MODEL_A);
    const session = createEstablishedTierSession(highRef, MODEL_A);

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: null })
      .expect(200);

    const row = sessions.getById(session.id);
    expect(row.model ?? null).toBe(null);
    expect(row.resolvedModel ?? null).toBe(null);
    expect(row.resolvedProviderId ?? null).toBe(null);
  });

  it('preserves the snapshot for an unchanged binding', async () => {
    const highRef = createTier('Snapshot High Same', MODEL_A);
    const session = createEstablishedTierSession(highRef, MODEL_A);

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: highRef })
      .expect(200);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(highRef);
    expect(row.resolvedModel).toBe(MODEL_A);
    expect(row.resolvedProviderId).toBe(provider.id);
  });

  it('leaves binding and snapshot unchanged when the new tier is unavailable', async () => {
    const highRef = createTier('Snapshot High Stale', MODEL_A);
    const session = createEstablishedTierSession(highRef, MODEL_A);
    const emptyTier = modelTiers.create({ name: 'Snapshot Empty Tier' });

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: buildTierRef(emptyTier.id) });
    expect(res.status).toBe(400);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(highRef);
    expect(row.resolvedModel).toBe(MODEL_A);
    expect(row.resolvedProviderId).toBe(provider.id);
    modelTiers.delete(emptyTier.id);
  });

  it('does not disturb the current snapshot on pending-only changes', async () => {
    const highRef = createTier('Snapshot High Pending', MODEL_A);
    const session = createEstablishedTierSession(highRef, MODEL_A);

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ pendingModel: MODEL_C, pendingProviderId: provider.id })
      .expect(200);

    const row = sessions.getById(session.id);
    expect(row.model).toBe(highRef);
    expect(row.resolvedModel).toBe(MODEL_A);
    expect(row.resolvedProviderId).toBe(provider.id);
    expect(row.pendingModel).toBe(MODEL_C);
  });
});
