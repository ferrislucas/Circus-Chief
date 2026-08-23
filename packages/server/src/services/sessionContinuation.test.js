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
import { projects, sessions, conversations, modelTiers, modelProviders } from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { clearUnhealthy } from './tierResolutionService.js';

// ── WebSocket mock ────────────────────────────────────────────────────────────
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// ── Agent execution mock ─────────────────────────────────────────────────────
// Capture the queryParams that continueSessionCore passes to _executeSession.
let capturedQueryParams = [];
// Capture the agentType each call to createAgentForSession was made with, so
// tests can assert the agent adapter is created from the RECONCILED agentType
// (Work Item 4), not a stale pre-reconciliation value.
let capturedAgentTypes = [];

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    _executeSession: vi.fn(async ({ queryParams }) => {
      capturedQueryParams.push(queryParams);
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
    activeSessions: new Map(),
    activeConversationIds: new Map(),
    broadcastSessionStatus: vi.fn(),
  };
});

import { continueSessionCore } from './sessionContinuation.js';

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
    capturedAgentTypes = [];
    vi.clearAllMocks();

    project = projects.create('Tier Test Project', '/tmp/tier-continue-test');
    providerA = modelProviders.create({ name: 'Provider A', kind: 'anthropic' });
    // Register the model ids referenced by tier members below so the
    // model-existence filter in getTierMembersResolved (Issue 3) doesn't
    // treat them as orphaned/deleted models.
    modelProviders.addModel(providerA.id, { modelId: 'claude-opus-4-6', displayName: 'Opus' });
    modelProviders.addModel(providerA.id, { modelId: 'claude-sonnet-5', displayName: 'Sonnet' });
    modelProviders.addModel(providerA.id, { modelId: 'model-x', displayName: 'Model X' });
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

  it('throws a clear error when resolvedModel is absent and all tier members are in cooldown', async () => {
    const tier = modelTiers.create({
      name: 'Cooled',
      members: [{ providerId: providerA.id, modelId: 'model-x', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);
    const { markUnhealthy } = await import('./tierResolutionService.js');
    markUnhealthy(providerA.id, 'model-x', 60_000);

    const session = createTestSession(project, {
      model: tierRef,
      resolvedModel: null,
    });
    conversations.ensureActiveConversation(session.id);

    await expect(
      continueSessionCore(session.id, 'hi', '/tmp/test', { options: {}, callbacks: mockCallbacks })
    ).rejects.toThrow(/no healthy members available/i);

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

    it('still throws (transient) when all members are merely in cooldown and the tier still exists', async () => {
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
      const { markUnhealthy } = await import('./tierResolutionService.js');
      markUnhealthy(providerA.id, 'model-x', 60_000);

      await expect(
        continueSessionCore(session.id, 'hi', '/tmp/test', { options: {}, callbacks: mockCallbacks })
      ).rejects.toThrow(/no healthy members available/i);

      // The binding survived — a cooldown must not clear it.
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
