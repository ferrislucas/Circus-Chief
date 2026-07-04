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

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    _executeSession: vi.fn(async ({ queryParams }) => {
      capturedQueryParams.push(queryParams);
    }),
    createAgentForSession: vi.fn(() => ({
      needsConversationContext: () => false,
      supportsResume: () => false,
    })),
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
    vi.clearAllMocks();

    project = projects.create('Tier Test Project', '/tmp/tier-continue-test');
    providerA = modelProviders.create({ name: 'Provider A', kind: 'anthropic' });
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
});
