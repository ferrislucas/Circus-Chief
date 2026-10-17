import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { ConversationRepository } from '../db/ConversationRepository.js';
import { sessions, conversations, modelProviders } from '../database.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { prepareContinueTurn } from './sessionTurnSetup.js';

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

/**
 * RED (plan Phase 3, FR4/FR5/FR7/FR8/FR10): turn execution for an allowed
 * in-scope kind change must run the NEW adapter with transcript injection,
 * no resume, rebuilt provider env, and effective agentCallMeta.
 *
 * Pre-GREEN, `prepareContinueTurn` builds the agent from the STALE
 * `session.agentType`, never persists the new kind on a started session,
 * and never clears the old native resume pointer — so the new-kind
 * assertions below fail.
 */
describe('prepareContinueTurn cross-kind switch (FR4/FR5/FR7/FR8/FR10)', () => {
  let projectRepo;
  let sessionRepo;
  let messageRepo;
  let conversationRepo;
  let tempDir;
  let project;
  let openaiProvider;
  let anthropicProvider;
  let metaProvider;

  const GPT_MODEL = 'gpt-turn-test';
  const CLAUDE_OPUS = 'claude-opus-turn-test';
  const MUSE_MODEL = 'muse-turn-test';

  function stubAgent() {
    return {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
  }

  /** Started session with prior transcript + a stale native resume pointer. */
  function createStartedCodexSession() {
    const session = sessionRepo.create(project.id, 'Codex Started', 'initial prompt', {
      model: GPT_MODEL,
      providerId: openaiProvider.id,
    });
    expect(sessionRepo.getById(session.id).agentType).toBe('codex');
    const conv = conversationRepo.ensureActiveConversation
      ? conversationRepo.ensureActiveConversation(session.id)
      : conversations.ensureActiveConversation(session.id);
    messageRepo.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messageRepo.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: 'stale-native-id' });
    return sessionRepo.getById(session.id);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    projectRepo = new ProjectRepository();
    sessionRepo = new SessionRepository();
    messageRepo = new MessageRepository();
    conversationRepo = new ConversationRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'xkind-turn-test-'));
    project = projectRepo.create('XKind Turn Project', tempDir);

    openaiProvider = modelProviders.create({
      name: 'OpenAI Turn', baseUrl: 'https://api.openai.turn', authToken: 'key-o-turn', kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_MODEL, displayName: 'GPT Turn', tier: 'custom' });

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Turn', baseUrl: 'https://api.anthropic.turn', authToken: 'key-a-turn', kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_OPUS, displayName: 'Claude Opus Turn', tier: 'opus' });

    metaProvider = modelProviders.create({
      name: 'Meta Turn', baseUrl: null, authToken: null, kind: 'meta',
      additionalEnvVars: { MUSE_HATCH: 'open' },
    });
    modelProviders.addModel(metaProvider.id, { modelId: MUSE_MODEL, displayName: 'Muse Turn', tier: 'custom' });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(metaProvider.id); } catch { /* noop */ }
    try { projectRepo.delete(project.id); } catch { /* noop */ }
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('codex→claude-code: builds the NEW adapter, injects transcript, drops resume, persists the new kind', async () => {
    const session = createStartedCodexSession();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const controller = new AbortController();
      const { session: updated, queryParams, agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'follow-up on claude',
        workingDirectory: tempDir,
        options: { model: CLAUDE_OPUS, interactive: true },
        controller,
      });

      // Adapter for the NEW kind (pre-GREEN: stale 'codex').
      expect(createAgentSpy).toHaveBeenCalled();
      expect(createAgentSpy.mock.calls[0][0]).toBe('claude-code');

      // Session row follows the model kind (pre-GREEN: stays 'codex').
      expect(updated.agentType).toBe('claude-code');
      expect(updated.model).toBe(CLAUDE_OPUS);
      expect(sessions.getById(session.id).agentType).toBe('claude-code');

      // No resume on a kind change; transcript injected (FR4/FR5).
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');

      // Old native resume pointer discarded (FR4).
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBeNull();

      // Provider env rebuilt for the new kind: ANTHROPIC_* in, OPENAI_* out (FR8).
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('key-a-turn');
      expect(queryParams.options.env.OPENAI_API_KEY).toBeUndefined();
      expect(queryParams.options.env.OPENAI_BASE_URL).toBeUndefined();

      // Meta records the effective kind/model (FR10).
      expect(agentCallMeta.agentType).toBe('claude-code');
      expect(agentCallMeta.model).toBe(CLAUDE_OPUS);
      expect(agentCallMeta.isResume).toBeFalsy();
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('claude-code→codex mirror: OPENAI_* in, ANTHROPIC_* and Claude-only env out', async () => {
    const session = sessionRepo.create(project.id, 'Claude Started', 'initial prompt', {
      model: CLAUDE_OPUS,
      providerId: anthropicProvider.id,
    });
    expect(sessionRepo.getById(session.id).agentType).toBe('claude-code');
    const conv = conversations.ensureActiveConversation(session.id);
    messageRepo.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messageRepo.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: 'stale-claude-id' });

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session: sessionRepo.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on codex',
        workingDirectory: tempDir,
        options: { model: GPT_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('codex');
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBeNull();

      expect(queryParams.options.env.OPENAI_API_KEY).toBe('key-o-turn');
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(queryParams.options.env.MAX_THINKING_TOKENS).toBeUndefined();
      expect(queryParams.options.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();

      expect(agentCallMeta.agentType).toBe('codex');
      expect(agentCallMeta.model).toBe(GPT_MODEL);
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('codex→muse: host-auth (no invented META_* env), additionalEnvVars pass through', async () => {
    const session = createStartedCodexSession();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'follow-up on muse',
        workingDirectory: tempDir,
        options: { model: MUSE_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('muse');
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);

      const metaKeys = Object.keys(queryParams.options.env).filter((k) => k.startsWith('META_'));
      expect(metaKeys).toEqual([]);
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(queryParams.options.env.OPENAI_API_KEY).toBeUndefined();
      expect(queryParams.options.env.MUSE_HATCH).toBe('open');

      expect(agentCallMeta.agentType).toBe('muse');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('non-interactive turn with cross-kind model keeps legacy behavior: no switch (FR9)', async () => {
    const session = createStartedCodexSession();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        // No `interactive` flag: scheduler / auto-send / lane-run path.
        options: { model: CLAUDE_OPUS },
        controller: new AbortController(),
      });

      // Legacy behavior preserved exactly: stale adapter, kind untouched,
      // resume pointer left alone — only interactive turns switch.
      expect(createAgentSpy.mock.calls[0][0]).toBe('codex');
      expect(sessions.getById(session.id).agentType).toBe('codex');
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('stale-native-id');
      expect(agentCallMeta.agentType).toBe('codex');
      expect(queryParams).toBeDefined();
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('stale stored model + NO override: interactive turn must NOT flip kind, clear resume, or inject history (#1)', async () => {
    const session = createStartedCodexSession();
    // The stored model no longer resolves (provider deleted / model
    // renamed or disabled): resolution falls back to 'claude-code'. A turn
    // carrying no explicit model override is NOT a switch — it must
    // continue same-kind on the existing adapter.
    sessions.update(session.id, { model: 'stale-renamed-model-xyz' });

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up with no model override',
        workingDirectory: tempDir,
        options: { model: null, interactive: true },
        controller: new AbortController(),
      });

      // Same-kind continuation on the EXISTING adapter (pre-fix: 'claude-code').
      expect(createAgentSpy.mock.calls[0][0]).toBe('codex');
      expect(agentCallMeta.agentType).toBe('codex');

      // Row unmutated: no silent agentType flip, model untouched.
      const row = sessions.getById(session.id);
      expect(row.agentType).toBe('codex');
      expect(row.model).toBe('stale-renamed-model-xyz');

      // No resume loss, no model-switch context (same-kind rules, FR6):
      // the codex adapter always takes the plain continuation path, never
      // the "switched to a different model" switch path.
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('stale-native-id');
      expect(queryParams.prompt).not.toContain('You switched to a different model mid-conversation');
      expect(queryParams.prompt).toContain('from this session so far');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('same-kind control: claude turn without a model override still resumes with no history prefix (FR6)', async () => {
    const session = sessionRepo.create(project.id, 'Claude Same-kind', 'initial prompt', {
      model: CLAUDE_OPUS,
      providerId: anthropicProvider.id,
    });
    const conv = conversations.ensureActiveConversation(session.id);
    messageRepo.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messageRepo.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: 'live-claude-id' });

    const claudeStub = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(claudeStub);
    try {
      const { queryParams } = await prepareContinueTurn({
        session: sessionRepo.getById(session.id),
        sessionId: session.id,
        content: 'follow-up same kind',
        workingDirectory: tempDir,
        options: { model: null },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('claude-code');
      expect(queryParams.options.resume).toBe('live-claude-id');
      expect(queryParams.prompt).not.toContain('<conversation_history>');
    } finally {
      createAgentSpy.mockRestore();
    }
  });
});
