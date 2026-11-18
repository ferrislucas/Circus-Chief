import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { projects, sessions, messages, conversations, modelProviders } from '../database.js';
import { activeSessions } from './sessionExecutionOwnership.js';
import { activeConversationIds } from './streamEventHandler.js';
import { broadcastToSession } from '../websocket.js';

// Mock websocket before importing the module under test
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service (execution callbacks reference it)
vi.mock('./summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
  generateSummary: vi.fn(),
}));

const mockCreateAgentForSession = vi.hoisted(() => vi.fn());
const mockExecuteSession = vi.hoisted(() => vi.fn());

// Partial mock: keep the real query-param builders, stub only adapter
// creation and turn dispatch so tests observe dispatch without spawning.
vi.mock('./sessionExecution.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAgentForSession: mockCreateAgentForSession,
    _executeSession: mockExecuteSession,
  };
});

// Import after mocking
import { continueSessionWithExistingMessage } from './sessionManager.js';

/**
 * RED (PR Review Fix #4): the branch-continue path
 * (`continueSessionWithExistingMessage` → `prepareBranchContinueTurn`)
 * must fail closed on a cross-kind `model` override with the existing
 * `CROSS_KIND_MODEL_SWITCH` semantics and mutate nothing.
 *
 * Pre-GREEN, the override is stored via `buildModelAndProvider`, the
 * adapter is built for the stale kind, and the call resolves — so the
 * rejection tests below fail while the same-kind / absent-model
 * controls pass.
 */
describe('branch-continue cross-kind guard (Fix #4)', () => {
  let project;
  let tempDir;
  let openaiProvider;
  let anthropicProvider;
  let googleProvider;
  let xaiProvider;

  const GPT_MODEL = 'gpt-branch-guard';
  const GPT_MODEL_2 = 'gpt-branch-guard-2';
  const CLAUDE_MODEL = 'claude-branch-guard';
  const GEMINI_MODEL = 'gemini-branch-guard';
  const GROK_MODEL = 'grok-branch-guard';

  function stubAgent() {
    return {
      execute: vi.fn(),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  /** Started session (≥1 assistant message) on the given kind. */
  function createStartedSession({ name, model, providerId, expectedAgentType }) {
    // Note: 'waiting'/'scheduled' sessions get no initial user message
    // (SessionRepository.create), but the branch-continue path requires one —
    // so create idle ('stopped') sessions, which do.
    const session = sessions.create(project.id, name, 'Initial prompt', {
      model,
      providerId,
      status: 'stopped',
    });
    expect(sessions.getById(session.id).agentType).toBe(expectedAgentType);
    messages.create(session.id, 'assistant', 'Prior assistant turn.');
    return sessions.getById(session.id);
  }

  function activeConversationId(sessionId) {
    return conversations.getActiveBySessionId(sessionId).id;
  }

  function snapshotRow(sessionId) {
    const s = sessions.getById(sessionId);
    return {
      model: s.model,
      agentType: s.agentType,
      providerId: s.providerId,
      pendingModel: s.pendingModel ?? null,
      status: s.status,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAgentForSession.mockImplementation(() => stubAgent());
    mockExecuteSession.mockImplementation(async () => undefined);

    tempDir = mkdtempSync(join(tmpdir(), 'branch-guard-'));
    project = projects.create('Branch Guard Project', tempDir);

    openaiProvider = modelProviders.create({
      name: 'OpenAI Branch Guard', baseUrl: 'https://api.openai.branch', authToken: 'key-o-branch', kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL, displayName: 'GPT Branch', tier: 'custom' });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL_2, displayName: 'GPT Branch 2', tier: 'custom' });

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Branch Guard', baseUrl: 'https://api.anthropic.branch', authToken: 'key-a-branch', kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_MODEL, displayName: 'Claude Branch', tier: 'opus' });

    googleProvider = modelProviders.create({
      name: 'Google Branch Guard', baseUrl: 'https://generativelanguage.branch', authToken: 'key-g-branch', kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, { modelId: GEMINI_MODEL, displayName: 'Gemini Branch', tier: 'custom' });

    xaiProvider = modelProviders.create({
      name: 'xAI Branch Guard', baseUrl: null, authToken: null, kind: 'xai',
    });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_MODEL, displayName: 'Grok Branch', tier: 'custom' });
  });

  afterEach(() => {
    activeSessions.clear();
    for (const s of sessions.getByProjectId(project.id)) {
      for (const m of messages.getBySessionId(s.id)) messages.delete(m.id);
      for (const c of conversations.getBySessionId(s.id)) conversations.delete(c.id);
      sessions.delete(s.id);
    }
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(xaiProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('codex session + claude model → CROSS_KIND_MODEL_SWITCH, zero mutation, no adapter turn', async () => {
    const session = createStartedSession({
      name: 'Codex Started', model: GPT_MODEL, providerId: openaiProvider.id, expectedAgentType: 'codex',
    });
    const before = snapshotRow(session.id);

    await expect(
      continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: CLAUDE_MODEL }),
    ).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(snapshotRow(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('claude session + codex model → CROSS_KIND_MODEL_SWITCH, zero mutation, no adapter turn', async () => {
    const session = createStartedSession({
      name: 'Claude Started', model: CLAUDE_MODEL, providerId: anthropicProvider.id, expectedAgentType: 'claude-code',
    });
    const before = snapshotRow(session.id);

    await expect(
      continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: GPT_MODEL }),
    ).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(snapshotRow(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('codex session + gemini model → CROSS_KIND_MODEL_SWITCH, zero mutation, no adapter turn', async () => {
    const session = createStartedSession({
      name: 'Codex Started Gemini', model: GPT_MODEL, providerId: openaiProvider.id, expectedAgentType: 'codex',
    });
    const before = snapshotRow(session.id);

    await expect(
      continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: GEMINI_MODEL }),
    ).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(snapshotRow(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('gemini session + codex model → CROSS_KIND_MODEL_SWITCH, zero mutation, no adapter turn', async () => {
    const session = createStartedSession({
      name: 'Gemini Started', model: GEMINI_MODEL, providerId: googleProvider.id, expectedAgentType: 'gemini',
    });
    const before = snapshotRow(session.id);

    await expect(
      continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: GPT_MODEL }),
    ).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(snapshotRow(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('claude session + grok model → CROSS_KIND_MODEL_SWITCH, zero mutation, no adapter turn (FR8 pin)', async () => {
    const session = createStartedSession({
      name: 'Claude Started Grok', model: CLAUDE_MODEL, providerId: anthropicProvider.id, expectedAgentType: 'claude-code',
    });
    const before = snapshotRow(session.id);

    await expect(
      continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: GROK_MODEL }),
    ).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

    expect(snapshotRow(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('control: same-kind override still continues on the existing adapter', async () => {
    const session = createStartedSession({
      name: 'Codex Same-kind', model: GPT_MODEL, providerId: openaiProvider.id, expectedAgentType: 'codex',
    });

    await continueSessionWithExistingMessage(
      session.id, activeConversationId(session.id), tempDir, { model: GPT_MODEL_2 },
    );

    expect(mockCreateAgentForSession).toHaveBeenCalledTimes(1);
    expect(mockCreateAgentForSession.mock.calls[0][0]).toBe('codex');
    expect(mockExecuteSession).toHaveBeenCalledTimes(1);
    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(GPT_MODEL_2);
    expect(updated.agentType).toBe('codex');
  });

  it('control: unregistered model override still continues on the existing adapter (legacy)', async () => {
    // An unregistered id carries no positive kind information (resolution
    // merely guesses 'claude-code'), so the guard must not treat it as a
    // kind change — the override proceeds exactly as before.
    const session = createStartedSession({
      name: 'Codex Unknown Model', model: GPT_MODEL, providerId: openaiProvider.id, expectedAgentType: 'codex',
    });

    await continueSessionWithExistingMessage(
      session.id, activeConversationId(session.id), tempDir, { model: 'gpt-unregistered-xyz' },
    );

    expect(mockCreateAgentForSession).toHaveBeenCalledTimes(1);
    expect(mockCreateAgentForSession.mock.calls[0][0]).toBe('codex');
    expect(mockExecuteSession).toHaveBeenCalledTimes(1);
    expect(sessions.getById(session.id).agentType).toBe('codex');
  });

  it('control: absent model override still continues on the existing adapter', async () => {
    const session = createStartedSession({
      name: 'Codex No Override', model: GPT_MODEL, providerId: openaiProvider.id, expectedAgentType: 'codex',
    });

    await continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, {});

    expect(mockCreateAgentForSession).toHaveBeenCalledTimes(1);
    expect(mockCreateAgentForSession.mock.calls[0][0]).toBe('codex');
    expect(mockExecuteSession).toHaveBeenCalledTimes(1);
    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(GPT_MODEL);
    expect(updated.agentType).toBe('codex');
  });

  it.each(['sonnet', 'claude-opus-4-6'])('rejects Grok to %s before any continuation state changes', async (model) => {
    const session = createStartedSession({ name: 'Grok started', model: GROK_MODEL, providerId: xaiProvider.id, expectedAgentType: 'grok-build' });
    const conversationId = activeConversationId(session.id);
    conversations.update(conversationId, { isActive: false, claudeSessionId: 'native-grok' });
    const before = sessions.getById(session.id);
    const beforeConversations = conversations.getBySessionId(session.id);
    const beforeMessages = messages.getBySessionId(session.id);
    vi.mocked(broadcastToSession).mockClear();
    await expect(continueSessionWithExistingMessage(session.id, conversationId, tempDir, { model }))
      .rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });
    expect(sessions.getById(session.id)).toEqual(before);
    expect(conversations.getBySessionId(session.id)).toEqual(beforeConversations);
    expect(messages.getBySessionId(session.id)).toEqual(beforeMessages);
    expect(activeSessions.has(session.id)).toBe(false);
    expect(activeConversationIds.has(session.id)).toBe(false);
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
    expect(mockExecuteSession).not.toHaveBeenCalled();
  });

  it('uses the explicit owner of a duplicate model for admission', async () => {
    modelProviders.addModel(xaiProvider.id, { modelId: 'shared-branch', displayName: 'Shared Grok' });
    modelProviders.addModel(googleProvider.id, { modelId: 'shared-branch', displayName: 'Shared Gemini' });
    const session = createStartedSession({ name: 'Grok duplicate', model: GROK_MODEL, providerId: xaiProvider.id, expectedAgentType: 'grok-build' });
    const before = sessions.getById(session.id);
    await expect(continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: 'shared-branch', providerId: googleProvider.id }))
      .rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });
    expect(sessions.getById(session.id)).toEqual(before);
    expect(mockCreateAgentForSession).not.toHaveBeenCalled();
  });

  it('accepts an explicit Grok owner when another kind owns the duplicate first', async () => {
    modelProviders.addModel(googleProvider.id, { modelId: 'shared-reverse', displayName: 'Shared Gemini' });
    modelProviders.addModel(xaiProvider.id, { modelId: 'shared-reverse', displayName: 'Shared Grok' });
    const session = createStartedSession({ name: 'Grok duplicate allowed', model: GROK_MODEL, providerId: xaiProvider.id, expectedAgentType: 'grok-build' });
    await continueSessionWithExistingMessage(session.id, activeConversationId(session.id), tempDir, { model: 'shared-reverse', providerId: xaiProvider.id });
    expect(mockCreateAgentForSession.mock.calls[0][0]).toBe('grok-build');
    expect(mockExecuteSession).toHaveBeenCalledTimes(1);
  });

  it.each([['high', 'high'], ['auto', null]])('passes Grok identity and %s effort to existing-message dispatch', async (effort, expectedEffort) => {
    const session = createStartedSession({ name: 'Grok options', model: GROK_MODEL, providerId: xaiProvider.id, expectedAgentType: 'grok-build' });
    sessions.update(session.id, { effortLevel: effort });
    const conversationId = activeConversationId(session.id);
    await continueSessionWithExistingMessage(session.id, conversationId, tempDir, {});
    expect(mockCreateAgentForSession.mock.calls[0][0]).toBe('grok-build');
    const options = mockExecuteSession.mock.calls[0][0].queryParams.options;
    expect(options.sessionId).toBe(session.id);
    expect(options.conversationId).toBe(conversationId);
    expect(options.effortLevel).toBe(expectedEffort);
  });
});
