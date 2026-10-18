import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projects, sessions, messages, conversations, modelTiers, modelProviders } from '../database.js';
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { clearUnhealthy, isUnhealthy, markUnhealthy } from './tierResolutionService.js';
import { SESSION_ERROR_FIXTURES } from './sessionErrorFixtures.js';
import { abortForUserStop } from './sessionAbort.js';

// ── Mocks (mirror sessionContinuation.test.js) ──────────────────────────────
const dispatched = [];
let executeScript = [];
const broadcastCalls = [];
const workflowMock = vi.hoisted(() => ({ laneRunOwnsSession: true }));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn((...args) => { broadcastCalls.push(args); }),
  broadcastToProject: vi.fn(),
}));

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    _executeSession: vi.fn(async ({ queryParams, tierContext, agentCallMeta, controller }) => {
      const step = executeScript[dispatched.length];
      dispatched.push({ queryParams, tierContext, agentCallMeta, controller });
      if (step?.partialMessage) {
        const active = conversations.ensureActiveConversation(step.sessionId);
        messages.create(step.sessionId, 'assistant', step.partialMessage, { conversationId: active.id });
      }
      if (step?.abortController) {
        abortForUserStop(controller);
      }
      if (step?.coolMember) {
        markUnhealthy(step.coolMember.providerId, step.coolMember.modelId);
      }
      if (step?.error) throw step.error;
      return undefined;
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
import { activeSessions } from './sessionExecutionOwnership.js';

// A real harvested quota string from the pinned corpus (tight-gate eligible).
const QUOTA_ERROR_MESSAGE = SESSION_ERROR_FIXTURES.find(
  (row) => row.kind === 'quota' && row.failoverEligible
).message;

const noop = vi.fn();
const mockCallbacks = {
  handleTemplateTriggerIfNeeded: noop,
  handleAutoSendIfNeeded: noop,
};

/**
 * RED (plan Phase 5): same-turn tier-failover retry (max 1) for continuations.
 * None of this exists yet — every test below fails until Phase 6 implements
 * the bounded retry loop in continueSessionCore.
 */
describe('sessionContinuation — same-turn failover retry (§5.2)', () => {
  let project;
  let providerA;
  let providerB;

  beforeEach(() => {
    dispatched.length = 0;
    broadcastCalls.length = 0;
    executeScript = [];
    workflowMock.laneRunOwnsSession = true;
    vi.clearAllMocks();
    activeSessions.clear();

    project = projects.create('Retry Test Project', '/tmp/retry-continue-test');
    providerA = modelProviders.create({ name: 'Retry Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'retry-a', displayName: 'Retry A' });
    modelProviders.addModel(providerA.id, { modelId: 'retry-a2', displayName: 'Retry A2' });
    providerB = modelProviders.create({ name: 'Retry Provider B', kind: 'openai' });
    modelProviders.addModel(providerB.id, { modelId: 'retry-b', displayName: 'Retry B' });
  });

  function createPinnedSession(members, snapshot, { flagOn = true } = {}) {
    const tier = modelTiers.create({ name: 'Retry Tier', members, autoFailoverEnabled: flagOn });
    const tierRef = buildTierRef(tier.id);
    const row = sessions.create(project.id, 'Retry session', 'Initial prompt', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: tierRef,
      agentType: 'claude-code',
      resolvedModel: snapshot.modelId,
      resolvedProviderId: snapshot.providerId,
    });
    // Established conversation: durable activity exists BEFORE the failed
    // turn, so the retry must prove the G3-always path (not the start-only
    // no-activity boundary). Messages carry the active conversation id so
    // the model-switch transcript builder picks them up.
    const session = sessions.getById(row.id);
    const active = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'earlier question', { conversationId: active.id });
    messages.create(session.id, 'assistant', 'earlier answer', { conversationId: active.id });
    return { tier, tierRef, session };
  }

  function failoverEvents() {
    return broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.TIER_FAILOVER);
  }

  it('retries the same prompt once on the next healthy member with a boundary marker', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [
      { sessionId: session.id, partialMessage: 'partial work before quota wall', error: new Error(QUOTA_ERROR_MESSAGE) },
      {},
    ];

    await continueSessionCore(session.id, 'Follow-up needing retry', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    });

    expect(dispatched).toHaveLength(2);
    expect(dispatched[0].queryParams.options?.model).toBe('retry-a');
    expect(dispatched[1].queryParams.options?.model).toBe('retry-a2');
    // Same user prompt carried into the retry.
    expect(dispatched[1].queryParams.prompt).toContain('Follow-up needing retry');
    // Failed-turn transcript carried forward, never re-executed: the boundary
    // marker names the failed member and forbids replay.
    expect(dispatched[1].queryParams.prompt).toContain('partial work before quota wall');
    expect(dispatched[1].queryParams.prompt).toContain('retry-a');
    expect(dispatched[1].queryParams.prompt).toMatch(/do not re-execute/i);
    // History intact: earlier turns still present in the retry prompt.
    expect(dispatched[1].queryParams.prompt).toContain('earlier answer');

    const row = sessions.getById(session.id);
    expect(row.resolvedModel).toBe('retry-a2');
    expect(row.lastExecutedModel).toBe('retry-a2');

    const events = failoverEvents();
    expect(events).toHaveLength(1);
    expect(events[0][2]).toMatchObject({ fromModel: 'retry-a', toModel: 'retry-a2' });
    expect(isUnhealthy(providerA.id, 'retry-a')).toBe(true);
    clearUnhealthy(providerA.id, 'retry-a');
  });

  it('does not retry on an ineligible error', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{ error: new Error('Unexpected token in JSON at position 0') }];

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow();
    expect(dispatched).toHaveLength(1);
    expect(failoverEvents()).toHaveLength(0);
  });

  it('surfaces the terminal error with no retry when the tier has a single member', async () => {
    const { session } = createPinnedSession(
      [{ providerId: providerA.id, modelId: 'retry-a', position: 0 }],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }];

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow();
    expect(dispatched).toHaveLength(1);
    expect(failoverEvents()).toHaveLength(0);
  });

  it('does not retry when automatic failover is disabled', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id },
      { flagOn: false }
    );
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }];

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow();
    expect(dispatched).toHaveLength(1);
    expect(failoverEvents()).toHaveLength(0);
  });

  it('does not dispatch a successor after a user stop', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{
      // Abort the turn's own controller before failing with an otherwise
      // eligible error: the abort must win over the retry.
      abortController: true,
      error: new Error(QUOTA_ERROR_MESSAGE),
    }];

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow();
    expect(dispatched).toHaveLength(1);
    expect(failoverEvents()).toHaveLength(0);
  });

  it('settles normally when the successor cooled mid-turn (no silent unsettled rethrow)', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{
      // The authorized successor cools between preparation and failure.
      coolMember: { providerId: providerA.id, modelId: 'retry-a2' },
      error: new Error(QUOTA_ERROR_MESSAGE),
    }];

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow();
    try {
      expect(dispatched).toHaveLength(1);
      expect(failoverEvents()).toHaveLength(0);
      // The failed member still cooled for future sessions…
      expect(isUnhealthy(providerA.id, 'retry-a')).toBe(true);
      // …and the turn settled visibly instead of wedging as running.
      expect(sessions.getById(session.id).status).toBe('error');
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
      clearUnhealthy(providerA.id, 'retry-a2');
    }
  });
});
