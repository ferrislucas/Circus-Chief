/**
 * Tests for sessionContinuation.js, specifically the tier-ref resolution on
 * the continue path (Fix 1).
 *
 * The critical invariant: when a session's stored model is a tier ref AND no
 * explicit model is passed on the continue call, the concrete resolved model
 * (from session.resolvedModel snapshot or a live tier lookup) must be forwarded
 * to buildQueryParams — never the raw `tier::<id>` sentinel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projects, sessions, messages, conversations, modelTiers, modelProviders } from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { clearUnhealthy, markUnhealthy } from './tierResolutionService.js';

// ── WebSocket mock ────────────────────────────────────────────────────────────
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// ── Agent execution mock ─────────────────────────────────────────────────────
// Capture the queryParams that continueSessionCore passes to _executeSession.
let capturedQueryParams = [];
// Capture the tierContext (health attribution vs failover authorization) that
// continueSessionCore hands to _executeSession.
let capturedTierContexts = [];
// Capture the agentType each call to createAgentForSession was made with, so
// tests can assert the agent adapter is created from the RECONCILED agentType
// (Work Item 4), not a stale pre-reconciliation value.
let capturedAgentTypes = [];
// Capture the logging metadata handed to _executeSession alongside the query
// params, so tests can assert the logged model is the resolved member —
// never the raw caller override (Issue #25).
let capturedAgentCallMetas = [];
const workflowMock = vi.hoisted(() => ({ laneRunOwnsSession: true }));

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    _executeSession: vi.fn(async ({ queryParams, tierContext, agentCallMeta }) => {
      capturedQueryParams.push(queryParams);
      capturedTierContexts.push(tierContext ?? null);
      capturedAgentCallMetas.push(agentCallMeta ?? null);
    }),
    createAgentForSession: vi.fn((agentType) => {
      capturedAgentTypes.push(agentType);
      return {
        needsConversationContext: () => false,
        supportsResume: () => false,
      };
    }),
    buildAgentEnv: vi.fn((env) => env),
  };
});

vi.mock('./sessionErrors.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    shouldRescheduleOnError: vi.fn(() => false),
  };
});

vi.mock('./schedulerService.js', () => ({
  schedulerService: { scheduleSession: vi.fn() },
}));

vi.mock('./gitService.js', () => ({
  ensureWorktreeCommitAttributionHook: vi.fn(),
}));

vi.mock('./summaryService.js', () => ({
  generateSummaryIfNeeded: vi.fn(),
}));

vi.mock('./hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

vi.mock('./streamEventHandler.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    broadcastSessionStatus: vi.fn(),
  };
});

vi.mock('./workflowSessionService.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    activeLaneRunOwnsSession: vi.fn(() => workflowMock.laneRunOwnsSession),
  };
});

import { continueSessionCore } from './sessionContinuation.js';
import { activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';
import { activeSessions } from './sessionExecutionOwnership.js';
import { broadcastToSession } from '../websocket.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const noop = vi.fn();
const mockCallbacks = {
  handleTemplateTriggerIfNeeded: noop,
  handleAutoSendIfNeeded: noop,
};

function createTestSession(project, overrides = {}) {
  const session = sessions.create(project.id, 'Test session', 'Initial prompt', 'standard');
  sessions.update(session.id, { status: 'waiting', ...overrides });
  return sessions.getById(session.id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('sessionContinuation — tier ref resolution on continue (Fix 1)', () => {
  let project;
  let providerA;

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    capturedAgentCallMetas = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();

    project = projects.create('Tier Test Project', '/tmp/tier-continue-test');
    providerA = modelProviders.create({ name: 'Provider A', kind: 'anthropic' });
    // Register the model ids referenced by tier members below so the
    // model-existence filter in getTierMembersResolved (Issue 3) doesn't
    // treat them as orphaned/deleted models.
    modelProviders.addModel(providerA.id, { modelId: 'claude-opus-4-6', displayName: 'Opus' });
    modelProviders.addModel(providerA.id, { modelId: 'claude-sonnet-5', displayName: 'Sonnet' });
    modelProviders.addModel(providerA.id, { modelId: 'model-x', displayName: 'Model X' });
  });

  it('rejects a non-interactive continuation that lost lane-run ownership before mutating session state', async () => {
    const session = createTestSession(project, { laneRunId: 'superseded-run' });
    const messagesBefore = messages.getBySessionId(session.id);
    workflowMock.laneRunOwnsSession = false;

    const result = await continueSessionCore(session.id, 'Stale automated continuation', '/tmp/test', {
      options: { interactive: false }, callbacks: mockCallbacks,
    });

    expect(result).toEqual({
      started: false,
      sessionId: session.id,
      reason: 'lane_run_ownership_lost',
    });
    expect(activeSessions.has(session.id)).toBe(false);
    expect(messages.getBySessionId(session.id)).toEqual(messagesBefore);
    expect(sessions.getById(session.id).status).toBe('waiting');
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastSessionStatus).not.toHaveBeenCalled();
    expect(capturedQueryParams).toHaveLength(0);
  });

  it('uses resolvedModel snapshot when session.model is a tier ref and no model is passed', async () => {
    const tier = modelTiers.create({
      name: 'High',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    // Simulate a session that started on a tier and succeeded on the first member
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Follow-up turn',
      '/tmp/tier-continue-test',
      { options: {}, callbacks: mockCallbacks }
    );

    // The agent must receive the concrete model, not the tier sentinel
    expect(capturedQueryParams.length).toBeGreaterThan(0);
    const qp = capturedQueryParams[0];
    expect(qp.options?.model).toBe('claude-opus-4-6');
    expect(qp.options?.model).not.toContain('tier::');
  });

  it('passes a sanitized env to the agent for a pinned Official Anthropic tier continuation (finding 1)', async () => {
    const tier = modelTiers.create({
      name: 'Official',
      members: [{ providerId: 'anthropic-default', modelId: 'claude-opus-5', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    // Simulate a session pinned to an Official Anthropic tier member
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'claude-opus-5',
      resolvedProviderId: 'anthropic-default',
    });
    conversations.ensureActiveConversation(session.id);

    const saved = {};
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) {
      saved[key] = process.env[key];
      process.env[key] = `synthetic-finding1-continue-${key}`;
    }
    try {
      await continueSessionCore(
        session.id,
        'Follow-up turn',
        '/tmp/tier-continue-test',
        { options: {}, callbacks: mockCallbacks }
      );
    } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }

    expect(capturedQueryParams.length).toBeGreaterThan(0);
    const qp = capturedQueryParams[0];
    expect(qp.options?.model).toBe('claude-opus-5');
    expect(qp.options?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(qp.options?.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(qp.options?.env?.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('falls back to live tier resolution when resolvedModel snapshot is absent', async () => {
    const tier = modelTiers.create({
      name: 'Mid',
      members: [{ providerId: providerA.id, modelId: 'claude-sonnet-5', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    // No resolvedModel — as if this is a legacy row that never had a snapshot
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: null,
      resolvedProviderId: null,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Follow-up turn',
      '/tmp/tier-continue-test',
      { options: {}, callbacks: mockCallbacks }
    );

    expect(capturedQueryParams.length).toBeGreaterThan(0);
    const qp = capturedQueryParams[0];
    expect(qp.options?.model).toBe('claude-sonnet-5');
    expect(qp.options?.model).not.toContain('tier::');
  });

  it('continues structurally when resolvedModel is absent and all tier members are in cooldown', async () => {
    const tier = modelTiers.create({
      name: 'Cooled',
      members: [{ providerId: providerA.id, modelId: 'model-x', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);
    markUnhealthy(providerA.id, 'model-x', 60_000);

    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: null,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(session.id, 'hi', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams[0].options?.model).toBe('model-x');

    // Clean up cooldown for subsequent tests
    clearUnhealthy(providerA.id, 'model-x');
  });

  // PRD E3 / D6 — the tier is deleted (or emptied) while the session is bound
  // to it. The follow-up must degrade to the last active concrete model (or
  // the server default when no snapshot exists), never throw, and never send
  // the raw `tier::<id>` sentinel to the adapter.
  describe('stale tier binding on continue (PRD E3 / D6)', () => {
    it('continues on the snapshot model when the bound tier was deleted', async () => {
      const tier = modelTiers.create({
        name: 'Doomed',
        members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const session = createTestSession(project, {
        model: tierRef,
        resolvedModel: 'claude-opus-4-6',
        resolvedProviderId: providerA.id,
        status: 'waiting',
      });
      conversations.ensureActiveConversation(session.id);

      modelTiers.delete(tier.id);

      await continueSessionCore(
        session.id,
        'Follow-up after deletion',
        '/tmp/tier-continue-test',
        { options: {}, callbacks: mockCallbacks }
      );

      const qp = capturedQueryParams[0];
      expect(qp.options?.model).toBe('claude-opus-4-6');
      expect(qp.options?.model).not.toContain('tier::');

      // The stale binding was degraded to the concrete snapshot (matching the
      // start path), so future turns are unambiguous.
      const updated = sessions.getById(session.id);
      expect(updated.model).toBe('claude-opus-4-6');
      expect(updated.providerId).toBe(providerA.id);
    });

    it('degrades to the server default when the tier was deleted before any snapshot existed', async () => {
      const tier = modelTiers.create({
        name: 'Never Ran',
        members: [{ providerId: providerA.id, modelId: 'claude-sonnet-5', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const session = createTestSession(project, {
        model: tierRef,
        resolvedModel: null,
        resolvedProviderId: null,
        status: 'waiting',
      });
      conversations.ensureActiveConversation(session.id);

      modelTiers.delete(tier.id);

      await continueSessionCore(
        session.id,
        'Follow-up after deletion',
        '/tmp/tier-continue-test',
        { options: {}, callbacks: mockCallbacks }
      );

      // Server default = null model (the adapter/SDK resolves its own default);
      // the sentinel must never be forwarded.
      const qp = capturedQueryParams[0];
      expect(qp.options?.model ?? null).toBeNull();
      expect(sessions.getById(session.id).model ?? null).toBeNull();
    });

    it('continues without clearing the binding when all members are merely in cooldown', async () => {
      const tier = modelTiers.create({
        name: 'Cooldown Only',
        members: [{ providerId: providerA.id, modelId: 'model-x', position: 0 }],
      });
      const tierRef = buildTierRef(tier.id);
      const session = createTestSession(project, {
        model: tierRef,
        resolvedModel: null,
        resolvedProviderId: null,
        status: 'waiting',
      });
      conversations.ensureActiveConversation(session.id);
      markUnhealthy(providerA.id, 'model-x', 60_000);

      await continueSessionCore(session.id, 'hi', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });

      expect(capturedQueryParams[0].options?.model).toBe('model-x');
      expect(sessions.getById(session.id).model).toBe(tierRef);
      clearUnhealthy(providerA.id, 'model-x');
    });
  });

  it('does NOT overwrite session.model with the concrete model after continue', async () => {
    const tier = modelTiers.create({
      name: 'Persist',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Follow-up',
      '/tmp/tier-continue-test',
      { options: {}, callbacks: mockCallbacks }
    );

    // The tier ref must be preserved on the session (not replaced by concrete model)
    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(tierRef);
  });

  // A session with no stored model adopting the caller's concrete model is
  // initialization, not a switch. Lane on-enter workers are created model-less
  // and the web client echoes a resolved picker default on every follow-up —
  // treating that as modelChanged prefixes conversation history onto the
  // prompt (changing the VCR cassette key so replay misses) and drops resume.
  // Regression: kanban-lane-run-structured "graceful provider limit" follow-up
  // errored with `VCR replay: no cassette found` and the card never advanced.
  it('a model-less session adopting the caller model keeps the bare prompt (no history prefix)', async () => {
    const session = createTestSession(project);
    expect(session.model).toBeNull();
    const conv = conversations.ensureActiveConversation(session.id);
    // A prior turn, so a (buggy) model-switch prefix would be non-empty.
    messages.create(session.id, 'user', 'First turn', { conversationId: conv.id });
    messages.create(session.id, 'assistant', 'First reply', { conversationId: conv.id });

    await continueSessionCore(
      session.id,
      'Follow-up turn',
      '/tmp/tier-continue-test',
      { options: { model: 'claude-sonnet-5', interactive: true }, callbacks: mockCallbacks }
    );

    expect(capturedQueryParams.length).toBeGreaterThan(0);
    expect(capturedQueryParams[0].prompt).toBe('Follow-up turn');
  });

  // Fix 2: an explicit tier ref passed as the requested `model` (e.g. the live
  // chat picker switching tiers mid-conversation) must resolve THAT tier live
  // — never forward the raw `tier::<id>` sentinel to the adapter, and never
  // reuse a snapshot captured for a different, previously-bound tier.
  it('resolves an explicitly-requested tier switch live, never sending the raw tier:: sentinel', async () => {
    const tierA = modelTiers.create({
      name: 'Tier A',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });
    const tierB = modelTiers.create({
      name: 'Tier B',
      members: [{ providerId: providerA.id, modelId: 'claude-sonnet-5', position: 0 }],
    });
    const tierARef = buildTierRef(tierA.id);
    const tierBRef = buildTierRef(tierB.id);

    const session = createTestSession(project, {
      model: tierARef,
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Switch to tier B',
      '/tmp/tier-continue-test',
      { options: { model: tierBRef }, callbacks: mockCallbacks }
    );

    expect(capturedQueryParams.length).toBeGreaterThan(0);
    const qp = capturedQueryParams[0];
    // Must reach the adapter as tier B's concrete member, not tier A's stale
    // snapshot and never the raw tier sentinel.
    expect(qp.options?.model).toBe('claude-sonnet-5');
    expect(qp.options?.model).not.toContain('tier::');

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(tierBRef);
    expect(updated.resolvedModel).toBe('claude-sonnet-5');
    expect(updated.resolvedProviderId).toBe(providerA.id);
  });

  // Issue #25: call metadata must log the resolved member, not the raw
  // override — otherwise call history shows tier sentinels (or null) for
  // turns that actually dispatched a concrete member model.
  it('logs the resolved member (not the raw tier override) in continuation call metadata', async () => {
    const tierA = modelTiers.create({
      name: 'Meta Tier A',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });
    const tierB = modelTiers.create({
      name: 'Meta Tier B',
      members: [{ providerId: providerA.id, modelId: 'claude-sonnet-5', position: 0 }],
    });
    const tierARef = buildTierRef(tierA.id);
    const tierBRef = buildTierRef(tierB.id);

    const session = createTestSession(project, {
      model: tierARef,
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Switch to tier B',
      '/tmp/tier-continue-test',
      { options: { model: tierBRef }, callbacks: mockCallbacks }
    );

    expect(capturedAgentCallMetas.length).toBeGreaterThan(0);
    expect(capturedAgentCallMetas[0]).toMatchObject({ model: 'claude-sonnet-5' });
    expect(capturedAgentCallMetas[0].model).not.toContain('tier::');
  });

  it('logs the snapshot member (not null) when continuing a tier-bound session without an override', async () => {
    const tier = modelTiers.create({
      name: 'Meta Tier',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });

    const session = createTestSession(project, {
      model: buildTierRef(tier.id),
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Follow-up turn',
      '/tmp/tier-continue-test',
      { options: {}, callbacks: mockCallbacks }
    );

    expect(capturedAgentCallMetas.length).toBeGreaterThan(0);
    expect(capturedAgentCallMetas[0]).toMatchObject({ model: 'claude-opus-4-6' });
  });

  it('an explicit concrete-model override on a tier-bound session persists the concrete model and clears the resolved snapshot', async () => {
    const tier = modelTiers.create({
      name: 'High',
      members: [{ providerId: providerA.id, modelId: 'claude-opus-4-6', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'claude-opus-4-6',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'Pin to a concrete model',
      '/tmp/tier-continue-test',
      { options: { model: 'model-x' }, callbacks: mockCallbacks }
    );

    expect(capturedQueryParams.length).toBeGreaterThan(0);
    expect(capturedQueryParams[0].options?.model).toBe('model-x');

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe('model-x');
    expect(updated.resolvedModel).toBeNull();
    expect(updated.resolvedProviderId).toBeNull();
  });

  // Work Item 4: the agent adapter must be created from the RECONCILED
  // agentType, not the stale value on the session row at the top of the
  // function. A tier-bound draft session created with agentType left at its
  // (wrong) default must still dispatch through the Codex adapter once the
  // tier resolves to a Codex member.
  it('creates the agent from the reconciled agentType, not the stale pre-reconciliation value (Work Item 4)', async () => {
    const codexProvider = modelProviders.create({ name: 'Codex Provider', kind: 'openai' });
    modelProviders.addModel(codexProvider.id, { modelId: 'gpt-continue-test', displayName: 'GPT Continue Test' });

    const tier = modelTiers.create({
      name: 'Codex Continue Tier',
      members: [{ providerId: codexProvider.id, modelId: 'gpt-continue-test', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    // Simulate a stale row: agentType still 'claude-code' even though the
    // bound tier's only member is a Codex model (mirrors a draft session
    // created before its agentType was ever reconciled against the tier).
    const session = createTestSession(project, {
      model: tierRef,
      agentType: 'claude-code',
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(
      session.id,
      'First turn on a Codex-first tier',
      '/tmp/tier-continue-test',
      { options: {}, callbacks: mockCallbacks }
    );

    // The adapter must be created with 'codex' — never the stale 'claude-code'.
    expect(capturedAgentTypes).toContain('codex');
    expect(capturedAgentTypes).not.toContain('claude-code');

    // And the persisted session row must reflect the reconciled kind.
    expect(sessions.getById(session.id).agentType).toBe('codex');
  });
});

// ── Health attribution context on the continuation path ─────────────────────
//
// A tier-bound continuation stays PINNED to its concrete member (never fails
// over in place), but it must hand _executeSession a health-reporting tier
// context so an eligible failure during the continuation can cool that exact
// member down. The context carries health attribution ONLY — it must never
// authorize failover (that is start-path-only).
describe('sessionContinuation — tier health context (mid-conversation cooldown)', () => {
  let project;
  let providerA;
  let providerB;

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    vi.clearAllMocks();
    project = projects.create('Tier Health Project', '/tmp/tier-health-test');
    providerA = modelProviders.create({ name: 'Health Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Health Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'health-model-a', displayName: 'Health A' });
    modelProviders.addModel(providerB.id, { modelId: 'health-model-b', displayName: 'Health B' });
  });

  it('passes a health-reporting, non-failover tier context for a tier-bound continuation', async () => {
    const tier = modelTiers.create({
      name: 'Health Tier',
      members: [
        { providerId: providerA.id, modelId: 'health-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'health-model-b', position: 1 },
      ],
    });
    const tierRef = buildTierRef(tier.id);
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'health-model-a',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedTierContexts).toHaveLength(1);
    expect(capturedTierContexts[0]).toEqual({
      currentMemberId: 'health-model-a',
      currentMemberProviderId: providerA.id,
      allowFailover: false,
    });
  });

  it('passes NO tier context for a non-tier continuation', async () => {
    const session = createTestSession(project, {
      model: 'health-model-a',
      providerId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedTierContexts).toEqual([null]);
  });

  it('passes NO tier context when the snapshot no longer maps to a current tier member', async () => {
    const tier = modelTiers.create({
      name: 'Shrinking Tier',
      members: [
        { providerId: providerA.id, modelId: 'health-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'health-model-b', position: 1 },
      ],
    });
    const tierRef = buildTierRef(tier.id);
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: 'health-model-a',
      resolvedProviderId: providerA.id,
    });
    conversations.ensureActiveConversation(session.id);

    // Member A was removed from the tier after the snapshot was taken — the
    // snapshot cannot safely be attributed to the current tier membership.
    modelTiers.update(tier.id, {
      members: [{ providerId: providerB.id, modelId: 'health-model-b', position: 0 }],
    });

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedTierContexts).toEqual([null]);
  });

  it('passes NO tier context when the tier-bound row has no concrete snapshot and none can be backfilled', async () => {
    // An unresolvable-but-not-degenerate binding cannot establish member
    // identity — fail safe (no guess, no attribution) rather than marking an
    // unrelated member.
    const tier = modelTiers.create({ name: 'Empty Health Tier' });
    const tierRef = buildTierRef(tier.id);
    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: null,
      resolvedProviderId: null,
    });
    conversations.ensureActiveConversation(session.id);

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedTierContexts).toEqual([null]);
  });
});

// ── Preparation-failure cleanup (finding 4) ─────────────────────────────────
// Both continuation entry points register active state (ownership claim,
// running status, conversation id) BEFORE model/environment resolution. A
// failure in that preparation window must surface a sanitized visible error,
// move the session to error status, release the claim + conversation
// registration, and fail an owned lane obligation — never wedge the session
// as permanently running.
describe('sessionContinuation — preparation-failure cleanup (finding 4)', () => {
  let project;
  let provider;

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    capturedAgentCallMetas = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();
    activeConversationIds.clear();

    project = projects.create('Finding4 Project', '/tmp/finding4-test');
    provider = modelProviders.create({ name: 'Finding4 Provider', kind: 'anthropic' });
    modelProviders.addModel(provider.id, { modelId: 'finding4-model', displayName: 'F4' });
    modelProviders.addModel(provider.id, { modelId: 'finding4-model-2', displayName: 'F4B' });
  });

  function createCoolingTierRef() {
    const tier = modelTiers.create({
      name: 'All Cooling Tier',
      members: [
        { providerId: provider.id, modelId: 'finding4-model', position: 0 },
        { providerId: provider.id, modelId: 'finding4-model-2', position: 1 },
      ],
    });
    return buildTierRef(tier.id);
  }

  function coolEveryMember() {
    markUnhealthy(provider.id, 'finding4-model', 60_000);
    markUnhealthy(provider.id, 'finding4-model-2', 60_000);
  }

  function clearEveryCooldown() {
    clearUnhealthy(provider.id, 'finding4-model');
    clearUnhealthy(provider.id, 'finding4-model-2');
  }

  it('releases claim, flags error status, and dispatches nothing when a newly selected tier has every member cooling down', async () => {
    const tierRef = createCoolingTierRef();
    await coolEveryMember();
    try {
      const session = createTestSession(project, { model: 'finding4-model', providerId: provider.id });
      conversations.ensureActiveConversation(session.id);

      await expect(continueSessionCore(session.id, 'Switch to cooling tier', '/tmp/test', {
        options: { model: tierRef }, callbacks: mockCallbacks,
      })).rejects.toThrow(/currently healthy/);

      // No provider dispatch happened.
      expect(capturedQueryParams).toHaveLength(0);

      // Sanitized visible error + error status.
      const row = sessions.getById(session.id);
      expect(row.status).toBe('error');
      expect(row.error).toMatch(/currently healthy/);

      // Active state fully released.
      expect(activeSessions.has(session.id)).toBe(false);
      expect(activeConversationIds.has(session.id)).toBe(false);
      expect(broadcastSessionStatus).toHaveBeenCalledWith(session.id, 'error');
    } finally {
      await clearEveryCooldown();
    }
  });

  it('admits a subsequent valid continuation after a preparation failure', async () => {
    const tierRef = createCoolingTierRef();
    await coolEveryMember();
    const session = createTestSession(project, { model: 'finding4-model', providerId: provider.id });
    conversations.ensureActiveConversation(session.id);

    await expect(continueSessionCore(session.id, 'Switch to cooling tier', '/tmp/test', {
      options: { model: tierRef }, callbacks: mockCallbacks,
    })).rejects.toThrow(/currently healthy/);
    expect(activeSessions.has(session.id)).toBe(false);

    await clearEveryCooldown();
    await continueSessionCore(session.id, 'Retry on recovered tier', '/tmp/test', {
      options: { model: tierRef }, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    expect(capturedQueryParams[0].options?.model).toBe('finding4-model');
  });

  it('sanitizes a credential-bearing setup failure and releases all active state', async () => {
    const session = createTestSession(project, { model: 'finding4-model', providerId: provider.id });
    const secret = 'sk-ant-finding4secret123';
    // NOTE: ensureActiveConversation is synchronous (better-sqlite3), so the
    // setup failure must be a synchronous throw — an async rejection would be
    // kept as a (truthy) promise value and silently ignored.
    const ensureSpy = vi.spyOn(conversations, 'ensureActiveConversation')
      .mockImplementationOnce(() => {
        throw new Error(`provider exploded with key ${secret}`);
      });
    try {
      await expect(continueSessionCore(session.id, 'hi', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      })).rejects.toThrow('provider exploded');

      expect(ensureSpy).toHaveBeenCalledTimes(1);
      expect(capturedQueryParams).toHaveLength(0);
      const row = sessions.getById(session.id);
      expect(row.status).toBe('error');
      expect(row.error).not.toContain(secret);
      expect(row.error).toMatch(/provider exploded/);
      expect(activeSessions.has(session.id)).toBe(false);
      expect(activeConversationIds.has(session.id)).toBe(false);
    } finally {
      ensureSpy.mockRestore();
    }
  });

  it('preserves stopped state when the turn is stop-aborted during preparation', async () => {
    const { abortForUserStop } = await import('./sessionAbort.js');
    const { ensureWorktreeCommitAttributionHook } = await import('./gitService.js');
    // The worktree hook is the only awaited preparation step, so it is the
    // suspension point where a concurrent stop can land mid-preparation.
    const hookedProvider = modelProviders.create({
      name: 'Finding4 Hooked Provider',
      kind: 'anthropic',
      commitAttributionOverride: 'Co-authored-by: Test <test@example.com>',
    });
    modelProviders.addModel(hookedProvider.id, { modelId: 'finding4-hooked', displayName: 'F4H' });
    const session = createTestSession(project, { model: 'finding4-hooked', providerId: hookedProvider.id });
    sessions.update(session.id, { gitWorktree: '/tmp/finding4-test' });
    conversations.ensureActiveConversation(session.id);

    let releaseHook;
    const hookGate = new Promise((resolve) => { releaseHook = resolve; });
    ensureWorktreeCommitAttributionHook.mockImplementationOnce(async () => {
      await hookGate;
      throw new Error('hook failed after stop');
    });
    try {
      const pending = continueSessionCore(session.id, 'hi', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });
      // Wait until the turn has claimed ownership, then simulate stopSession
      // aborting this exact turn while preparation is still in flight.
      for (let i = 0; i < 200 && !activeSessions.has(session.id); i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
      }
      expect(activeSessions.has(session.id)).toBe(true);
      abortForUserStop(activeSessions.get(session.id).controller);
      releaseHook();

      await expect(pending).rejects.toThrow('hook failed after stop');

      // A user stop is not a permanent error: the stopped state must survive.
      const row = sessions.getById(session.id);
      expect(row.status).not.toBe('error');
      expect(row.error ?? null).toBe(null);
      expect(activeSessions.has(session.id)).toBe(false);
      expect(activeConversationIds.has(session.id)).toBe(false);
    } finally {
      ensureWorktreeCommitAttributionHook.mockReset();
    }
  });

  it('does not clear a newer turn’s active state when an older turn’s preparation fails', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    const { ensureWorktreeCommitAttributionHook } = await import('./gitService.js');
    const hookedProvider = modelProviders.create({
      name: 'Finding4 Fence Provider',
      kind: 'anthropic',
      commitAttributionOverride: 'Co-authored-by: Test <test@example.com>',
    });
    modelProviders.addModel(hookedProvider.id, { modelId: 'finding4-fenced', displayName: 'F4F' });
    const session = createTestSession(project, { model: 'finding4-fenced', providerId: hookedProvider.id });
    sessions.update(session.id, { gitWorktree: '/tmp/finding4-test' });
    conversations.ensureActiveConversation(session.id);

    // Fail AFTER the hook suspension point so the test can install a newer
    // controller before the older turn's cleanup runs. A naive cleanup that
    // clears unconditionally would erase the replacement and fail this test.
    mockedCreateAgent.mockImplementationOnce(() => {
      throw new Error('agent factory blew up');
    });
    let releaseHook;
    const hookGate = new Promise((resolve) => { releaseHook = resolve; });
    ensureWorktreeCommitAttributionHook.mockImplementationOnce(async () => {
      await hookGate;
    });
    try {
      const pending = continueSessionCore(session.id, 'hi', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });
      for (let i = 0; i < 200 && !activeSessions.has(session.id); i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
      }
      expect(activeSessions.has(session.id)).toBe(true);

      // A newer turn claims the session while the older preparation waits.
      const newerController = new AbortController();
      activeSessions.set(session.id, {
        controller: newerController, turnStartedAt: Date.now(), lastEventAt: Date.now(),
      });
      releaseHook();

      await expect(pending).rejects.toThrow('agent factory blew up');

      // The older turn's cleanup must not erase the replacement's entry.
      expect(activeSessions.get(session.id)?.controller).toBe(newerController);
      activeSessions.delete(session.id);
    } finally {
      ensureWorktreeCommitAttributionHook.mockReset();
    }
  });

  it('fails an owned lane obligation instead of stranding it when preparation fails', async () => {
    const tierRef = createCoolingTierRef();
    await coolEveryMember();
    try {
      const session = createTestSession(project, {
        model: 'finding4-model', providerId: provider.id, laneRunId: 'finding4-run',
      });
      conversations.ensureActiveConversation(session.id);

      await expect(continueSessionCore(session.id, 'Scheduled follow-up', '/tmp/test', {
        options: { model: tierRef }, callbacks: mockCallbacks,
      })).rejects.toThrow(/currently healthy/);

      const row = sessions.getById(session.id);
      expect(row.status).toBe('error');
      expect(row.ownWorkState).toBe('closed_failed');
      expect(activeSessions.has(session.id)).toBe(false);
    } finally {
      await clearEveryCooldown();
    }
  });
});

// ── Explicit-selection dispatch candidate (finding 2) ───────────────────────
// The cross-kind guard and the tier-switch dispatch must validate the SAME
// concrete pair: the first HEALTHY member. On an established Claude session,
// selecting a new tier ordered Claude → Codex while its Claude member cools
// must raise CROSS_KIND_MODEL_SWITCH before dispatch — with no provider call
// and no selection/snapshot mutation.
describe('sessionContinuation — explicit-selection dispatch candidate (finding 2)', () => {
  let project;
  let claudeProvider;
  let codexProvider;
  let claudeCodexTierRef;
  let codexClaudeTierRef;

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    capturedAgentCallMetas = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();
    activeConversationIds.clear();

    project = projects.create('Finding2 Project', '/tmp/finding2-test');
    claudeProvider = modelProviders.create({ name: 'Finding2 Claude', kind: 'anthropic' });
    modelProviders.addModel(claudeProvider.id, { modelId: 'finding2-claude', displayName: 'F2 Claude' });
    codexProvider = modelProviders.create({ name: 'Finding2 Codex', kind: 'openai' });
    modelProviders.addModel(codexProvider.id, { modelId: 'finding2-codex', displayName: 'F2 Codex' });

    const claudeFirst = modelTiers.create({
      name: 'Finding2 Claude-Codex Tier',
      members: [
        { providerId: claudeProvider.id, modelId: 'finding2-claude', position: 0 },
        { providerId: codexProvider.id, modelId: 'finding2-codex', position: 1 },
      ],
    });
    claudeCodexTierRef = buildTierRef(claudeFirst.id);
    const codexFirst = modelTiers.create({
      name: 'Finding2 Codex-Claude Tier',
      members: [
        { providerId: codexProvider.id, modelId: 'finding2-codex', position: 0 },
        { providerId: claudeProvider.id, modelId: 'finding2-claude', position: 1 },
      ],
    });
    codexClaudeTierRef = buildTierRef(codexFirst.id);
  });

  function coolClaude() {
    markUnhealthy(claudeProvider.id, 'finding2-claude', 60_000);
  }

  function coolCodex() {
    markUnhealthy(codexProvider.id, 'finding2-codex', 60_000);
  }

  function clearCooldowns() {
    clearUnhealthy(claudeProvider.id, 'finding2-claude');
    clearUnhealthy(codexProvider.id, 'finding2-codex');
  }

  // An established session: it already produced assistant output, so its
  // agent kind is locked by the cross-kind guard.
  function createEstablishedSession(projectRow, overrides = {}) {
    const session = sessions.create(projectRow.id, 'Established session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting', ...overrides });
    const conversation = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'Hello', { conversationId: conversation.id });
    messages.create(session.id, 'assistant', 'Hi there', { conversationId: conversation.id });
    return sessions.getById(session.id);
  }

  it('rejects a new Claude→Codex tier whose Claude member is cooling down, with no dispatch or mutation', async () => {
    await coolClaude();
    try {
      const session = createEstablishedSession(project, {
        model: 'finding2-claude', providerId: claudeProvider.id, agentType: 'claude-code',
      });

      await expect(continueSessionCore(session.id, 'Switch tiers', '/tmp/test', {
        options: { model: claudeCodexTierRef }, callbacks: mockCallbacks,
      })).rejects.toThrow(/Cannot switch agent kind/);

      // No provider dispatch happened.
      expect(capturedQueryParams).toHaveLength(0);

      // No selection or snapshot mutation.
      const row = sessions.getById(session.id);
      expect(row.model).toBe('finding2-claude');
      expect(row.providerId).toBe(claudeProvider.id);
      expect(row.resolvedModel ?? null).toBe(null);
      expect(row.agentType).toBe('claude-code');

      // Preparation-failure cleanup still applies.
      expect(activeSessions.has(session.id)).toBe(false);
    } finally {
      await clearCooldowns();
    }
  });

  it('continues on the same-kind dispatch candidate for the inverse member order', async () => {
    await coolCodex();
    try {
      const session = createEstablishedSession(project, {
        model: 'finding2-claude', providerId: claudeProvider.id, agentType: 'claude-code',
      });

      await continueSessionCore(session.id, 'Switch tiers', '/tmp/test', {
        options: { model: codexClaudeTierRef }, callbacks: mockCallbacks,
      });

      expect(capturedQueryParams).toHaveLength(1);
      expect(capturedQueryParams[0].options?.model).toBe('finding2-claude');
      const row = sessions.getById(session.id);
      expect(row.model).toBe(codexClaudeTierRef);
      expect(row.resolvedModel).toBe('finding2-claude');
    } finally {
      await clearCooldowns();
    }
  });

  it('rejects a scheduled pending selection that would dispatch cross-kind', async () => {
    await coolClaude();
    try {
      const session = createEstablishedSession(project, {
        model: 'finding2-claude', providerId: claudeProvider.id, agentType: 'claude-code',
        pendingModel: claudeCodexTierRef, pendingProviderId: null,
      });

      // What the scheduler dispatches for an explicit pending selection.
      await expect(continueSessionCore(session.id, 'Scheduled follow-up', '/tmp/test', {
        options: { model: session.pendingModel, providerId: session.pendingProviderId },
        callbacks: mockCallbacks,
      })).rejects.toThrow(/Cannot switch agent kind/);

      expect(capturedQueryParams).toHaveLength(0);
      const row = sessions.getById(session.id);
      expect(row.model).toBe('finding2-claude');
      expect(activeSessions.has(session.id)).toBe(false);
    } finally {
      await clearCooldowns();
    }
  });

  it('dispatches the newly stored snapshot when a follow-up echoes a re-bound tier (finding 1)', async () => {
    // A session re-bound from tier High (member A) to tier Low (member B)
    // carries Low's snapshot; a follow-up echoing Low must dispatch B,
    // never the previous tier's member A.
    const lowTier = modelTiers.create({
      name: 'Finding1 Low Tier',
      members: [{ providerId: claudeProvider.id, modelId: 'finding2-claude', position: 0 }],
    });
    const lowRef = buildTierRef(lowTier.id);
    const session = createEstablishedSession(project, {
      model: lowRef, resolvedModel: 'finding2-claude', resolvedProviderId: claudeProvider.id,
      agentType: 'claude-code',
    });

    await continueSessionCore(session.id, 'Follow-up on Low', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    expect(capturedQueryParams[0].options?.model).toBe('finding2-claude');
    expect(capturedQueryParams[0].options?.model).not.toBe('finding2-codex');
  });

  it('preserves an unchanged valid tier snapshot even when its member is cooling down', async () => {
    const snapshotTier = modelTiers.create({
      name: 'Finding2 Snapshot Tier',
      members: [{ providerId: claudeProvider.id, modelId: 'finding2-claude', position: 0 }],
    });
    const snapshotRef = buildTierRef(snapshotTier.id);
    await coolClaude();
    try {
      const session = createEstablishedSession(project, {
        model: snapshotRef, resolvedModel: 'finding2-claude', resolvedProviderId: claudeProvider.id,
        agentType: 'claude-code',
      });

      await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });

      // Pinned continuations stay cooldown-independent.
      expect(capturedQueryParams).toHaveLength(1);
      expect(capturedQueryParams[0].options?.model).toBe('finding2-claude');
      const row = sessions.getById(session.id);
      expect(row.model).toBe(snapshotRef);
      expect(row.resolvedModel).toBe('finding2-claude');
    } finally {
      await clearCooldowns();
    }
  });
});

// ── Provider-only switch context (finding 9) ─────────────────────────────────
// Resume eligibility and conversation-context replay must follow the previous
// EXECUTED concrete (providerId, modelId) pair — not the model string alone.
// A provider-only switch (same model id, different provider) starts a fresh
// provider thread: the old resume handle is meaningless and history must be
// replayed. The durable last-executed identity survives a provider-only PATCH
// that rewrites the current binding.
describe('sessionContinuation — provider-only switch context (finding 9)', () => {
  let project;
  let providerA;
  let providerB;

  const SHARED_MODEL = 'finding9-shared-model';

  function resumeCapableAgent() {
    return {
      // eslint-disable-next-line require-yield -- captures dispatch params without emitting provider events
      async *execute(queryParams) {
        capturedQueryParams.push(queryParams);
      },
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    capturedAgentCallMetas = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();
    activeConversationIds.clear();

    project = projects.create('Finding9 Project', '/tmp/finding9-test');
    providerA = modelProviders.create({ name: 'Finding9 Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Finding9 Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: SHARED_MODEL, displayName: 'Shared' });
    modelProviders.addModel(providerB.id, { modelId: SHARED_MODEL, displayName: 'Shared' });
  });

  function createExecutedSession({ model = SHARED_MODEL, providerId = providerA.id } = {}) {
    const session = sessions.create(project.id, 'Executed session', 'Initial prompt', 'standard');
    sessions.update(session.id, {
      status: 'waiting', model, providerId, agentType: 'claude-code',
    });
    const conversation = conversations.ensureActiveConversation(session.id);
    conversations.update(conversation.id, { claudeSessionId: 'resume-handle-9' });
    messages.create(session.id, 'user', 'Original question', { conversationId: conversation.id });
    messages.create(session.id, 'assistant', 'Original answer', { conversationId: conversation.id });
    return sessions.getById(session.id);
  }

  it('drops resume and replays context on an explicit provider-only switch', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    mockedCreateAgent.mockImplementationOnce(resumeCapableAgent);
    const session = createExecutedSession();

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: { model: SHARED_MODEL, providerId: providerB.id }, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    const [params] = capturedQueryParams;
    expect(params.options?.model).toBe(SHARED_MODEL);
    // Same model string, different provider: no resume, history replayed.
    expect(params.options?.resume ?? null).toBe(null);
    expect(params.prompt).toContain('Original answer');
    // The new executed identity is recorded durably.
    const row = sessions.getById(session.id);
    expect(row.lastExecutedModel).toBe(SHARED_MODEL);
    expect(row.lastExecutedProviderId).toBe(providerB.id);
  });

  it('detects the switch after a provider-only PATCH rewrote the binding', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    mockedCreateAgent.mockImplementationOnce(resumeCapableAgent);
    const session = createExecutedSession();
    // What a provider-only PATCH leaves behind: the binding now names B while
    // the durable last-executed identity still names the A turn that ran.
    sessions.update(session.id, {
      providerId: providerB.id, lastExecutedModel: SHARED_MODEL, lastExecutedProviderId: providerA.id,
    });

    await continueSessionCore(session.id, 'Follow-up after PATCH', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    const [params] = capturedQueryParams;
    expect(params.options?.resume ?? null).toBe(null);
    expect(params.prompt).toContain('Original answer');
    const row = sessions.getById(session.id);
    expect(row.lastExecutedModel).toBe(SHARED_MODEL);
    expect(row.lastExecutedProviderId).toBe(providerB.id);
  });

  it('keeps resume and skips replay when distinct tiers resolve to the same concrete pair', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    mockedCreateAgent.mockImplementationOnce(resumeCapableAgent);
    const highTier = modelTiers.create({
      name: 'Finding9 High Tier',
      members: [{ providerId: providerA.id, modelId: SHARED_MODEL, position: 0 }],
    });
    const lowTier = modelTiers.create({
      name: 'Finding9 Low Tier',
      members: [{ providerId: providerA.id, modelId: SHARED_MODEL, position: 0 }],
    });
    const session = createExecutedSession({
      model: buildTierRef(highTier.id), providerId: null,
    });
    sessions.update(session.id, {
      resolvedModel: SHARED_MODEL, resolvedProviderId: providerA.id,
      lastExecutedModel: SHARED_MODEL, lastExecutedProviderId: providerA.id,
    });

    await continueSessionCore(session.id, 'Follow-up on Low', '/tmp/test', {
      options: { model: buildTierRef(lowTier.id) }, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    const [params] = capturedQueryParams;
    // Same executed pair: the provider thread is still valid.
    expect(params.options?.resume).toBe('resume-handle-9');
    expect(params.prompt).not.toContain('Original answer');
  });

  it('preserves resume/context state on model-less initialization', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    mockedCreateAgent.mockImplementationOnce(resumeCapableAgent);
    // A lane on-enter worker created model-less: adopting the first binding
    // establishes the thread rather than switching it.
    const session = sessions.create(project.id, 'Model-less session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting', model: null, providerId: null });

    await continueSessionCore(session.id, 'First turn', '/tmp/test', {
      options: { model: SHARED_MODEL, providerId: providerA.id }, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    const [params] = capturedQueryParams;
    expect(params.options?.model).toBe(SHARED_MODEL);
    expect(params.prompt).not.toContain('Original answer');
  });

  it('treats an unknowable previous identity conservatively on older records', async () => {
    const { createAgentForSession: mockedCreateAgent } = await import('./sessionExecution.js');
    mockedCreateAgent.mockImplementationOnce(resumeCapableAgent);
    const legacyTier = modelTiers.create({
      name: 'Finding9 Legacy Tier',
      members: [{ providerId: providerA.id, modelId: SHARED_MODEL, position: 0 }],
    });
    // Legacy tier-bound row: executed before, but no snapshot and no
    // last-executed identity were ever recorded.
    const session = createExecutedSession({
      model: buildTierRef(legacyTier.id), providerId: null,
    });
    sessions.update(session.id, { resolvedModel: null, resolvedProviderId: null });

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    const [params] = capturedQueryParams;
    expect(params.options?.resume ?? null).toBe(null);
    expect(params.prompt).toContain('Original answer');
  });
});

// ── Catalog-driven fallback cross-kind guard (review issue 1) ───────────────
// When the pinned member A of a tier becomes unavailable in the catalog
// (disabled / removed / renamed / provider deleted) while another member
// survives, repairStaleSnapshots clears the session snapshot and the next
// follow-up resolves a replacement live. That replacement must be validated
// against the session's established agent kind BEFORE dispatch on every entry
// point — including plain follow-ups that pass no explicit model (the
// scheduled path). Same-kind replacements continue with context preserved;
// cross-kind replacements raise CROSS_KIND_MODEL_SWITCH with no dispatch.
describe('sessionContinuation — catalog-fallback cross-kind guard (issue 1)', () => {
  let project;
  let claudeProvider;
  let codexProvider;
  let claudeProviderB;
  let crossKindTierRef;
  let sameKindTierRef;

  beforeEach(() => {
    capturedQueryParams = [];
    capturedTierContexts = [];
    capturedAgentTypes = [];
    capturedAgentCallMetas = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();
    activeConversationIds.clear();

    project = projects.create('Issue1 Project', '/tmp/issue1-test');
    claudeProvider = modelProviders.create({ name: 'Issue1 Claude', kind: 'anthropic' });
    modelProviders.addModel(claudeProvider.id, { modelId: 'issue1-claude', displayName: 'Issue1 Claude' });
    codexProvider = modelProviders.create({ name: 'Issue1 Codex', kind: 'openai' });
    modelProviders.addModel(codexProvider.id, { modelId: 'issue1-codex', displayName: 'Issue1 Codex' });
    claudeProviderB = modelProviders.create({ name: 'Issue1 Claude B', kind: 'anthropic' });
    modelProviders.addModel(claudeProviderB.id, { modelId: 'issue1-claude-b', displayName: 'Issue1 Claude B' });

    crossKindTierRef = buildTierRef(modelTiers.create({
      name: 'Issue1 Cross-Kind Tier',
      members: [
        { providerId: claudeProvider.id, modelId: 'issue1-claude', position: 0 },
        { providerId: codexProvider.id, modelId: 'issue1-codex', position: 1 },
      ],
    }).id);
    sameKindTierRef = buildTierRef(modelTiers.create({
      name: 'Issue1 Same-Kind Tier',
      members: [
        { providerId: claudeProvider.id, modelId: 'issue1-claude', position: 0 },
        { providerId: claudeProviderB.id, modelId: 'issue1-claude-b', position: 1 },
      ],
    }).id);
  });

  // An established session pinned to member A: it ran before (last-executed
  // identity + snapshot) and produced assistant output, so its kind is locked.
  function createPinnedSession(tierRef, snapshot) {
    const session = sessions.create(project.id, 'Pinned session', 'Initial prompt', 'standard');
    sessions.update(session.id, {
      status: 'waiting',
      model: tierRef,
      providerId: null,
      agentType: 'claude-code',
      resolvedModel: snapshot.model,
      resolvedProviderId: snapshot.providerId,
      lastExecutedModel: snapshot.model,
      lastExecutedProviderId: snapshot.providerId,
    });
    const conversation = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'Hello', { conversationId: conversation.id });
    messages.create(session.id, 'assistant', 'Hi there', { conversationId: conversation.id });
    return sessions.getById(session.id);
  }

  function disableClaudeProvider() {
    // Production path: disabling the provider runs the degradation sweep,
    // which clears snapshots pinned to its members.
    modelProviders.updateWithDegradation(claudeProvider.id, { enabled: false });
  }

  it('rejects a follow-up that would dispatch a cross-kind replacement with no explicit model', async () => {
    const session = createPinnedSession(crossKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    disableClaudeProvider();
    expect(sessions.getById(session.id).resolvedModel ?? null).toBe(null);

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Cannot switch agent kind/);

    // No provider dispatch happened.
    expect(capturedQueryParams).toHaveLength(0);
    expect(capturedAgentTypes).toHaveLength(0);

    // No selection, snapshot, or identity mutation.
    const row = sessions.getById(session.id);
    expect(row.model).toBe(crossKindTierRef);
    expect(row.agentType).toBe('claude-code');
    expect(row.resolvedModel ?? null).toBe(null);

    // Preparation-failure cleanup still applies.
    expect(activeSessions.has(session.id)).toBe(false);
    expect(row.status).toBe('error');
  });

  it('continues a same-kind replacement with preserved context and a fallback notice', async () => {
    const session = createPinnedSession(sameKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    disableClaudeProvider();

    await continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    expect(capturedQueryParams[0].options?.model).toBe('issue1-claude-b');

    // Snapshot backfilled to the replacement; binding untouched.
    const row = sessions.getById(session.id);
    expect(row.model).toBe(sameKindTierRef);
    expect(row.resolvedModel).toBe('issue1-claude-b');
    expect(row.resolvedProviderId).toBe(claudeProviderB.id);

    // Visible fallback notice names the from → to models and the reason.
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      expect.stringMatching(/tier|failover/i),
      expect.objectContaining({ fromModel: 'issue1-claude', toModel: 'issue1-claude-b' }),
    );

    // Conversation intact: prior assistant output preserved.
    const roles = messages.getBySessionId(session.id).map((m) => m.role);
    expect(roles).toContain('assistant');
  });

  it('rejects the cross-kind replacement when the pinned model was removed', async () => {
    const session = createPinnedSession(crossKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    // Remove the pinned model row via the production soft-remove path.
    const stored = modelProviders.db
      .prepare('SELECT id FROM provider_models WHERE provider_id = ? AND model_id = ? AND removed_at IS NULL')
      .get(claudeProvider.id, 'issue1-claude');
    modelProviders.removeModel(stored.id);

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Cannot switch agent kind/);

    expect(capturedQueryParams).toHaveLength(0);
    expect(sessions.getById(session.id).agentType).toBe('claude-code');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('rejects the cross-kind replacement when the pinned model was renamed', async () => {
    const session = createPinnedSession(crossKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    const stored = modelProviders.db
      .prepare('SELECT id FROM provider_models WHERE provider_id = ? AND model_id = ? AND removed_at IS NULL')
      .get(claudeProvider.id, 'issue1-claude');
    modelProviders.updateModelWithDegradation(stored.id, { modelId: 'issue1-claude-renamed' });

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Cannot switch agent kind/);

    expect(capturedQueryParams).toHaveLength(0);
    expect(sessions.getById(session.id).agentType).toBe('claude-code');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('rejects the cross-kind replacement when the pinned provider was deleted', async () => {
    const session = createPinnedSession(crossKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    modelProviders.deleteWithDegradation(claudeProvider.id);

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Cannot switch agent kind/);

    expect(capturedQueryParams).toHaveLength(0);
    expect(sessions.getById(session.id).agentType).toBe('claude-code');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('continues on A again when A is re-enabled after a rejected switch', async () => {
    const session = createPinnedSession(crossKindTierRef, {
      model: 'issue1-claude', providerId: claudeProvider.id,
    });
    disableClaudeProvider();

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Cannot switch agent kind/);
    expect(capturedQueryParams).toHaveLength(0);

    modelProviders.updateWithDegradation(claudeProvider.id, { enabled: true });

    await continueSessionCore(session.id, 'Follow-up again', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(capturedQueryParams).toHaveLength(1);
    expect(capturedQueryParams[0].options?.model).toBe('issue1-claude');
    const row = sessions.getById(session.id);
    expect(row.resolvedModel).toBe('issue1-claude');
  });
});
