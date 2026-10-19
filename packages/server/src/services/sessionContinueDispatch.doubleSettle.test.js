/**
 * Regression test for PR Review #2: when failover was authorized at prep time
 * (`allowFailover: true` — a healthy successor exists) but the attempt fails
 * with an INELIGIBLE error, the terminal pipeline must run exactly once.
 *
 * Unlike sessionContinuation.failoverRetry.test.js (which mocks
 * `_executeSession` wholesale), this suite keeps `_executeSession` REAL and
 * only fails the provider adapter — so `handleTurnFailure` genuinely runs and
 * a double settlement is observable (double reschedule evaluation, double
 * visible SESSION_ERROR broadcast).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projects, sessions, modelTiers, modelProviders } from '../database.js';
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { clearUnhealthy, isUnhealthy } from './tierResolutionService.js';

const broadcastCalls = [];
const agentExecuteCalls = [];
const holder = vi.hoisted(() => ({ error: null }));
const workflowMock = vi.hoisted(() => ({ laneRunOwnsSession: true }));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn((...args) => { broadcastCalls.push(args); }),
  broadcastToProject: vi.fn(),
}));

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createAgentForSession: vi.fn(() => ({
      needsConversationContext: () => false,
      supportsResume: () => false,
      // eslint-disable-next-line require-yield -- fails before the first provider event
      async *execute() {
        agentExecuteCalls.push(1);
        throw holder.error;
      },
    })),
    buildAgentEnv: vi.fn((env) => env),
  };
});

const shouldRescheduleOnErrorMock = vi.fn(() => false);

vi.mock('./sessionErrors.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    shouldRescheduleOnError: (...args) => shouldRescheduleOnErrorMock(...args),
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
  extractPrUrlIfNeeded: vi.fn(),
  onSessionComplete: vi.fn(),
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

const noop = vi.fn();
const mockCallbacks = {
  handleTemplateTriggerIfNeeded: noop,
  handleAutoSendIfNeeded: noop,
};

describe('sessionContinuation — declined failover retry settles exactly once (#2)', () => {
  let project;
  let providerA;
  let providerB;

  beforeEach(() => {
    broadcastCalls.length = 0;
    agentExecuteCalls.length = 0;
    holder.error = null;
    workflowMock.laneRunOwnsSession = true;
    shouldRescheduleOnErrorMock.mockClear();
    vi.clearAllMocks();
    activeSessions.clear();

    project = projects.create('Double Settle Test Project', '/tmp/double-settle-test');
    providerA = modelProviders.create({ name: 'DoubleSettle Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'ds-a', displayName: 'DS A' });
    providerB = modelProviders.create({ name: 'DoubleSettle Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerB.id, { modelId: 'ds-b', displayName: 'DS B' });
  });

  function createPinnedSession() {
    const tier = modelTiers.create({
      name: 'DoubleSettle Tier',
      members: [
        { providerId: providerA.id, modelId: 'ds-a', position: 0 },
        { providerId: providerB.id, modelId: 'ds-b', position: 1 },
      ],
    });
    const tierRef = buildTierRef(tier.id);
    const row = sessions.create(project.id, 'Double settle session', 'Initial prompt', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: tierRef,
      agentType: 'claude-code',
      resolvedModel: 'ds-a',
      resolvedProviderId: providerA.id,
    });
    return sessions.getById(row.id);
  }

  function sessionErrorBroadcasts() {
    return broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.SESSION_ERROR);
  }

  function failoverEvents() {
    return broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.TIER_FAILOVER);
  }

  it('runs the terminal error pipeline exactly once for an ineligible error with a healthy successor', async () => {
    const session = createPinnedSession();
    // Ineligible (auth) error on a tier with a healthy second member:
    // prep authorizes allowFailover:true, the retry is declined, and the turn
    // must go through the existing error path exactly once.
    holder.error = new Error('Invalid API key provided');

    await expect(continueSessionCore(session.id, 'Follow-up', '/tmp/test', {
      options: {}, callbacks: mockCallbacks,
    })).rejects.toThrow(/Invalid API key/);

    // Single provider dispatch — no retry was armed.
    expect(agentExecuteCalls).toHaveLength(1);
    // No failover announced: nothing advanced.
    expect(failoverEvents()).toHaveLength(0);
    // Single settlement: one reschedule evaluation, one visible error.
    expect(shouldRescheduleOnErrorMock).toHaveBeenCalledTimes(1);
    expect(sessionErrorBroadcasts()).toHaveLength(1);
    // Ineligible errors never cool the member.
    expect(isUnhealthy(providerA.id, 'ds-a')).toBe(false);
    expect(sessions.getById(session.id).status).toBe('error');
    clearUnhealthy(providerA.id, 'ds-a');
    clearUnhealthy(providerB.id, 'ds-b');
  });
});
