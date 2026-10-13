import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runSession } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';

import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { sessions, modelProviders } from '../database.js';

// ── Provider-boundary dispatch fence (kanban pause Fence 2) ────────────────
// runSession must consult `beforeProviderExecute` after ALL async turn setup
// (model/env resolution, worktree hooks) and immediately before the first
// `agent.execute` pull, and must release `onProviderDispatchInitiated` at
// that same boundary. A rejection from the hook (e.g. lane automation
// disabled mid-setup) must prevent any adapter invocation and propagate to
// the caller — never be converted into a successful or failed turn.

function stubCodexAgent(executeImpl) {
  return {
    execute: vi.fn(executeImpl),
    supportsResume: () => false,
    needsConversationContext: () => false,
  };
}

function successfulCodexStream() {
  return stubCodexAgent(async function* () {
    yield { type: 'assistant', text: 'reply' };
    yield { type: 'result', success: true };
  });
}

describe('runSession provider-boundary dispatch fence', () => {
  let sessionRepo;
  let projectRepo;
  let tempDir;
  let openaiProvider;

  beforeEach(() => {
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'provider-boundary-test-'));
    openaiProvider = modelProviders.create({
      name: 'Boundary OpenAI Provider',
      baseUrl: 'https://api.openai.boundary',
      authToken: 'key-boundary',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'gpt-4o-boundary',
      displayName: 'GPT-4o Boundary',
      tier: 'custom',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createCodexSession() {
    const project = projectRepo.create('Boundary Project', tempDir);
    return {
      project,
      session: sessionRepo.create(project.id, 'Boundary Session', 'initial prompt', {
        agentType: 'codex',
        model: 'gpt-4o-boundary',
      }),
    };
  }

  it('never invokes the adapter when beforeProviderExecute rejects, and propagates the rejection', async () => {
    const agent = successfulCodexStream();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);
    const { session } = createCodexSession();
    const fenceError = new Error('Lane automation was disabled during entry dispatch');
    fenceError.code = 'LANE_AUTOMATION_DISABLED';

    await expect(runSession(session.id, 'initial prompt', tempDir, {
      model: 'gpt-4o-boundary',
      beforeProviderExecute: async () => { throw fenceError; },
    })).rejects.toBe(fenceError);

    expect(agent.execute).not.toHaveBeenCalled();
    createAgentSpy.mockRestore();
  });

  it('runs the fence after turn setup and releases dispatch initiation immediately before adapter invocation', async () => {
    const agent = successfulCodexStream();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);
    const { session } = createCodexSession();
    const order = [];

    await runSession(session.id, 'initial prompt', tempDir, {
      model: 'gpt-4o-boundary',
      beforeProviderExecute: async () => {
        // Turn setup has fully completed by the time the fence runs: the
        // session already transitioned to running during prepareRunTurn.
        order.push(`fence(status=${sessions.getById(session.id).status})`);
      },
      onProviderDispatchInitiated: () => { order.push('dispatch-initiated'); },
    });

    expect(agent.execute).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('fence(status=running)');
    expect(order[1]).toBe('dispatch-initiated');
    createAgentSpy.mockRestore();
  });

  it('still dispatches normally when no fence hooks are provided', async () => {
    const agent = successfulCodexStream();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);
    const { session } = createCodexSession();

    await runSession(session.id, 'initial prompt', tempDir, { model: 'gpt-4o-boundary' });

    expect(agent.execute).toHaveBeenCalledTimes(1);
    createAgentSpy.mockRestore();
  });
});
