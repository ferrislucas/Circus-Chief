import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projects, sessions, messages, conversations, modelTiers, modelProviders, agentCallLogs } from '../database.js';
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
      step?.onDispatch?.();
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
import { broadcastSessionStatus } from './streamEventHandler.js';

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
  let providerC;
  let providerD;

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
    providerC = modelProviders.create({ name: 'Retry Provider C', kind: 'anthropic' });
    modelProviders.addModel(providerC.id, { modelId: 'retry-c', displayName: 'Retry C' });
    providerD = modelProviders.create({ name: 'Retry Provider D', kind: 'anthropic' });
    modelProviders.addModel(providerD.id, { modelId: 'retry-d', displayName: 'Retry D' });
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

  it('wraps a final-member continuation retry to the first healthy member', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
        { providerId: providerC.id, modelId: 'retry-c', position: 2 },
      ],
      { modelId: 'retry-c', providerId: providerC.id }
    );
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }, {}];

    try {
      await continueSessionCore(session.id, 'Follow-up needing wrapped retry', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });

      expect(dispatched).toHaveLength(2);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-c');
      expect(dispatched[1].queryParams.options?.model).toBe('retry-a');
      expect(failoverEvents()).toHaveLength(1);
      expect(failoverEvents()[0][2]).toMatchObject({ fromModel: 'retry-c', toModel: 'retry-a' });
      expect(isUnhealthy(providerC.id, 'retry-c')).toBe(true);
    } finally {
      clearUnhealthy(providerC.id, 'retry-c');
    }
  });

  it('keeps the cycle membership frozen when a new first member is inserted mid-attempt', async () => {
    const { tier, session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
        { providerId: providerC.id, modelId: 'retry-c', position: 2 },
      ],
      { modelId: 'retry-c', providerId: providerC.id }
    );
    executeScript = [{
      onDispatch: () => modelTiers.update(tier.id, {
        members: [
          { providerId: providerD.id, modelId: 'retry-d', position: 0 },
          { providerId: providerA.id, modelId: 'retry-a', position: 1 },
          { providerId: providerA.id, modelId: 'retry-a2', position: 2 },
          { providerId: providerC.id, modelId: 'retry-c', position: 3 },
        ],
      }),
      error: new Error(QUOTA_ERROR_MESSAGE),
    }, {}];

    try {
      await continueSessionCore(session.id, 'Follow-up with frozen membership', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });
      expect(dispatched.map((call) => call.queryParams.options?.model)).toEqual(['retry-c', 'retry-a']);
      expect(failoverEvents()).toHaveLength(1);
      expect(failoverEvents()[0][2]).toMatchObject({ fromModel: 'retry-c', toModel: 'retry-a' });
    } finally {
      clearUnhealthy(providerC.id, 'retry-c');
    }
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

  it('emits a TIER_FAILOVER event + tierFailover log when a follow-up advances off a cooled snapshot (§5.1)', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    // The snapshotted member cooled (e.g. quota failure on a previous turn)
    // before this follow-up starts — §5.1 must advance visibly, not silently.
    markUnhealthy(providerA.id, 'retry-a');
    executeScript = [{}];

    try {
      await continueSessionCore(session.id, 'Follow-up after cooldown', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-a2');

      const row = sessions.getById(session.id);
      expect(row.resolvedModel).toBe('retry-a2');

      const events = failoverEvents();
      expect(events).toHaveLength(1);
      expect(events[0][2]).toMatchObject({ fromModel: 'retry-a', toModel: 'retry-a2' });

      const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.fromModel ?? rows[0].fromModel).toBe('retry-a');
      expect(rows[0].metadata?.toModel ?? rows[0].toModel).toBe('retry-a2');
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
    }
  });

  it('never hijacks an explicit concrete-model override (no retry, no cooling, no event)', async () => {
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }];

    await expect(continueSessionCore(session.id, 'Follow-up on hand-picked model', '/tmp/test', {
      options: { model: 'retry-b', providerId: providerB.id }, callbacks: mockCallbacks,
    })).rejects.toThrow();
    try {
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-b');
      expect(failoverEvents()).toHaveLength(0);
      // The snapshot member never ran — it must not be cooled.
      expect(isUnhealthy(providerA.id, 'retry-a')).toBe(false);
      // The explicitly chosen member also carries no tier side effects.
      expect(isUnhealthy(providerB.id, 'retry-b')).toBe(false);
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
      clearUnhealthy(providerB.id, 'retry-b');
    }
  });

  it('fails normally on an explicit different-tier override (no retry into the new tier)', async () => {
    modelProviders.addModel(providerA.id, { modelId: 'retry-a3', displayName: 'Retry A3' });
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    const otherTier = modelTiers.create({
      name: 'Other Tier',
      members: [
        { providerId: providerA.id, modelId: 'retry-a2', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a3', position: 1 },
      ],
      autoFailoverEnabled: true,
    });
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }];

    await expect(continueSessionCore(session.id, 'Follow-up on other tier', '/tmp/test', {
      options: { model: buildTierRef(otherTier.id) }, callbacks: mockCallbacks,
    })).rejects.toThrow();
    try {
      // Dispatched on the explicitly selected tier's live member, then failed
      // through the normal error path — no same-turn retry into retry-a3.
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-a2');
      expect(failoverEvents()).toHaveLength(0);
      expect(isUnhealthy(providerA.id, 'retry-a')).toBe(false);
      expect(isUnhealthy(providerA.id, 'retry-a2')).toBe(false);
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
      clearUnhealthy(providerA.id, 'retry-a2');
      clearUnhealthy(providerA.id, 'retry-a3');
    }
  });

  it('cools the dispatched member (not the snapshot) after an own-binding advance', async () => {
    modelProviders.addModel(providerA.id, { modelId: 'retry-a3', displayName: 'Retry A3' });
    const { session } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
        { providerId: providerA.id, modelId: 'retry-a3', position: 2 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    // Pre-cooled snapshot: §5.1 advances this turn onto retry-a2, so the
    // retry must attribute to retry-a2 (the member that ran), not retry-a.
    markUnhealthy(providerA.id, 'retry-a');
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }, {}];

    try {
      await continueSessionCore(session.id, 'Follow-up after advance', '/tmp/test', {
        options: {}, callbacks: mockCallbacks,
      });

      expect(dispatched).toHaveLength(2);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-a2');
      expect(dispatched[1].queryParams.options?.model).toBe('retry-a3');
      const events = failoverEvents();
      expect(events).toHaveLength(2);
      expect(events[0][2]).toMatchObject({ fromModel: 'retry-a', toModel: 'retry-a2' });
      expect(events[1][2]).toMatchObject({ fromModel: 'retry-a2', toModel: 'retry-a3' });
      expect(isUnhealthy(providerA.id, 'retry-a2')).toBe(true);
      expect(sessions.getById(session.id).resolvedModel).toBe('retry-a3');
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
      clearUnhealthy(providerA.id, 'retry-a2');
      clearUnhealthy(providerA.id, 'retry-a3');
    }
  });

  it('still retries once when the follow-up echoes the bound tier ref', async () => {
    const { session, tierRef } = createPinnedSession(
      [
        { providerId: providerA.id, modelId: 'retry-a', position: 0 },
        { providerId: providerA.id, modelId: 'retry-a2', position: 1 },
      ],
      { modelId: 'retry-a', providerId: providerA.id }
    );
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }, {}];

    try {
      // What the web client sends on a normal follow-up: the bound tier ref.
      // This is a keep-current echo, not an explicit move off the binding.
      await continueSessionCore(session.id, 'Normal follow-up', '/tmp/test', {
        options: { model: tierRef }, callbacks: mockCallbacks,
      });

      expect(dispatched).toHaveLength(2);
      expect(dispatched[0].queryParams.options?.model).toBe('retry-a');
      expect(dispatched[1].queryParams.options?.model).toBe('retry-a2');
      const events = failoverEvents();
      expect(events).toHaveLength(1);
      expect(events[0][2]).toMatchObject({ fromModel: 'retry-a', toModel: 'retry-a2' });
    } finally {
      clearUnhealthy(providerA.id, 'retry-a');
      clearUnhealthy(providerA.id, 'retry-a2');
    }
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

  describe('failover event names the dispatched member (PR #1180 review #2)', () => {
    function createEditableTierSession() {
      const rowB = modelProviders.addModel(providerA.id, { modelId: 'edit-b', displayName: 'Edit B' });
      const rowC = modelProviders.addModel(providerA.id, { modelId: 'edit-c', displayName: 'Edit C' });
      const tier = modelTiers.create({
        name: 'Edit Tier',
        members: [
          { providerId: providerA.id, modelId: 'retry-a', position: 0 },
          { providerId: providerA.id, modelId: 'edit-b', position: 1 },
          { providerId: providerA.id, modelId: 'edit-c', position: 2 },
        ],
        autoFailoverEnabled: true,
      });
      const row = sessions.create(project.id, 'Edit session', 'Initial prompt', 'standard');
      sessions.update(row.id, {
        status: 'waiting',
        model: buildTierRef(tier.id),
        agentType: 'claude-code',
        resolvedModel: 'retry-a',
        resolvedProviderId: providerA.id,
      });
      const session = sessions.getById(row.id);
      const active = conversations.ensureActiveConversation(session.id);
      messages.create(session.id, 'user', 'earlier question', { conversationId: active.id });
      messages.create(session.id, 'assistant', 'earlier answer', { conversationId: active.id });
      return { tier, session, rowB, rowC };
    }

    async function runWithMidTurnTierEdit() {
      const { session, rowB } = createEditableTierSession();
      // Structural tier edit landing strictly between arming the retry and
      // the second attempt's live re-resolution. Hooked on the arm-time
      // running-status broadcast (the retry re-arms running after the failed
      // attempt releases it) — a seam that exists regardless of when the
      // failover event itself is emitted.
      const prevImpl = broadcastSessionStatus.getMockImplementation();
      let edited = false;
      broadcastSessionStatus.mockImplementation((...statusArgs) => {
        if (!edited && statusArgs[0] === session.id && statusArgs[1] === 'running' && dispatched.length === 1) {
          edited = true;
          modelProviders.removeModel(rowB.id);
        }
        return prevImpl?.(...statusArgs);
      });
      try {
        executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }, {}];
        await continueSessionCore(session.id, 'Follow-up across tier edit', '/tmp/test', {
          options: {}, callbacks: mockCallbacks,
        });
        const failedCooled = isUnhealthy(providerA.id, 'retry-a');
        const skippedCooled = isUnhealthy(providerA.id, 'edit-b');
        const events = failoverEvents();
        const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
        return {
          session,
          edited,
          dispatchedModels: dispatched.map((d) => d.queryParams.options?.model),
          events,
          logRows: rows,
          resolvedModel: sessions.getById(session.id).resolvedModel,
          failedCooled,
          skippedCooled,
        };
      } finally {
        broadcastSessionStatus.mockReset();
        clearUnhealthy(providerA.id, 'retry-a');
        clearUnhealthy(providerA.id, 'edit-b');
        clearUnhealthy(providerA.id, 'edit-c');
      }
    }

    it('event, log entry, and snapshot name the member that actually dispatches', async () => {
      const outcome = await runWithMidTurnTierEdit();
      expect(outcome.edited).toBe(true);
      expect(outcome.dispatchedModels).toEqual(['retry-a', 'edit-c']);
      // Exactly one failover marker for the turn, naming the actual switch.
      expect(outcome.events).toHaveLength(1);
      expect(outcome.events[0][2]).toMatchObject({ fromModel: 'retry-a', toModel: 'edit-c' });
      expect(outcome.logRows).toHaveLength(1);
      const logged = outcome.logRows[0].metadata ?? outcome.logRows[0];
      expect(logged.toModel ?? outcome.logRows[0].toModel).toBe('edit-c');
      expect(outcome.resolvedModel).toBe('edit-c');
    });

    it('cools the failed member exactly once and never cools the skipped member', async () => {
      const outcome = await runWithMidTurnTierEdit();
      expect(outcome.edited).toBe(true);
      expect(outcome.failedCooled).toBe(true);
      expect(outcome.skippedCooled).toBe(false);
    });
  });
});
