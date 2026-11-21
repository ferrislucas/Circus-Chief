import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { projects, sessions, messages, conversations, modelTiers, modelProviders } from '../database.js';
import { buildTierRef } from '@circuschief/shared';
import { markUnhealthy, clearUnhealthy } from './tierResolutionService.js';
import { abortForUserStop } from './sessionAbort.js';

const dispatched = [];
let executeScript = [];

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('./sessionExecution.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    _executeSession: vi.fn(async ({ queryParams, tierContext, agentCallMeta, controller }) => {
      const step = executeScript[dispatched.length];
      dispatched.push({ queryParams, tierContext, agentCallMeta, controller });
      if (step?.abortController) abortForUserStop(controller);
      if (step?.error) throw step.error;
      return undefined;
    }),
    createAgentForSession: vi.fn(() => ({
      needsConversationContext: () => false,
      supportsResume: () => true,
    })),
    buildAgentEnv: vi.fn((env) => env),
  };
});

vi.mock('./sessionErrors.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, shouldRescheduleOnError: vi.fn(() => false) };
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
  return { ...original, broadcastSessionStatus: vi.fn() };
});

vi.mock('./workflowSessionService.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, activeLaneRunOwnsSession: vi.fn(() => true) };
});

import { buildContinueModelAndEnv } from './sessionContinueDispatch.js';
import { continueSessionCore } from './sessionContinuation.js';
import { createAgentForSession } from './sessionExecution.js';
import { activeSessions } from './sessionExecutionOwnership.js';

const SOL = 'gpt-6.1-sol';
const FLASH = 'GLM-5.3-Flash';
const GLM = 'GLM-5.3';
const GEMINI = 'gemini-follow-up';

const noop = vi.fn();
const mockCallbacks = {
  handleTemplateTriggerIfNeeded: noop,
  handleAutoSendIfNeeded: noop,
};

describe('sessionContinueDispatch — explicit follow-up kind switch', () => {
  let project;
  let openai;
  let zai;
  let google;
  let tier;

  beforeEach(() => {
    dispatched.length = 0;
    executeScript = [];
    vi.clearAllMocks();
    activeSessions.clear();

    project = projects.create('Follow-up Kind Project', '/tmp/follow-up-kind');
    openai = modelProviders.create({ name: 'OpenAI Follow-up', kind: 'openai' });
    modelProviders.addModel(openai.id, { modelId: SOL, displayName: 'Sol' });
    zai = modelProviders.create({ name: 'Z.ai Follow-up', kind: 'anthropic' });
    modelProviders.addModel(zai.id, { modelId: FLASH, displayName: 'Flash' });
    modelProviders.addModel(zai.id, { modelId: GLM, displayName: 'GLM' });
    google = modelProviders.create({ name: 'Google Follow-up', kind: 'google' });
    modelProviders.addModel(google.id, { modelId: GEMINI, displayName: 'Gemini' });
    tier = modelTiers.create({
      name: 'High Follow-up',
      members: [
        { providerId: openai.id, modelId: SOL, position: 0 },
        { providerId: zai.id, modelId: GLM, position: 1 },
      ],
      autoFailoverEnabled: true,
    });
  });

  afterEach(() => {
    clearUnhealthy(openai.id, SOL);
    try { modelTiers.delete(tier.id); } catch { /* noop */ }
    try { modelProviders.delete(google.id); } catch { /* noop */ }
    try { modelProviders.delete(zai.id); } catch { /* noop */ }
    try { modelProviders.delete(openai.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  function createCodexTierSession() {
    const row = sessions.create(project.id, 'Review session', 'Review the PR', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: buildTierRef(tier.id),
      agentType: 'codex',
      resolvedModel: SOL,
      resolvedProviderId: openai.id,
      lastExecutedModel: SOL,
      lastExecutedProviderId: openai.id,
    });
    const conv = conversations.ensureActiveConversation(row.id);
    conversations.update(conv.id, { claudeSessionId: 'sol-thread' });
    messages.create(row.id, 'user', 'Review the PR', { conversationId: conv.id });
    messages.create(row.id, 'assistant', 'Found one issue', { conversationId: conv.id });
    return sessions.getById(row.id);
  }

  function binding(session) {
    const row = sessions.getById(session.id);
    return {
      model: row.model,
      providerId: row.providerId,
      resolvedModel: row.resolvedModel,
      resolvedProviderId: row.resolvedProviderId,
      lastExecutedModel: row.lastExecutedModel,
      agentType: row.agentType,
      resumeId: conversations.getActiveBySessionId(session.id)?.claudeSessionId ?? null,
    };
  }

  it('retargets an interactive concrete cross-kind follow-up and clears the resume chain', async () => {
    const session = createCodexTierSession();

    await continueSessionCore(session.id, 'Walk me through it', '/tmp/test', {
      options: { model: FLASH, providerId: zai.id, interactive: true },
      callbacks: mockCallbacks,
    });

    expect(createAgentForSession).toHaveBeenCalled();
    expect(createAgentForSession.mock.calls[0][0]).toBe('claude-code');
    const row = sessions.getById(session.id);
    expect(row.agentType).toBe('claude-code');
    expect(row.model).toBe(FLASH);
    expect(row.providerId).toBe(zai.id);
    expect(row.resolvedModel).toBeNull();
    expect(row.resolvedProviderId).toBeNull();
    expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBeNull();
  });

  it('rejects a non-interactive concrete cross-kind follow-up before any write', async () => {
    const session = createCodexTierSession();
    const before = binding(session);

    await expect(continueSessionCore(session.id, 'background', '/tmp/test', {
      options: { model: FLASH, providerId: zai.id, interactive: false },
      callbacks: mockCallbacks,
    })).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(createAgentForSession).not.toHaveBeenCalled();
    expect(binding(session)).toEqual(before);
  });

  it('rejects gemini and a tier-ref kind change before any write', async () => {
    const session = createCodexTierSession();
    const before = binding(session);
    const claudeTier = modelTiers.create({
      name: 'Claude-only tier',
      members: [{ providerId: zai.id, modelId: GLM, position: 0 }],
    });

    expect(() => buildContinueModelAndEnv(session, session.id, GEMINI, {
      providerId: google.id, interactive: true,
    })).toThrow(expect.objectContaining({ code: 'CROSS_KIND_MODEL_SWITCH' }));

    expect(() => buildContinueModelAndEnv(session, session.id, buildTierRef(claudeTier.id), {
      interactive: true,
    })).toThrow(expect.objectContaining({ code: 'CROSS_KIND_MODEL_SWITCH' }));

    expect(binding(session)).toEqual(before);
    try { modelTiers.delete(claudeTier.id); } catch { /* noop */ }
  });

  it('rejects a provider-only cross-kind rebind before any write', () => {
    modelProviders.addModel(zai.id, { modelId: SOL, displayName: 'Sol on Z.ai' });
    const row = sessions.create(project.id, 'Concrete codex', 'prompt', 'standard');
    sessions.update(row.id, {
      status: 'waiting',
      model: SOL,
      providerId: openai.id,
      agentType: 'codex',
    });
    const session = sessions.getById(row.id);
    const before = binding(session);

    expect(() => buildContinueModelAndEnv(session, session.id, SOL, {
      providerId: zai.id, interactive: true,
    })).toThrow(expect.objectContaining({ code: 'CROSS_KIND_MODEL_SWITCH' }));

    expect(binding(session)).toEqual(before);
  });

  it('keeps the High snapshot when the follow-up names no model', () => {
    const session = createCodexTierSession();
    const { effectiveModel, session: updated } = buildContinueModelAndEnv(session, session.id, null, {
      interactive: true,
    });

    expect(effectiveModel).toBe(SOL);
    expect(updated.agentType).toBe('codex');
    expect(updated.resolvedModel).toBe(SOL);
    expect(updated.resolvedProviderId).toBe(openai.id);
    expect(updated.model).toBe(buildTierRef(tier.id));
    expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('sol-thread');
  });

  it('still retargets an own-binding advance off a cooled snapshot', () => {
    const session = createCodexTierSession();
    markUnhealthy(openai.id, SOL);

    const { effectiveModel, session: updated } = buildContinueModelAndEnv(session, session.id, null, {
      interactive: true,
    });

    expect(effectiveModel).toBe(GLM);
    expect(updated.agentType).toBe('claude-code');
    expect(updated.model).toBe(buildTierRef(tier.id));
    expect(updated.resolvedModel).toBe(GLM);
    expect(updated.resolvedProviderId).toBe(zai.id);
  });
});
