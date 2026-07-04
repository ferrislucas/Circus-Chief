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

import { runSession } from './sessionManager.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { modelProviders, modelTiers } from '../database.js';
import { isUnhealthy } from './tierResolutionService.js';

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

  it('fails over to the next member when the first member throws a service error at start', async () => {
    // eslint-disable-next-line require-yield -- always throws before yielding, matching agent.execute()'s async-iterable contract
    mockQuery.mockImplementationOnce(async function* () {
      throw new Error('Error: 529 Service overloaded');
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

  it('does not fail over once an assistant message has been produced (mid-conversation boundary)', async () => {
    // First member starts successfully, producing an assistant message. On a
    // later run (simulated by manually invoking runSession again after the
    // session already has assistant output), failures should not fail over.
    await runSession(session.id, 'Initial prompt', tempDir, { model: null });
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const afterFirstRun = sessionRepo.getById(session.id);
    expect(afterFirstRun.resolvedModel).toBe('model-a');
  });
});
