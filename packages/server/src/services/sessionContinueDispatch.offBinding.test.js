import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projects, sessions, modelTiers, modelProviders } from '../database.js';
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { clearUnhealthy, isUnhealthy } from './tierResolutionService.js';
import { SESSION_ERROR_FIXTURES } from './sessionErrorFixtures.js';
import { abortForUserStop } from './sessionAbort.js';

// ── Mocks (mirror sessionContinuation.failoverRetry.test.js) ────────────────
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
      if (step?.abortController) {
        abortForUserStop(controller);
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

import { buildContinueModelAndEnv } from './sessionContinueDispatch.js';
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
 * Fix #4 (PR Review.md): the off-binding detector must compare the full
 * (model, providerId) pair against the session binding — never the model
 * string alone. A request that keeps the same model string but switches
 * provider (the duplicate-model-id scenario the FRD calls out in E1/E4) is
 * an explicit move and must run tier-free, so a same-turn retry can never
 * silently replace the explicit provider choice with a tier successor.
 */
describe('sessionContinueDispatch — explicitOffBindingMove compares the full pair (Fix #4)', () => {
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

    project = projects.create('OffBinding Test Project', '/tmp/offbinding-test');
    providerA = modelProviders.create({ name: 'OffBinding Provider A', kind: 'anthropic' });
    // Duplicate model id across providers (FRD E1): identity is the exact
    // (providerId, modelId) pair, never model-id lookup.
    modelProviders.addModel(providerA.id, { modelId: 'dup-model', displayName: 'Dup A' });
    providerB = modelProviders.create({ name: 'OffBinding Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerB.id, { modelId: 'dup-model', displayName: 'Dup B' });
    modelProviders.addModel(providerB.id, { modelId: 'other-model', displayName: 'Other B' });
  });

  function createConcreteSession() {
    const row = sessions.create(project.id, 'Dup session', 'Initial prompt', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: 'dup-model',
      providerId: providerA.id,
      agentType: 'claude-code',
    });
    return sessions.getById(row.id);
  }

  function createTierBoundSession() {
    const tier = modelTiers.create({
      name: 'OffBinding Tier',
      members: [
        { providerId: providerA.id, modelId: 'dup-model', position: 0 },
        { providerId: providerB.id, modelId: 'other-model', position: 1 },
      ],
      autoFailoverEnabled: true,
    });
    const row = sessions.create(project.id, 'Tier session', 'Initial prompt', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: buildTierRef(tier.id),
      agentType: 'claude-code',
      resolvedModel: 'dup-model',
      resolvedProviderId: providerA.id,
    });
    return { tier, session: sessions.getById(row.id) };
  }

  it('treats a provider-only override (same model string, different provider) as off-binding', () => {
    const session = createConcreteSession();
    const { explicitOffBindingMove, dispatchedPair } = buildContinueModelAndEnv(
      session, session.id, 'dup-model', { providerId: providerB.id }
    );
    expect(explicitOffBindingMove).toBe(true);
    expect(dispatchedPair).toMatchObject({ model: 'dup-model', providerId: providerB.id });
  });

  it('keeps the exact pair (same model string, same provider) as keep-current', () => {
    const session = createConcreteSession();
    const { explicitOffBindingMove } = buildContinueModelAndEnv(
      session, session.id, 'dup-model', { providerId: providerA.id }
    );
    expect(explicitOffBindingMove).toBe(false);
  });

  it('keeps a same-model follow-up with no provider hint as keep-current', () => {
    const session = createConcreteSession();
    const { explicitOffBindingMove } = buildContinueModelAndEnv(
      session, session.id, 'dup-model', {}
    );
    expect(explicitOffBindingMove).toBe(false);
  });

  it('treats a concrete-model move as off-binding', () => {
    const session = createConcreteSession();
    const { explicitOffBindingMove } = buildContinueModelAndEnv(
      session, session.id, 'other-model', { providerId: providerB.id }
    );
    expect(explicitOffBindingMove).toBe(true);
  });

  it('keeps a same-tier echo (with or without a provider hint) as keep-current', () => {
    const { tier, session } = createTierBoundSession();
    const tierRef = buildTierRef(tier.id);
    expect(buildContinueModelAndEnv(session, session.id, tierRef, {}).explicitOffBindingMove).toBe(false);
    const rebound = sessions.getById(session.id);
    expect(
      buildContinueModelAndEnv(rebound, rebound.id, tierRef, { providerId: providerB.id }).explicitOffBindingMove
    ).toBe(false);
  });

  it('treats a different-tier move as off-binding', () => {
    const { session } = createTierBoundSession();
    const otherTier = modelTiers.create({
      name: 'Other Tier',
      members: [{ providerId: providerB.id, modelId: 'other-model', position: 0 }],
      autoFailoverEnabled: true,
    });
    const { explicitOffBindingMove } = buildContinueModelAndEnv(
      session, session.id, buildTierRef(otherTier.id), {}
    );
    expect(explicitOffBindingMove).toBe(true);
  });

  it('runs a provider-only override tier-free: single attempt, no retry, no event', async () => {
    const session = createConcreteSession();
    executeScript = [{ error: new Error(QUOTA_ERROR_MESSAGE) }];

    await expect(continueSessionCore(session.id, 'Follow-up on provider B copy', '/tmp/test', {
      options: { model: 'dup-model', providerId: providerB.id }, callbacks: mockCallbacks,
    })).rejects.toThrow();
    try {
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].queryParams.options?.model).toBe('dup-model');
      const events = broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.TIER_FAILOVER);
      expect(events).toHaveLength(0);
      // Neither the previous binding nor the explicitly chosen member cools.
      expect(isUnhealthy(providerA.id, 'dup-model')).toBe(false);
      expect(isUnhealthy(providerB.id, 'dup-model')).toBe(false);
    } finally {
      clearUnhealthy(providerA.id, 'dup-model');
      clearUnhealthy(providerB.id, 'dup-model');
    }
  });
});
