import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildTierRef } from '@circuschief/shared';

// Mock the SDK to prevent real API calls — capture queryParams for assertions
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'claude-haiku-4-5-20251001', slash_commands: [] };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
    yield { type: 'result', subtype: 'success' };
  }),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

// Mock the WebSocket layer so Fix 6's stale-tier notice can be asserted
// without needing a real connected socket. Every other test in this file
// only relies on runSession completing — none inspect WS traffic — so this
// is a behavior-neutral swap-in.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { runSession } from './sessionManager.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { modelProviders, modelTiers, agentCallLogs, workLogs } from '../database.js';
import { isUnhealthy, markUnhealthy } from './tierResolutionService.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { BaseAgent } from '../agents/BaseAgent.js';
import { CodexAdapter } from '../agents/adapters/CodexAdapter.js';
import { broadcastToSession } from '../websocket.js';
import { resolveTierRefForContinueWithStaleFallback, sanitizeTierFailureReason } from './sessionTierFailover.js';

describe('sanitizeTierFailureReason', () => {
  it('bounds and redacts credential-like values before outward reporting', () => {
    const reason = sanitizeTierFailureReason(new Error(
      'Provider rejected request: authorization=Bearer secret-token api_key=sk-super-secret\nretry later'
    ));

    expect(reason).toContain('[redacted]');
    expect(reason).not.toContain('secret-token');
    expect(reason).not.toContain('sk-super-secret');
    expect(reason).not.toContain('\n');
  });
});

describe('runSessionCore tier failover (integration)', () => {
  let sessionRepo;
  let projectRepo;
  let session;
  let tempDir;
  let providerA;
  let providerB;
  let tier;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'claude-haiku-4-5-20251001', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'tier-failover-test-'));
    const project = projectRepo.create('Test Project', tempDir);

    providerA = modelProviders.create({ name: 'Tier Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Tier Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
    modelProviders.addModel(providerB.id, { modelId: 'model-b', displayName: 'Model B' });

    tier = modelTiers.create({
      name: 'Test Tier',
      members: [
        { providerId: providerA.id, modelId: 'model-a', position: 0 },
        { providerId: providerB.id, modelId: 'model-b', position: 1 },
      ],
    });

    session = sessionRepo.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('starts on the first member when it is healthy', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const updated = sessionRepo.getById(session.id);
    expect(updated.model).toBe(buildTierRef(tier.id));
    expect(updated.resolvedModel).toBe('model-a');
    expect(updated.resolvedProviderId).toBe(providerA.id);
  });

  it('fails over to the next member for a status-only SDK error at start', async () => {
    // eslint-disable-next-line require-yield -- always throws before yielding, matching agent.execute()'s async-iterable contract
    mockQuery.mockImplementationOnce(async function* () {
      throw Object.assign(new Error('Request failed'), { status: 503 });
    });

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const updated = sessionRepo.getById(session.id);
    // The tier ref is preserved as the session's model (not the concrete member)
    expect(updated.model).toBe(buildTierRef(tier.id));
    expect(updated.resolvedModel).toBe('model-b');
    expect(updated.resolvedProviderId).toBe(providerB.id);
    // Should not be left in an error state after a successful failover
    expect(updated.status).not.toBe('error');

    // First member should now be in cooldown
    expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);

    // Regression: the broadcast payload must carry `sessionId` — the web
    // client's onTierFailover handler filters every incoming message on
    // `msg.sessionId === sessionId` (useSessionSubscription.js), so omitting
    // it silently drops the notice client-side even though the server "sent"
    // it (a real bug the scripted E2E failover suite caught — see
    // model-tiers-e2e-coverage-plan.md Phase 2).
    const failoverBroadcast = broadcastToSession.mock.calls.find((call) => call[1] === 'tier:failover');
    expect(failoverBroadcast[2].sessionId).toBe(session.id);
  });

  it('fails over when a retryable provider failure arrives as result:error', async () => {
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'failed-stream', model: 'model-a', slash_commands: [] };
      yield { type: 'result', subtype: 'error', error: 'Rate limit exceeded' };
    });

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(isUnhealthy(providerA.id, 'model-a')).toBe(true);

    const updated = sessionRepo.getById(session.id);
    expect(updated.status).not.toBe('error');
    expect(updated.error).toBeFalsy();
    expect(updated.resolvedModel).toBe('model-b');
    expect(updated.resolvedProviderId).toBe(providerB.id);

    // The failed attempt is transparent: only the tier-failover notice is
    // emitted, never a terminal session error / visible error message.
    expect(broadcastToSession.mock.calls.some((call) => call[1] === 'session:error')).toBe(false);
    expect(broadcastToSession.mock.calls.some((call) => call[1] === 'tier:failover')).toBe(true);
  });

  it.each([
    ['a thrown structured error', () =>
      // eslint-disable-next-line require-yield -- simulates an SDK failure before the first provider event
      async function* () {
        throw Object.assign(new Error('Internal server error'), { status: 500 });
      }],
    ['a streamed result:error', () => async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'generic-500-stream', model: 'model-a', slash_commands: [] };
      yield { type: 'result', subtype: 'error', error: { message: 'Internal server error' }, status: 500 };
    }],
  ])('retains a generic HTTP 500 from %s instead of failing over', async (_shape, providerFailure) => {
    mockQuery.mockImplementationOnce(providerFailure());
    const failoverCountBefore = broadcastToSession.mock.calls
      .filter((call) => call[1] === 'tier:failover').length;

    const failure = await runSession(session.id, 'Initial prompt', tempDir, { model: null })
      .then(() => null, error => error);

    expect(failure).toMatchObject({ message: 'Internal server error' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
    expect(broadcastToSession.mock.calls.filter((call) => call[1] === 'tier:failover')).toHaveLength(failoverCountBefore);
  });

  it('exhausts the tier when the final member reports result:error without snapshotting it', async () => {
    mockQuery.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'failed-stream', model: 'model-a', slash_commands: [] };
      yield { type: 'result', subtype: 'error', error: 'Rate limit exceeded' };
    });

    const failure = await runSession(session.id, 'Initial prompt', tempDir, { model: null })
      .then(() => null, (error) => error);

    expect(failure).toMatchObject({
      name: 'ModelTierExhaustedError',
      code: 'MODEL_TIER_EXHAUSTED',
      attempts: [
        { providerId: providerA.id, modelId: 'model-a', reason: 'Rate limit exceeded' },
        { providerId: providerB.id, modelId: 'model-b', reason: 'Rate limit exceeded' },
      ],
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBeFalsy();
    expect(updated.resolvedProviderId).toBeFalsy();
    expect(updated.status).toBe('error');
  });

  it('marks the failed member unhealthy so a subsequent session start skips it', async () => {
    // eslint-disable-next-line require-yield -- always throws before yielding, matching agent.execute()'s async-iterable contract
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });
    mockQuery.mockClear();

    // Start a second session bound to the same tier — should skip the cooled-down
    // member A entirely and go straight to member B.
    const project = { id: session.projectId };
    const session2 = sessionRepo.create(project.id, 'Second Session', 'Second prompt', 'standard');
    sessionRepo.update(session2.id, { model: buildTierRef(tier.id) });

    await runSession(session2.id, 'Second prompt', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const updated = sessionRepo.getById(session2.id);
    expect(updated.resolvedModel).toBe('model-b');
  });

  it('throws when all members are exhausted at start (no silent hang)', async () => {
    // eslint-disable-next-line require-yield -- always throws before yielding, matching agent.execute()'s async-iterable contract
    mockQuery.mockImplementation(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/529/);

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const updated = sessionRepo.getById(session.id);
    // Existing error path applies when the whole tier is exhausted
    expect(updated.status).toBe('error');
  });

  it('does not fail over on a non-eligible error (e.g. auth failure)', async () => {
    // eslint-disable-next-line require-yield -- always throws before yielding, matching agent.execute()'s async-iterable contract
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Invalid API key provided');
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/Invalid API key/);

    // Should not have attempted member B
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Member A should NOT be marked unhealthy (non-eligible errors don't trigger cooldown)
    expect(isUnhealthy(providerA.id, 'model-a')).toBe(false);
  });

  it('does not fail over after a tool use is persisted before an eligible provider failure', async () => {
    broadcastToSession.mockClear();
    const attemptedModels = [];
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'tool-use-session', model: 'model-a', slash_commands: [] };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } }] },
      };
      throw new Error('Error: 529 Service overloaded');
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/529 Service overloaded/);

    // The prompt must never be replayed on a later tier member after the tool
    // call has been persisted as observable agent activity.
    for (const [queryParams] of mockQuery.mock.calls) {
      if (queryParams.options?.model) attemptedModels.push(queryParams.options.model);
    }
    expect(attemptedModels).not.toContain('model-b');
    expect(workLogs.getBySessionId(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_input', toolName: 'Read' }),
    ]));
    expect(broadcastToSession.mock.calls.some((call) => call[1] === 'tier:failover')).toBe(false);
  });

  it('does not fail over after a tool use before a streamed eligible provider failure', async () => {
    broadcastToSession.mockClear();
    const attemptedModels = [];
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'tool-result-error-session', model: 'model-a', slash_commands: [] };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'pwd' } }] },
      };
      yield { type: 'result', subtype: 'error', error: 'Rate limit exceeded' };
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/Rate limit exceeded/);

    for (const [queryParams] of mockQuery.mock.calls) {
      if (queryParams.options?.model) attemptedModels.push(queryParams.options.model);
    }
    expect(attemptedModels).not.toContain('model-b');
    expect(broadcastToSession.mock.calls.some((call) => call[1] === 'tier:failover')).toBe(false);
  });

  it('does not fail over after textual assistant output before an eligible provider failure', async () => {
    broadcastToSession.mockClear();
    const attemptedModels = [];
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'text-session', model: 'model-a', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'I started the task.' }] } };
      throw new Error('Error: 529 Service overloaded');
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/529 Service overloaded/);

    for (const [queryParams] of mockQuery.mock.calls) {
      if (queryParams.options?.model) attemptedModels.push(queryParams.options.model);
    }
    expect(attemptedModels).not.toContain('model-b');
    expect(broadcastToSession.mock.calls.some((call) => call[1] === 'tier:failover')).toBe(false);
  });

  // Fix 5: terminal-member + auto-reschedule — resolvedModel must NOT be set
  it('does not snapshot resolvedModel when the session was rescheduled (Fix 5)', async () => {
    // Scenario: single-member tier, auto-reschedule enabled.
    // The only member fails at start with a service error. Because there is no
    // next healthy member, the error is NOT tier-failover-eligible (there's
    // nothing to advance to). shouldRescheduleOnError returns true, so
    // _executeSession reschedules the session and returns normally — without
    // throwing. The failover loop must detect the 'scheduled' status and skip
    // the resolvedModel snapshot.

    // Create a single-member tier
    const singleMemberTier = modelTiers.create({
      name: 'Single',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    });

    // Enable auto-reschedule on the session
    sessionRepo.update(session.id, {
      model: buildTierRef(singleMemberTier.id),
      autoRescheduleEnabled: true,
      rescheduleOnServiceError: true,
    });

    // Agent throws a service error immediately (no assistant output)
    // eslint-disable-next-line require-yield -- always throws before yielding
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    // Run the session — it should end up in 'scheduled' status (rescheduled),
    // not throw and not snapshot resolvedModel to the failed member.
    // It may throw if reschedule is not enabled in the test DB; catch either.
    try {
      await runSession(session.id, 'Initial prompt', tempDir, { model: null });
    } catch (_err) {
      // Acceptable: exhausted tier error propagates when reschedule is disabled
      // in the test environment. The assertion below is what matters.
    }

    const updated = sessionRepo.getById(session.id);
    // resolvedModel must NOT be set to the failed member
    // (either null from initialization or 'scheduled' state)
    if (updated.status === 'scheduled') {
      expect(updated.resolvedModel).not.toBe('model-a');
    } else {
      // Non-reschedule path: the session errored — resolvedModel should be null/undefined
      expect(updated.resolvedModel == null || updated.resolvedModel !== 'model-a').toBe(true);
    }
  });

  // Work Item 1: an ordered tier is exhausted before failure — no arbitrary
  // attempt cap. A member beyond position ten can still succeed, and an
  // >10-member tier that fully fails only reaches terminal error status
  // after every eligible member has actually been attempted.
  it('succeeds on an eligible member beyond position ten, attempting every prior member exactly once in order', async () => {
    const members = [];
    for (let i = 0; i < 11; i++) {
      const provider = modelProviders.create({ name: `Big Provider ${i}`, kind: 'anthropic' });
      modelProviders.addModel(provider.id, { modelId: `big-model-${i}`, displayName: `Big Model ${i}` });
      members.push({ providerId: provider.id, modelId: `big-model-${i}`, position: i });
    }
    const bigTier = modelTiers.create({ name: 'Big Tier', members });
    sessionRepo.update(session.id, { model: buildTierRef(bigTier.id) });

    const attemptedProviderIds = [];
    let callCount = 0;
    mockQuery.mockImplementation(async function* () {
      attemptedProviderIds.push(members[callCount].providerId);
      callCount++;
      if (callCount <= 10) {
        throw new Error('Error: 529 Service overloaded');
      }
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'big-model-10', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Eleventh response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    // All eleven members were attempted, in configured order, exactly once each.
    expect(mockQuery).toHaveBeenCalledTimes(11);
    expect(attemptedProviderIds).toEqual(members.map((m) => m.providerId));

    const updated = sessionRepo.getById(session.id);
    expect(updated.model).toBe(buildTierRef(bigTier.id));
    expect(updated.resolvedModel).toBe('big-model-10');
    expect(updated.resolvedProviderId).toBe(members[10].providerId);
    expect(updated.status).not.toBe('error');
  });

  it('reaches terminal error status only after every member of an >10-member tier has been attempted', async () => {
    const members = [];
    for (let i = 0; i < 12; i++) {
      const provider = modelProviders.create({ name: `Exhaust Provider ${i}`, kind: 'anthropic' });
      modelProviders.addModel(provider.id, { modelId: `exhaust-model-${i}`, displayName: `Exhaust Model ${i}` });
      members.push({ providerId: provider.id, modelId: `exhaust-model-${i}`, position: i });
    }
    const exhaustTier = modelTiers.create({ name: 'Exhaust Tier', members });
    sessionRepo.update(session.id, { model: buildTierRef(exhaustTier.id) });

    // eslint-disable-next-line require-yield -- always throws before yielding
    mockQuery.mockImplementation(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    await expect(
      runSession(session.id, 'Initial prompt', tempDir, { model: null })
    ).rejects.toThrow(/529/);

    // Every eligible member was attempted — no silent hang, no arbitrary cap.
    expect(mockQuery).toHaveBeenCalledTimes(12);

    const updated = sessionRepo.getById(session.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('529');
  });

  it("skips a cooled-down member without consuming a later member's turn", async () => {
    // Pre-cool member A (position 0) so the loop must skip straight to B.
    const { markUnhealthy: markUnhealthyDirect } = await import('./tierResolutionService.js');
    markUnhealthyDirect(providerA.id, 'model-a');

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    // Only B was attempted — the cooldown skip did not consume an attempt
    // that would otherwise have been available to a later member.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBe('model-b');
    expect(updated.resolvedProviderId).toBe(providerB.id);
  });
});

// ── Fix 2: successor-aware cooldown ──────────────────────────────────────────

describe('handleTierMemberFailure cooldown', () => {
  let sessionRepo;
  let projectRepo;
  let session;
  let tempDir;
  let providerA;
  let providerB;
  let tier;

  beforeEach(() => {
    mockQuery.mockReset();
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'fix2-cooldown-test-'));
    const project = projectRepo.create('Fix2 Project', tempDir);

    providerA = modelProviders.create({ name: 'Fix2 Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Fix2 Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'fix2-model-a', displayName: 'Fix2 Model A' });
    modelProviders.addModel(providerB.id, { modelId: 'fix2-model-b', displayName: 'Fix2 Model B' });

    tier = modelTiers.create({
      name: 'Fix2 Tier',
      members: [
        { providerId: providerA.id, modelId: 'fix2-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'fix2-model-b', position: 1 },
      ],
    });
    session = sessionRepo.create(project.id, 'Fix2 Session', 'prompt', 'standard');
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('cools down the first failing member when a successor exists (F21 still steers)', async () => {
    // A fails → B is healthy → A should be cooled, B should succeed
    // eslint-disable-next-line require-yield
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'fix2-model-b', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'B response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    await runSession(session.id, 'prompt', tempDir, { model: null });

    // A must be cooled (had a healthy successor B)
    expect(isUnhealthy(providerA.id, 'fix2-model-a')).toBe(true);
    // B ran successfully and must NOT be cooled
    expect(isUnhealthy(providerB.id, 'fix2-model-b')).toBe(false);

    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBe('fix2-model-b');
  });

  it('cools down the last failing member when no successor exists', async () => {
    // A fails → B fails (no next after B) → both should be cooled
    // eslint-disable-next-line require-yield
    mockQuery.mockImplementation(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    await expect(
      runSession(session.id, 'prompt', tempDir, { model: null })
    ).rejects.toThrow(/529/);

    // A was cooled (B was available when A failed)
    expect(isUnhealthy(providerA.id, 'fix2-model-a')).toBe(true);
    // B also failed with a retryable outage and must be cooled.
    expect(isUnhealthy(providerB.id, 'fix2-model-b')).toBe(true);

    // Fresh sessions do not immediately hammer an entirely unavailable tier.
    const { resolveActiveModel } = await import('./tierResolutionService.js');
    const resolved = resolveActiveModel(buildTierRef(tier.id), {});
    expect(resolved).toBeNull();
  });

  it('cools down a failing single-member tier', async () => {
    // Single-member tier: A fails with service error + auto-reschedule enabled.
    // The sole member must be cooled so unrelated starts do not hammer it.
    const singleTier = modelTiers.create({
      name: 'Fix2 Single',
      members: [{ providerId: providerA.id, modelId: 'fix2-model-a', position: 0 }],
    });
    const singleSession = sessionRepo.create(session.projectId, 'Fix2 Single Session', 'prompt', 'standard');
    sessionRepo.update(singleSession.id, {
      model: buildTierRef(singleTier.id),
      autoRescheduleEnabled: true,
      rescheduleOnServiceError: true,
    });

    // eslint-disable-next-line require-yield
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Error: 529 Service overloaded');
    });

    // Session is expected to be rescheduled (not throw)
    try {
      await runSession(singleSession.id, 'prompt', tempDir, { model: null });
    } catch (_err) {
      // Acceptable if reschedule is not enabled in test env; main assertion below.
    }

    expect(isUnhealthy(providerA.id, 'fix2-model-a')).toBe(true);
  });
});

// ── Fix 3: preserve resolvedModel on proactive reschedule ───────────────────

describe('runSessionWithTierFailover preserves resolvedModel on proactive reschedule (Fix 3)', () => {
  let sessionRepo;
  let projectRepo;
  let session;
  let tempDir;
  let providerA;
  let tier;

  beforeEach(() => {
    mockQuery.mockReset();
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'fix3-snapshot-test-'));
    const project = projectRepo.create('Fix3 Project', tempDir);

    providerA = modelProviders.create({ name: 'Fix3 Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'fix3-model-a', displayName: 'Fix3 Model A' });

    tier = modelTiers.create({
      name: 'Fix3 Tier',
      members: [{ providerId: providerA.id, modelId: 'fix3-model-a', position: 0 }],
    });
    session = sessionRepo.create(project.id, 'Fix3 Session', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      model: buildTierRef(tier.id),
      // Low proactive reschedule threshold so the post-turn check fires
      autoRescheduleEnabled: true,
      rescheduleAtTokenCount: 1,
    });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('snapshots resolvedModel even when the session is proactively rescheduled after a successful run', async () => {
    // Agent responds successfully but reports enough tokens to trigger the
    // proactive reschedule threshold (rescheduleAtTokenCount=1).
    mockQuery.mockImplementationOnce(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'fix3-model-a', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } };
      // Include usage so the token-count DB update fires and exceeds the threshold
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 50, output_tokens: 50 } };
    });

    await runSession(session.id, 'prompt', tempDir, { model: null });

    const updated = sessionRepo.getById(session.id);
    // The session ran (produced assistant output) — resolvedModel MUST be recorded
    // regardless of whether the session was proactively rescheduled afterwards.
    expect(updated.resolvedModel).toBe('fix3-model-a');
    expect(updated.resolvedProviderId).toBe(providerA.id);
  });
});

// ── Issue 4: failover log entry reflects the source agent type ─────────────
//
// _logFailoverEvent previously hardcoded agentType: 'claude-code' and
// success: false. When failing over *from* a Codex/Gemini member the logged
// agent type was wrong, and success:false mapped the row to status 'error'
// even though a failover that successfully advances is a benign system
// event, not a call failure.

describe('tier failover log entry reflects source agentType (Issue 4)', () => {
  let sessionRepo;
  let projectRepo;
  let session;
  let tempDir;
  let providerCodex;
  let providerClaude;
  let tier;
  let originalCodexAdapter;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'claude-model-b', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'issue4-agenttype-test-'));
    const project = projectRepo.create('Issue4 Project', tempDir);

    // First member resolves to a Codex ('openai' kind) provider — its
    // adapter is swapped below for a fake that fails deterministically
    // without spawning a real CLI process.
    providerCodex = modelProviders.create({ name: 'Issue4 Codex Provider', kind: 'openai' });
    providerClaude = modelProviders.create({ name: 'Issue4 Claude Provider', kind: 'anthropic' });
    modelProviders.addModel(providerCodex.id, { modelId: 'codex-model-a', displayName: 'Codex Model A' });
    modelProviders.addModel(providerClaude.id, { modelId: 'claude-model-b', displayName: 'Claude Model B' });

    tier = modelTiers.create({
      name: 'Issue4 Tier',
      members: [
        { providerId: providerCodex.id, modelId: 'codex-model-a', position: 0 },
        { providerId: providerClaude.id, modelId: 'claude-model-b', position: 1 },
      ],
    });

    session = sessionRepo.create(project.id, 'Issue4 Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });

    // Swap in a fake Codex adapter that fails at start with a failover-eligible
    // error, without touching a real Codex CLI process.
    originalCodexAdapter = agentGateway.adapters.get('codex');
    class FailingCodexAdapter extends BaseAgent {
      static capabilities = CodexAdapter.capabilities;
      // eslint-disable-next-line require-yield -- always throws before yielding
      async *execute() {
        throw new Error('Error: 529 Service overloaded');
      }
    }
    agentGateway.registerAdapter('codex', FailingCodexAdapter);
  });

  afterEach(() => {
    agentGateway.registerAdapter('codex', originalCodexAdapter);
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('logs the failing member\'s agentType (codex) instead of hardcoding claude-code', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    // Failed over from Codex to Claude
    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBe('claude-model-b');

    const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
    expect(rows).toHaveLength(1);
    expect(rows[0].agentType).toBe('codex');
    // A failover that successfully advances is a neutral system event, not
    // a call failure — status must not be 'error'.
    expect(rows[0].status).not.toBe('error');
    expect(rows[0].status).toBe('completed');
  });
});

// ── Fix 1 / Fix 4: provider-aware failover across a duplicate modelId ───────
//
// Two tier members can legitimately share the same `modelId` string while
// belonging to different providers/agent kinds. A plain model-id lookup
// cannot disambiguate them; the exact member's own `providerId` must be
// threaded through every step (agent-type derivation, env resolution, and
// the failover log's source agentType) or the wrong adapter/env gets used.

describe('cross-provider failover with a duplicate modelId (Fix 1 / Fix 4)', () => {
  let sessionRepo;
  let projectRepo;
  let session;
  let tempDir;
  let providerCodex;
  let providerClaude;
  let tier;
  let originalCodexAdapter;
  const sharedModelId = 'shared-model-id';

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: sharedModelId, slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'dup-model-id-test-'));
    const project = projectRepo.create('DupModel Project', tempDir);

    // Both providers register the SAME modelId string — only `providerId`
    // can tell them apart.
    providerCodex = modelProviders.create({ name: 'DupModel Codex Provider', kind: 'openai' });
    providerClaude = modelProviders.create({ name: 'DupModel Claude Provider', kind: 'anthropic' });
    modelProviders.addModel(providerCodex.id, { modelId: sharedModelId, displayName: 'Shared (Codex)' });
    modelProviders.addModel(providerClaude.id, { modelId: sharedModelId, displayName: 'Shared (Claude)' });

    tier = modelTiers.create({
      name: 'DupModel Tier',
      members: [
        { providerId: providerCodex.id, modelId: sharedModelId, position: 0 },
        { providerId: providerClaude.id, modelId: sharedModelId, position: 1 },
      ],
    });

    session = sessionRepo.create(project.id, 'DupModel Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });

    // The first member resolves to a Codex provider — fail it deterministically
    // without spawning a real CLI process.
    originalCodexAdapter = agentGateway.adapters.get('codex');
    class FailingCodexAdapter extends BaseAgent {
      static capabilities = CodexAdapter.capabilities;
      // eslint-disable-next-line require-yield -- always throws before yielding
      async *execute() {
        throw new Error('Error: 529 Service overloaded');
      }
    }
    agentGateway.registerAdapter('codex', FailingCodexAdapter);
  });

  afterEach(() => {
    agentGateway.registerAdapter('codex', originalCodexAdapter);
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves each attempt against its OWN providerId, not an ambiguous modelId lookup', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    // Failed over from the Codex member to the Claude member — both share
    // `sharedModelId`, so this only succeeds if providerId disambiguated them.
    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBe(sharedModelId);
    expect(updated.resolvedProviderId).toBe(providerClaude.id);
    // The session's agentType must reflect the member it actually SUCCEEDED
    // on (Claude), not the Codex member it failed over from.
    expect(updated.agentType).toBe('claude-code');

    // The failover log's source agentType must reflect the FAILED member
    // (Codex) — proving the codex attempt was correctly identified as codex
    // despite sharing a modelId with the claude member it advanced to.
    const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
    expect(rows).toHaveLength(1);
    expect(rows[0].agentType).toBe('codex');
  });
});

// ── Fix 6: safe degradation for stale tier refs at session start ───────────
//
// A tier ref that no longer resolves to any member (deleted, emptied, or
// every member's provider/model removed) at new/scheduled session start must
// degrade to a concrete fallback model — NOT throw outright the way a live
// "all members failed" exhaustion (S3) correctly does.

describe('stale tier ref at session start (Fix 6)', () => {
  let sessionRepo;
  let projectRepo;
  let tempDir;
  let providerA;

  beforeEach(() => {
    mockQuery.mockReset();
    broadcastToSession.mockClear();
    mockQuery.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'model-a', slash_commands: [] };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Test response' }] } };
      yield { type: 'result', subtype: 'success' };
    });

    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'fix6-stale-tier-test-'));

    providerA = modelProviders.create({ name: 'Fix6 Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to the server default when a deleted tier ref has no prior concrete snapshot', async () => {
    const project = projectRepo.create('Fix6 Project 1', tempDir);
    const tier = modelTiers.create({
      name: 'Doomed Tier',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    const session = sessionRepo.create(project.id, 'Fix6 Session 1', 'prompt', 'standard');
    sessionRepo.update(session.id, { model: tierRef, resolvedModel: null, resolvedProviderId: null });

    // The tier is deleted before the session ever starts.
    modelTiers.delete(tier.id);

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    const updated = sessionRepo.getById(session.id);
    // Degraded to the server default (null model/provider) rather than failing outright.
    expect(updated.model).toBeNull();
    expect(updated.providerId).toBeNull();
    expect(updated.resolvedModel).toBeNull();
    expect(updated.resolvedProviderId).toBeNull();
    expect(updated.status).not.toBe('error');
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // A visible notice was broadcast naming the stale tier ref.
    const failoverCalls = broadcastToSession.mock.calls.filter((call) => call[1] === 'tier:failover');
    expect(failoverCalls.length).toBeGreaterThan(0);
    expect(failoverCalls[0][2].tierRef).toBe(tierRef);
    // Regression: see the sessionId assertion above — the client-side filter
    // silently drops this notice without it.
    expect(failoverCalls[0][2].sessionId).toBe(session.id);

    // And logged.
    const { rows } = agentCallLogs.getAll({ sessionId: session.id, callType: 'tierFailover' });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.tierRef ?? tierRef).toBe(tierRef);
  });

  it('falls back to the server default when a scheduled session\'s tier was emptied of members', async () => {
    const project = projectRepo.create('Fix6 Project 2', tempDir);
    const tier = modelTiers.create({ name: 'Emptied Tier' }); // no members
    const tierRef = buildTierRef(tier.id);

    const session = sessionRepo.create(project.id, 'Fix6 Session 2', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      model: tierRef,
      resolvedModel: null,
      resolvedProviderId: null,
      status: 'scheduled',
    });

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    const updated = sessionRepo.getById(session.id);
    expect(updated.model).toBeNull();
    expect(updated.status).not.toBe('error');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('continues using the last resolved concrete snapshot when the tier becomes stale after a prior successful run', async () => {
    const project = projectRepo.create('Fix6 Project 3', tempDir);
    const tier = modelTiers.create({
      name: 'Later Doomed Tier',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    });
    const tierRef = buildTierRef(tier.id);

    // Session already ran once and has a concrete snapshot from that run.
    const session = sessionRepo.create(project.id, 'Fix6 Session 3', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      model: tierRef,
      resolvedModel: 'model-a',
      resolvedProviderId: providerA.id,
    });

    // The tier is deleted before the NEXT start (e.g. a reschedule/new run).
    modelTiers.delete(tier.id);

    await runSession(session.id, 'Second run prompt', tempDir, { model: null });

    const updated = sessionRepo.getById(session.id);
    // Falls back to the session's OWN last-resolved snapshot, not the bare server default.
    expect(updated.model).toBe('model-a');
    expect(updated.providerId).toBe(providerA.id);
    expect(updated.status).not.toBe('error');
  });
});

describe('resolveTierRefForContinueWithStaleFallback (continuation-path degradation, PRD E3/D6)', () => {
  let sessionRepo;
  let projectRepo;
  let tempDir;
  let providerA;
  let project;

  beforeEach(() => {
    broadcastToSession.mockClear();

    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'stale-continue-test-'));

    providerA = modelProviders.create({ name: 'Stale Continue Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
    project = projectRepo.create('Stale Continue Project', tempDir);
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const tierBoundSession = ({ resolvedModel = null, resolvedProviderId = null }) => {
    const tier = modelTiers.create({
      name: 'Continue Stale Tier',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    });
    const session = sessionRepo.create(project.id, 'Stale Continue Session', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      model: buildTierRef(tier.id),
      resolvedModel,
      resolvedProviderId,
    });
    return { tier, session, freshSession: sessionRepo.getById(session.id) };
  };

  it('degrades a truly-stale binding with NO snapshot to the server default, clearing the binding', () => {
    const { tier, session, freshSession } = tierBoundSession({});
    modelTiers.delete(tier.id);

    const result = resolveTierRefForContinueWithStaleFallback(session.id, freshSession, null);

    // Degraded: the tier binding is cleared, resolution is a plain passthrough
    // on the (null) concrete model = server default.
    const updated = sessionRepo.getById(session.id);
    expect(updated.model).toBeNull();
    expect(updated.resolvedModel).toBeNull();
    expect(result.effectiveModel).toBeNull();
    expect(result.persist).toEqual({});

    // The same visible notice + sessionId the start path emits.
    const failoverCalls = broadcastToSession.mock.calls.filter((c) => c[1] === 'tier:failover');
    expect(failoverCalls.length).toBeGreaterThan(0);
    expect(failoverCalls[0][2].sessionId).toBe(session.id);
  });

  it('degrades a truly-stale binding WITH a snapshot to the snapshotted concrete model', () => {
    const { tier, session, freshSession } = tierBoundSession({
      resolvedModel: 'model-a',
      resolvedProviderId: providerA.id,
    });
    modelTiers.delete(tier.id);

    const result = resolveTierRefForContinueWithStaleFallback(session.id, freshSession, null);

    const updated = sessionRepo.getById(session.id);
    expect(updated.model).toBe('model-a');
    expect(updated.providerId).toBe(providerA.id);
    expect(result.effectiveModel).toBe('model-a');
    expect(result.providerIdHint).toBe(providerA.id);
  });

  it('degrades when the explicit request echoes session.model (the web client payload)', () => {
    const { tier, session, freshSession } = tierBoundSession({});
    const tierRef = freshSession.model;
    modelTiers.delete(tier.id);

    const result = resolveTierRefForContinueWithStaleFallback(session.id, freshSession, tierRef);

    expect(result.effectiveModel).toBeNull();
    expect(sessionRepo.getById(session.id).model).toBeNull();
  });

  it('continues structurally when all members are merely in cooldown', () => {
    const { session, freshSession } = tierBoundSession({});
    const tierRefBefore = freshSession.model;
    markUnhealthy(providerA.id, 'model-a');

    const result = resolveTierRefForContinueWithStaleFallback(session.id, freshSession, null);

    expect(result.effectiveModel).toBe('model-a');
    expect(sessionRepo.getById(session.id).model).toBe(tierRefBefore);
  });

  it('rethrows for a DIFFERENT unresolvable tier requested by the user', () => {
    const { session, freshSession } = tierBoundSession({});
    const otherTier = modelTiers.create({ name: 'Other Empty Tier', members: [] });

    expect(() =>
      resolveTierRefForContinueWithStaleFallback(session.id, freshSession, buildTierRef(otherTier.id))
    ).toThrow(/no enabled configured members/);

    // Own binding untouched.
    expect(sessionRepo.getById(session.id).model).toBe(freshSession.model);
  });

  it('returns the snapshot resolution unchanged for a healthy binding', () => {
    const { session, freshSession } = tierBoundSession({
      resolvedModel: 'model-a',
      resolvedProviderId: providerA.id,
    });

    const result = resolveTierRefForContinueWithStaleFallback(session.id, freshSession, null);

    expect(result).toEqual({
      effectiveModel: 'model-a',
      providerIdHint: providerA.id,
      persist: {},
    });
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
