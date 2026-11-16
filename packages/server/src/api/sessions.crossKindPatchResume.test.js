import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { projects, sessions, messages, conversations, modelProviders } from '../database.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { prepareContinueTurn } from '../services/sessionTurnSetup.js';
import { continueSessionCore } from '../services/sessionContinuation.js';
import { activeSessions } from '../services/sessionExecutionOwnership.js';
import { _executeSession } from '../services/sessionExecution.js';

vi.mock('../services/sessionExecution.js', async (importOriginal) => ({
  ...await importOriginal(),
  createAgentForSession: vi.fn(() => ({ supportsResume: () => true, needsConversationContext: () => false })),
  _executeSession: vi.fn(async () => {}),
}));

// Mock websocket so PATCH doesn't try to reach real subscribers.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager so importing the router never spawns real agents.
// The follow-up turn below goes through prepareContinueTurn directly with a
// stubbed gateway, so no real provider process is ever started.
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
  continueSessionWithExistingMessage: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
}));

vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

// Import after mocks.
import sessionsRouter from './sessions.js';

/**
 * RED (PR Review Fix #1): the primary UI flow is picker-PATCH first, send
 * second. When PATCH applies an actual kind flip on a started session it
 * must discard the native resume chain (FRD §2.2/FR4), so the follow-up
 * turn withholds `resumeSessionId` and keeps continuity via injected
 * transcript (FR4/FR5) instead of a wrong-provider resume pointer or a
 * bare prompt (silent context loss).
 *
 * Pre-GREEN, `sessions-patch.js` touches no `conversations` state, so the
 * PATCH-clearance assertions fail; and for `muse`/`claude-code` targets the
 * follow-up sends the stale resume id (wrong-provider pointer) or goes out
 * bare, so the turn assertions fail too.
 */
describe('Picker PATCH kind switch discards the native resume chain (Fix #1)', () => {
  let app;
  let project;
  let tempDir;
  let openaiProvider;
  let anthropicProvider;
  let metaProvider;
  let googleProvider;
  let xaiProvider;

  const GPT_MODEL = 'gpt-patch-resume-test';
  const CLAUDE_MODEL = 'claude-patch-resume-test';
  const MUSE_MODEL = 'muse-patch-resume-test';
  const GEMINI_MODEL = 'gemini-patch-resume-test';
  const GROK_MODEL = 'grok-patch-resume-test';

  /** Stub adapter mirroring the real kind's resume/context capabilities. */
  function stubAgentFor(kind) {
    const resumable = kind !== 'codex';
    return {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => resumable,
      needsConversationContext: () => !resumable,
    };
  }

  /** Started session (≥1 assistant message) with a stored native resume id. */
  function createStartedSessionWithResume({ name, model, providerId, resumeId = 'stale-native-id' }) {
    const session = sessions.create(project.id, name, 'Initial prompt', {
      model,
      providerId,
      status: 'waiting',
    });
    const conv = conversations.ensureActiveConversation(session.id);
    messages.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messages.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: resumeId });
    return sessions.getById(session.id);
  }

  function resumePointers(sessionId) {
    return conversations.getBySessionId(sessionId).map((c) => c.claudeSessionId);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    tempDir = mkdtempSync(join(tmpdir(), 'patch-resume-test-'));
    project = projects.create('Patch Resume Project', tempDir);

    openaiProvider = modelProviders.create({
      name: 'OpenAI Patch Resume', baseUrl: 'https://api.openai.patch-resume', authToken: 'key-o', kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL, displayName: 'GPT Patch Resume', tier: 'custom' });

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Patch Resume', baseUrl: 'https://api.anthropic.patch-resume', authToken: 'key-a', kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_MODEL, displayName: 'Claude Patch Resume', tier: 'sonnet' });

    metaProvider = modelProviders.create({
      name: 'Meta Patch Resume', baseUrl: null, authToken: null, kind: 'meta',
    });
    modelProviders.addModel(metaProvider.id, { modelId: MUSE_MODEL, displayName: 'Muse Patch Resume', tier: 'custom' });

    googleProvider = modelProviders.create({
      name: 'Google Patch Resume', baseUrl: 'https://generativelanguage.patch-resume', authToken: 'key-g', kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, { modelId: GEMINI_MODEL, displayName: 'Gemini Patch Resume', tier: 'custom' });

    xaiProvider = modelProviders.create({
      name: 'xAI Patch Resume', baseUrl: null, authToken: null, kind: 'xai',
    });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_MODEL, displayName: 'Grok Patch Resume', tier: 'custom' });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(metaProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(xaiProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('claude-code → muse picker flow: PATCH clears pointers; follow-up sends no resume and injects transcript', async () => {
    const session = createStartedSessionWithResume({
      name: 'Claude Started', model: CLAUDE_MODEL, providerId: anthropicProvider.id,
    });
    expect(resumePointers(session.id)).toEqual(['stale-native-id']);

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: MUSE_MODEL, providerId: metaProvider.id })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(MUSE_MODEL);
    expect(updated.agentType).toBe('muse');
    // Pre-GREEN: PATCH touches no conversations state, so this fails.
    expect(resumePointers(session.id)).toEqual([null]);

    // Follow-up send: handleSend carries selectedModel, now == session.model.
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgentFor('muse'));
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on muse',
        workingDirectory: tempDir,
        options: { model: MUSE_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('muse');
      // No wrong-provider resume pointer (FR4).
      expect(queryParams.options.resume).toBeUndefined();
      // Full transcript injected, not a bare prompt (FR5).
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');
      expect(queryParams.prompt).toContain('follow-up on muse');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('codex → claude-code picker flow: PATCH clears pointers; follow-up sends no resume and injects transcript', async () => {
    const session = createStartedSessionWithResume({
      name: 'Codex Started', model: GPT_MODEL, providerId: openaiProvider.id,
    });
    expect(sessions.getById(session.id).agentType).toBe('codex');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL, providerId: anthropicProvider.id })
      .expect(200);

    expect(sessions.getById(session.id).agentType).toBe('claude-code');
    expect(resumePointers(session.id)).toEqual([null]);

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgentFor('claude-code'));
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on claude',
        workingDirectory: tempDir,
        options: { model: CLAUDE_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('claude-code');
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('claude-code → codex picker flow: PATCH clears pointers; follow-up sends no resume and injects transcript', async () => {
    const session = createStartedSessionWithResume({
      name: 'Claude To Codex', model: CLAUDE_MODEL, providerId: anthropicProvider.id,
    });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GPT_MODEL, providerId: openaiProvider.id })
      .expect(200);

    expect(sessions.getById(session.id).agentType).toBe('codex');
    expect(resumePointers(session.id)).toEqual([null]);

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgentFor('codex'));
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on codex',
        workingDirectory: tempDir,
        options: { model: GPT_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('codex');
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('claude-code → grok picker flow: PATCH clears EVERY conversation pointer; follow-up sends no resume (E2)', async () => {
    // Two conversations, each with a stale native pointer; the transcript
    // lives in the (second, active) conversation the follow-up turn reads.
    const session = sessions.create(project.id, 'Claude To Grok', 'Initial prompt', {
      model: CLAUDE_MODEL,
      providerId: anthropicProvider.id,
      status: 'waiting',
    });
    const firstConv = conversations.ensureActiveConversation(session.id);
    conversations.update(firstConv.id, { claudeSessionId: 'stale-a' });
    const activeConv = conversations.create(session.id, 'Side conversation', true);
    messages.create(session.id, 'user', 'first question', { conversationId: activeConv.id });
    messages.create(session.id, 'assistant', 'first answer', { conversationId: activeConv.id });
    conversations.update(activeConv.id, { claudeSessionId: 'stale-b' });
    expect(resumePointers(session.id)).toEqual(['stale-a', 'stale-b']);
    expect(sessions.getById(session.id).agentType).toBe('claude-code');

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GROK_MODEL, providerId: xaiProvider.id })
      .expect(200);

    const updated = sessions.getById(session.id);
    expect(updated.model).toBe(GROK_MODEL);
    expect(updated.agentType).toBe('grok-build');
    expect(updated.providerId).toBe(xaiProvider.id);
    // Every conversation's native pointer is discarded (FR5/E2).
    expect(resumePointers(session.id)).toEqual([null, null]);

    // Follow-up send on the switched session: resumable Grok stub, but the
    // turn must open a fresh native thread with the transcript injected.
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgentFor('grok-build'));
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on grok',
        workingDirectory: tempDir,
        options: { model: GROK_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('grok-build');
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('PATCH transfers each conversation history once through the live dispatcher', async () => {
    const session = createStartedSessionWithResume({ name: 'Legacy', model: CLAUDE_MODEL, providerId: anthropicProvider.id });
    const first = conversations.ensureActiveConversation(session.id);
    const second = conversations.create(session.id, 'Second', true);
    messages.create(session.id, 'user', 'second question', { conversationId: second.id });
    messages.create(session.id, 'assistant', 'second answer', { conversationId: second.id });
    conversations.update(second.id, { claudeSessionId: 'old-second' });
    expect(sessions.getById(session.id).lastExecutedModel).toBeNull();
    await request(app).patch(`/api/sessions/${session.id}`).send({ model: GROK_MODEL, providerId: xaiProvider.id }).expect(200);
    expect(resumePointers(session.id)).toEqual([null, null]);

    for (const [conv, own, other] of [[first, 'first answer', 'second answer'], [second, 'second answer', 'first answer']]) {
      conversations.setActive(conv.id);
      activeSessions.clear();
      await continueSessionCore(session.id, 'next', tempDir, { options: { interactive: true }, callbacks: {} });
      const params = _executeSession.mock.calls.at(-1)[0].queryParams;
      expect(params.options.resume ?? null).toBeNull();
      expect(params.prompt).toContain('<conversation_history>');
      expect(params.prompt).toContain(own);
      expect(params.prompt).not.toContain(other);
      conversations.update(conv.id, { claudeSessionId: `new-${conv.id}` });
      activeSessions.clear();
      await continueSessionCore(session.id, 'again', tempDir, { options: { interactive: true }, callbacks: {} });
      const resumed = _executeSession.mock.calls.at(-1)[0].queryParams;
      expect(resumed.options.resume).toBe(`new-${conv.id}`);
      expect(resumed.prompt).toBe('again');
    }
    activeSessions.clear();
  });

  it('gemini cross-kind PATCH still 400s with zero mutation — resume pointers untouched (FR3)', async () => {
    const session = createStartedSessionWithResume({
      name: 'Claude Started Gemini', model: CLAUDE_MODEL, providerId: anthropicProvider.id,
    });

    const res = await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: GEMINI_MODEL, providerId: googleProvider.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');

    const unchanged = sessions.getById(session.id);
    expect(unchanged.model).toBe(CLAUDE_MODEL);
    expect(unchanged.agentType).toBe('claude-code');
    expect(resumePointers(session.id)).toEqual(['stale-native-id']);
  });

  it('same-kind PATCH keeps the resume chain: pointer retained and follow-up resumes with no history prefix (FR6)', async () => {
    const session = createStartedSessionWithResume({
      name: 'Claude Same-kind', model: CLAUDE_MODEL, providerId: anthropicProvider.id,
      resumeId: 'live-claude-id',
    });

    await request(app)
      .patch(`/api/sessions/${session.id}`)
      .send({ model: CLAUDE_MODEL })
      .expect(200);

    expect(sessions.getById(session.id).agentType).toBe('claude-code');
    expect(resumePointers(session.id)).toEqual(['live-claude-id']);

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgentFor('claude-code'));
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up same kind',
        workingDirectory: tempDir,
        options: { model: null, interactive: true },
        controller: new AbortController(),
      });

      expect(queryParams.options.resume).toBe('live-claude-id');
      expect(queryParams.prompt).not.toContain('<conversation_history>');
    } finally {
      createAgentSpy.mockRestore();
    }
  });
});
