import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { projects, sessions, messages, conversations, modelTiers, modelProviders, agentCallLogs } from '../database.js';
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { clearUnhealthy, isUnhealthy, markUnhealthy } from './tierResolutionService.js';
import { SESSION_ERROR_FIXTURES } from './sessionErrorFixtures.js';
import { abortForUserStop } from './sessionAbort.js';
import { activeSessions } from './sessionExecutionOwnership.js';

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mock the Claude SDK so the REAL _executeSession failure pipeline runs
// (handleTurnFailure → failover-vs-reschedule decision → reschedule-or-error)
// without any provider call. Both tier members are anthropic-kind so the real
// gateway builds ClaudeCodeAdapters that hit this mock.
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));
const { mockRescheduleSession } = vi.hoisted(() => ({
  mockRescheduleSession: vi.fn(async () => true),
}));
const broadcastCalls = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn((...args) => { broadcastCalls.push(args); }),
  broadcastToProject: vi.fn(),
}));

vi.mock('./summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
  generateSummaryNow: vi.fn(),
  generateSummaryIfNeeded: vi.fn(),
  cleanupSession: vi.fn(),
}));

vi.mock('./schedulerService.js', () => ({
  schedulerService: { rescheduleSession: mockRescheduleSession },
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
    activeLaneRunOwnsSession: vi.fn(() => true),
  };
});

vi.mock('./gitService.js', () => ({
  ensureWorktreeCommitAttributionHook: vi.fn(),
}));

import { continueSessionWithExistingMessage } from './sessionManager.js';
import { broadcastSessionStatus } from './streamEventHandler.js';

// The exact incident string: a pinned corpus row (family `quota`) that matches
// BOTH the tight failover gate and the broad reschedule matcher.
const QUOTA_ERROR_MESSAGE = SESSION_ERROR_FIXTURES.find(
  (row) => row.kind === 'quota' && row.failoverEligible
).message;

function successScript() {
  return async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'branch-model', slash_commands: [] };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
    yield { type: 'result', subtype: 'success' };
  };
}

function quotaFailureScript() {
  // eslint-disable-next-line require-yield -- simulates a provider failure before any event
  return async function* () {
    throw new Error(QUOTA_ERROR_MESSAGE);
  };
}

/**
 * RED (plan Phase 1): branch-continue immediate failover.
 *
 * `continueSessionWithExistingMessage` (branch auto-start, scheduled/agent
 * continuations on an existing user message) builds a health-only tier
 * context, so a checked tier's mid-conversation quota failure reschedules the
 * SAME member instead of advancing — the incident shape from
 * prd-tier-immediate-failover.md §1. The new-message path
 * (`continueSessionCore`) already retries via §5.2; this path must too.
 */
describe('branch-continue immediate failover (checked tier)', () => {
  let project;
  let providerA;
  let providerB;
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    broadcastCalls.length = 0;
    activeSessions.clear();
    mockQuery.mockReset();
    mockQuery.mockImplementation(successScript());

    tempDir = mkdtempSync(join(tmpdir(), 'branch-failover-'));
    project = projects.create('Branch Failover Project', tempDir);
    providerA = modelProviders.create({ name: 'Branch Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'branch-a', displayName: 'Branch A' });
    providerB = modelProviders.create({ name: 'Branch Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerB.id, { modelId: 'branch-b', displayName: 'Branch B' });
  });

  afterEach(() => {
    activeSessions.clear();
    clearUnhealthy(providerA.id, 'branch-a');
    clearUnhealthy(providerB.id, 'branch-b');
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createMidConversationTierSession({ flagOn = true } = {}) {
    const tier = modelTiers.create({
      name: 'Branch Tier',
      members: [
        { providerId: providerA.id, modelId: 'branch-a', position: 0 },
        { providerId: providerB.id, modelId: 'branch-b', position: 1 },
      ],
      autoFailoverEnabled: flagOn,
    });
    // `waiting` sessions get no initial user message from create() — the two
    // messages below are the turn's entire conversation.
    const row = sessions.create(project.id, 'Branch session', 'Initial prompt', { status: 'waiting', mode: 'standard' });
    sessions.update(row.id, {
      status: 'waiting',
      model: buildTierRef(tier.id),
      agentType: 'claude-code',
      resolvedModel: 'branch-a',
      resolvedProviderId: providerA.id,
      autoRescheduleEnabled: true,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      rescheduleDelayMinutes: 60,
    });
    // Established conversation: durable assistant activity exists BEFORE the
    // failed turn, so this is the mid-conversation (post-activity) shape.
    const session = sessions.getById(row.id);
    const active = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'earlier question', { conversationId: active.id });
    messages.create(session.id, 'assistant', 'earlier answer with real work', { conversationId: active.id });
    return { tier, session, conversationId: active.id };
  }

  function failoverEvents() {
    return broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.TIER_FAILOVER);
  }

  it('AC1: advances to the next member in the same turn with no same-model reschedule', async () => {
    const { session, conversationId } = createMidConversationTierSession({ flagOn: true });
    mockQuery
      .mockImplementationOnce(quotaFailureScript())
      .mockImplementation(successScript());

    const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

    // Same-turn advance: the failed member's error never becomes a reschedule.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-a');
    expect(mockQuery.mock.calls[1][0].options?.model).toBe('branch-b');
    expect(mockRescheduleSession).not.toHaveBeenCalled();

    const row = sessions.getById(session.id);
    expect(row.status).not.toBe('scheduled');
    expect(row.rescheduleCount ?? 0).toBe(0);
    expect(row.resolvedModel).toBe('branch-b');
    expect(row.resolvedProviderId).toBe(providerB.id);

    // Failover is visible: broadcast + agent-log entry, snapshot pinned.
    const events = failoverEvents();
    expect(events).toHaveLength(1);
    expect(events[0][2]).toMatchObject({ fromModel: 'branch-a', toModel: 'branch-b' });
    const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
    expect(rows).toHaveLength(1);

    // The failed member cooled so future turns skip it.
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
    expect(result == null || result.outcome !== 'rescheduled').toBe(true);
  });

  it('AC2: the retry replays history with the boundary marker instead of re-executing', async () => {
    const { session, conversationId } = createMidConversationTierSession({ flagOn: true });
    mockQuery
      .mockImplementationOnce(quotaFailureScript())
      .mockImplementation(successScript());

    await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const retryPrompt = mockQuery.mock.calls[1][0].prompt;
    expect(retryPrompt).toContain('<tier_failover_boundary>');
    expect(retryPrompt).toMatch(/do not re-execute/i);
    expect(retryPrompt).toContain('branch-a');
    // Failed-turn transcript carried forward, never re-executed.
    expect(retryPrompt).toContain('earlier answer with real work');
    expect(retryPrompt).toContain('earlier question');
    // No duplicate user message was created for the retry.
    const userMessages = messages.getByConversationId(conversationId).filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
  });

  it('AC3 (guard): unchecked tier keeps today\'s same-model reschedule', async () => {
    const { session, conversationId } = createMidConversationTierSession({ flagOn: false });
    mockQuery.mockImplementationOnce(quotaFailureScript());

    const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

    // One attempt on the first member, then the existing reschedule path.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-a');
    expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
    expect(failoverEvents()).toHaveLength(0);
    expect(result).toMatchObject({ outcome: 'rescheduled' });
    // The failed member still cooled for future sessions.
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
  });
});

describe('branch-continue failover edges (checked tier)', () => {
  let project;
  let providerA;
  let providerB;
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    broadcastCalls.length = 0;
    activeSessions.clear();
    mockQuery.mockReset();
    mockQuery.mockImplementation(successScript());

    tempDir = mkdtempSync(join(tmpdir(), 'branch-failover-edge-'));
    project = projects.create('Branch Failover Edge Project', tempDir);
    providerA = modelProviders.create({ name: 'Branch Edge Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'branch-a', displayName: 'Branch A' });
    providerB = modelProviders.create({ name: 'Branch Edge Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerB.id, { modelId: 'branch-b', displayName: 'Branch B' });
  });

  afterEach(() => {
    activeSessions.clear();
    clearUnhealthy(providerA.id, 'branch-a');
    clearUnhealthy(providerB.id, 'branch-b');
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createSession(members, snapshot, { flagOn = true } = {}) {
    const tier = modelTiers.create({ name: 'Branch Edge Tier', members, autoFailoverEnabled: flagOn });
    const row = sessions.create(project.id, 'Branch edge session', 'Initial prompt', { status: 'waiting', mode: 'standard' });
    sessions.update(row.id, {
      status: 'waiting',
      model: buildTierRef(tier.id),
      agentType: 'claude-code',
      resolvedModel: snapshot.modelId,
      resolvedProviderId: snapshot.providerId,
      autoRescheduleEnabled: true,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      rescheduleDelayMinutes: 60,
    });
    const session = sessions.getById(row.id);
    const active = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'earlier question', { conversationId: active.id });
    messages.create(session.id, 'assistant', 'earlier answer with real work', { conversationId: active.id });
    return { tier, session, conversationId: active.id };
  }

  function twoMembers() {
    return [
      { providerId: providerA.id, modelId: 'branch-a', position: 0 },
      { providerId: providerB.id, modelId: 'branch-b', position: 1 },
    ];
  }

  function failoverEvents() {
    return broadcastCalls.filter(([, type]) => type === WS_MESSAGE_TYPES.TIER_FAILOVER);
  }

  it('AC4: non-eligible error takes the existing error path (no failover, no reschedule)', async () => {
    const { session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    // eslint-disable-next-line require-yield -- simulates a provider failure before any event
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Authentication failed: invalid API key');
    });

    await expect(continueSessionWithExistingMessage(session.id, conversationId, tempDir, {})).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRescheduleSession).not.toHaveBeenCalled();
    expect(failoverEvents()).toHaveLength(0);
    // Not a capacity signal: no member cooling either.
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(false);
    expect(sessions.getById(session.id).status).toBe('error');
  });

  it('exhaustion (single member): falls back to reschedule-or-error with cooling', async () => {
    const { session, conversationId } = createSession(
      [{ providerId: providerA.id, modelId: 'branch-a', position: 0 }],
      { modelId: 'branch-a', providerId: providerA.id }
    );
    mockQuery.mockImplementationOnce(quotaFailureScript());

    const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
    expect(failoverEvents()).toHaveLength(0);
    expect(result).toMatchObject({ outcome: 'rescheduled' });
    // The terminal member still cools down for future sessions.
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
  });

  it('exhaustion (successor pre-cooled): falls back to reschedule-or-error', async () => {
    const { session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    markUnhealthy(providerB.id, 'branch-b');
    mockQuery.mockImplementationOnce(quotaFailureScript());

    try {
      const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-a');
      expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
      expect(failoverEvents()).toHaveLength(0);
      expect(result).toMatchObject({ outcome: 'rescheduled' });
      expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
    } finally {
      clearUnhealthy(providerB.id, 'branch-b');
    }
  });

  it('successor cooled mid-turn: settles the original failure instead of retrying', async () => {
    const { session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    // eslint-disable-next-line require-yield -- simulates a provider failure before any event
    mockQuery.mockImplementationOnce(async function* () {
      // The authorized successor cools between preparation and failure.
      markUnhealthy(providerB.id, 'branch-b');
      throw new Error(QUOTA_ERROR_MESSAGE);
    });

    try {
      const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
      expect(failoverEvents()).toHaveLength(0);
      expect(result).toMatchObject({ outcome: 'rescheduled' });
      expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
    } finally {
      clearUnhealthy(providerB.id, 'branch-b');
    }
  });

  it('unliftable successor (gemini): treated as no successor, reschedule path kept', async () => {
    const googleProvider = modelProviders.create({ name: 'Branch Edge Google', kind: 'google' });
    modelProviders.addModel(googleProvider.id, { modelId: 'branch-gemini', displayName: 'Branch Gemini' });
    const { session, conversationId } = createSession(
      [
        { providerId: providerA.id, modelId: 'branch-a', position: 0 },
        { providerId: googleProvider.id, modelId: 'branch-gemini', position: 1 },
      ],
      { modelId: 'branch-a', providerId: providerA.id }
    );
    mockQuery.mockImplementationOnce(quotaFailureScript());

    try {
      const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

      // The gemini member never dispatches (no cross-kind lift): one attempt,
      // then the existing reschedule path with no failover event.
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-a');
      expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
      expect(failoverEvents()).toHaveLength(0);
      expect(result).toMatchObject({ outcome: 'rescheduled' });
    } finally {
      clearUnhealthy(googleProvider.id, 'branch-gemini');
    }
  });

  it('user stop wins: no retry, no cooling, no reschedule', async () => {
    const { session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    // eslint-disable-next-line require-yield -- simulates a provider failure before any event
    mockQuery.mockImplementationOnce(async function* () {
      // Abort the turn's own controller before failing with an otherwise
      // eligible error: the abort must win over the retry.
      abortForUserStop(activeSessions.get(session.id)?.controller);
      throw new Error(QUOTA_ERROR_MESSAGE);
    });

    await expect(continueSessionWithExistingMessage(session.id, conversationId, tempDir, {})).rejects.toThrow();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRescheduleSession).not.toHaveBeenCalled();
    expect(failoverEvents()).toHaveLength(0);
    // A Stop-aborted attempt never cools, even for an eligible error.
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(false);
  });

  it('three-member chain: §5.1 advance then same-turn retry across two switches', async () => {
    modelProviders.addModel(providerB.id, { modelId: 'branch-c', displayName: 'Branch C' });
    const { session, conversationId } = createSession(
      [
        { providerId: providerA.id, modelId: 'branch-a', position: 0 },
        { providerId: providerB.id, modelId: 'branch-b', position: 1 },
        { providerId: providerB.id, modelId: 'branch-c', position: 2 },
      ],
      { modelId: 'branch-a', providerId: providerA.id }
    );
    // The snapshot member pre-cooled: §5.1 advances this turn onto branch-b.
    markUnhealthy(providerA.id, 'branch-a');
    mockQuery
      .mockImplementationOnce(quotaFailureScript())
      .mockImplementation(successScript());

    try {
      await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

      // Advance (a→b) then retry (b→c): exactly two dispatches, loop bounded.
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-b');
      expect(mockQuery.mock.calls[1][0].options?.model).toBe('branch-c');
      expect(mockRescheduleSession).not.toHaveBeenCalled();
      expect(sessions.getById(session.id).resolvedModel).toBe('branch-c');

      const events = failoverEvents();
      expect(events).toHaveLength(2);
      expect(events[0][2]).toMatchObject({ fromModel: 'branch-a', toModel: 'branch-b' });
      expect(events[1][2]).toMatchObject({ fromModel: 'branch-b', toModel: 'branch-c' });

      // Cooling follows the dispatched member (branch-b ran and failed), and
      // the retry carries the boundary marker.
      expect(isUnhealthy(providerB.id, 'branch-b')).toBe(true);
      expect(mockQuery.mock.calls[1][0].prompt).toContain('<tier_failover_boundary>');
    } finally {
      clearUnhealthy(providerA.id, 'branch-a');
      clearUnhealthy(providerB.id, 'branch-b');
      clearUnhealthy(providerB.id, 'branch-c');
    }
  });

  it('mid-turn tier edit: retry that cannot re-resolve settles instead of wedging', async () => {
    const { tier, session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    mockQuery.mockImplementationOnce(quotaFailureScript());

    // Structural tier edit landing strictly between arming the retry and the
    // second attempt's live re-resolution: member 1 is removed while member 0
    // is freshly cooled, so the retry cannot land anywhere healthy. Hooked on
    // the arm-time running-status broadcast — the same seam the new-message
    // mid-turn-edit test uses.
    let runningBroadcasts = 0;
    vi.mocked(broadcastSessionStatus).mockImplementation((...args) => {
      if (args[0] === session.id && args[1] === 'running' && ++runningBroadcasts === 2) {
        modelTiers.update(tier.id, {
          members: [{ providerId: providerA.id, modelId: 'branch-a', position: 0 }],
        });
      }
    });

    try {
      const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});

      // The turn ends visibly through the normal failure path: exactly one
      // provider dispatch, one reschedule decision, no failover event.
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
      expect(failoverEvents()).toHaveLength(0);
      expect(result).toMatchObject({ outcome: 'rescheduled' });
      expect(isUnhealthy(providerA.id, 'branch-a')).toBe(true);
    } finally {
      vi.mocked(broadcastSessionStatus).mockReset();
    }
  });

  it('explicit concrete-model override runs tier-free (no retry, no cooling, no event)', async () => {
    const { session, conversationId } = createSession(
      twoMembers(), { modelId: 'branch-a', providerId: providerA.id }
    );
    mockQuery.mockImplementationOnce(quotaFailureScript());

    const result = await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {
      model: 'branch-b', providerId: providerB.id,
    });

    // Dispatched on the hand-picked member, then failed through the normal
    // path — the tier never cools a member it did not choose and never emits.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].options?.model).toBe('branch-b');
    expect(mockRescheduleSession).toHaveBeenCalledTimes(1);
    expect(failoverEvents()).toHaveLength(0);
    expect(isUnhealthy(providerA.id, 'branch-a')).toBe(false);
    expect(isUnhealthy(providerB.id, 'branch-b')).toBe(false);
    expect(result).toMatchObject({ outcome: 'rescheduled' });
  });
});
