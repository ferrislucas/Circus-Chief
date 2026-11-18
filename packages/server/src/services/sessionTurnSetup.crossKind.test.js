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
  let xaiProvider;

  const GPT_MODEL = 'gpt-turn-test';
  const CLAUDE_OPUS = 'claude-opus-turn-test';
  const MUSE_MODEL = 'muse-turn-test';
  const GROK_MODEL = 'grok-turn-test';
  const GROK_MODEL_2 = 'grok-turn-test-2';

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

  /** Stub mirroring GrokBuildAcpAdapter: resumable, self-supplied context. */
  function grokStubAgent() {
    return {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
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

    xaiProvider = modelProviders.create({
      name: 'xAI Turn', baseUrl: null, authToken: 'key-x-turn', kind: 'xai',
      additionalEnvVars: { GROK_HATCH: 'open' },
    });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_MODEL, displayName: 'Grok Turn', tier: 'custom' });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_MODEL_2, displayName: 'Grok Turn 2', tier: 'custom' });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(metaProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(xaiProvider.id); } catch { /* noop */ }
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

  /** Started Grok session with prior transcript + a stale native resume pointer. */
  function createStartedSessionOnKind({ name, model, providerId, expectedAgentType, resumeId }) {
    const session = sessionRepo.create(project.id, name, 'initial prompt', {
      model,
      providerId,
    });
    expect(sessionRepo.getById(session.id).agentType).toBe(expectedAgentType);
    const conv = conversations.ensureActiveConversation(session.id);
    messageRepo.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messageRepo.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: resumeId });
    return sessionRepo.getById(session.id);
  }

  it('claude-code→grok-build: GROK child gets no resume, transcript injected, xai env stays empty', async () => {
    const session = createStartedSessionOnKind({
      name: 'Claude To Grok', model: CLAUDE_OPUS, providerId: anthropicProvider.id,
      expectedAgentType: 'claude-code', resumeId: 'stale-claude-id',
    });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(grokStubAgent());
    // Hermetic env assertions: the session env starts from a copy of
    // process.env, so a host-exported Claude-only var (e.g. MAX_THINKING_TOKENS
    // on dev machines) would leak into EVERY kind's env and is not the
    // switch's doing. Remove the vars under assertion for this test so the
    // assertions pin what the xai kind flow itself injects.
    const envVarsUnderAssertion = [
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
      'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_API_KEY', 'XAI_API_KEY',
      'MAX_THINKING_TOKENS', 'CLAUDE_CODE_EFFORT_LEVEL',
    ];
    const savedEnv = envVarsUnderAssertion.map((key) => [key, process.env[key]]);
    for (const [key] of savedEnv) delete process.env[key];
    try {
      const { session: updated, queryParams, agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'follow-up on grok',
        workingDirectory: tempDir,
        options: { model: GROK_MODEL, interactive: true },
        controller: new AbortController(),
      });

      // Adapter for the NEW kind (pre-allowlist: stale 'claude-code').
      expect(createAgentSpy.mock.calls[0][0]).toBe('grok-build');

      // Session row follows the model kind and owning xAI provider.
      expect(updated.agentType).toBe('grok-build');
      expect(updated.model).toBe(GROK_MODEL);
      expect(updated.providerId).toBe(xaiProvider.id);
      const stored = sessions.getById(session.id);
      expect(stored.agentType).toBe('grok-build');
      expect(stored.providerId).toBe(xaiProvider.id);

      // Active native resume pointer discarded on the kind flip (FR5).
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBeNull();

      // No resume on a kind change; transcript injected with both prior
      // assistant text and the new user text (FR5).
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(queryParams.prompt).toContain('first answer');
      expect(queryParams.prompt).toContain('follow-up on grok');

      // Meta records the effective kind/model.
      expect(agentCallMeta.agentType).toBe('grok-build');
      expect(agentCallMeta.model).toBe(GROK_MODEL);
      expect(agentCallMeta.isResume).toBeFalsy();

      // Env rebuilt for the destination xAI kind (FR12): no Claude, OpenAI,
      // Gemini, or xAI secrets, and no Claude-only tuning vars. The provider's
      // configured authToken must NOT be copied to XAI_API_KEY.
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(queryParams.options.env.OPENAI_API_KEY).toBeUndefined();
      expect(queryParams.options.env.OPENAI_BASE_URL).toBeUndefined();
      expect(queryParams.options.env.GEMINI_API_KEY).toBeUndefined();
      expect(queryParams.options.env.XAI_API_KEY).toBeUndefined();
      expect(queryParams.options.env.MAX_THINKING_TOKENS).toBeUndefined();
      expect(queryParams.options.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
      // additionalEnvVars still pass through, same as MUSE_HATCH.
      expect(queryParams.options.env.GROK_HATCH).toBe('open');
    } finally {
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      createAgentSpy.mockRestore();
    }
  });

  it('grok-build→claude-code: no Grok id leaks into the Claude child; ANTHROPIC_* rebuilt (FR12)', async () => {
    const session = createStartedSessionOnKind({
      name: 'Grok To Claude', model: GROK_MODEL, providerId: xaiProvider.id,
      expectedAgentType: 'grok-build', resumeId: 'stale-grok-id',
    });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    // Hermetic XAI assertion: the anthropic-kind flow does not strip a
    // host-exported XAI_API_KEY (same on any freshly started Claude session),
    // so remove it here to pin what the switch itself injects.
    const savedXai = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'follow-up on claude',
        workingDirectory: tempDir,
        options: { model: CLAUDE_OPUS, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('claude-code');
      // The stored Grok native id must never reach the Claude child.
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.options.resume).not.toBe('stale-grok-id');
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBeNull();

      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('key-a-turn');
      expect(queryParams.options.env.XAI_API_KEY).toBeUndefined();

      expect(agentCallMeta.agentType).toBe('claude-code');
    } finally {
      if (savedXai === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = savedXai;
      createAgentSpy.mockRestore();
    }
  });

  it('claude→grok kindChanged branch clears a stale codex pendingModel (PR #1, Grok direction)', async () => {
    const session = createStartedSessionOnKind({
      name: 'Claude Grok Pending', model: CLAUDE_OPUS, providerId: anthropicProvider.id,
      expectedAgentType: 'claude-code', resumeId: 'stale-claude-id',
    });
    // A schedule-with-model from before the switch: kind-X (codex) override
    // stranded on a row about to become kind-Y (grok-build).
    sessions.update(session.id, { pendingModel: GPT_MODEL });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(grokStubAgent());
    try {
      const { session: updated } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on grok',
        workingDirectory: tempDir,
        options: { model: GROK_MODEL, interactive: true },
        controller: new AbortController(),
      });

      expect(updated.agentType).toBe('grok-build');
      expect(updated.model).toBe(GROK_MODEL);
      // Pre-allowlist the kind never flips, so the codex pendingModel stays.
      expect(updated.pendingModel).toBeNull();
      expect(sessions.getById(session.id).pendingModel).toBeNull();
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('non-interactive turn with cross-kind model is rejected fail-closed with zero mutation (Fix #2, FR9)', async () => {
    // Scheduler / auto-send / lane-run path via pendingModel: a cross-kind
    // override must be blocked like the branch-continue guard (strict
    // CROSS_KIND_MODEL_SWITCH, before claim/mutation), not run on a stale
    // adapter with a stranded row.
    const session = createStartedCodexSession();
    const rowBefore = sessions.getById(session.id);
    const messageCountBefore = messageRepo.getBySessionId(session.id).length;
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      await expect(prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        options: { model: CLAUDE_OPUS, interactive: false },
        controller: new AbortController(),
      })).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

      // Zero mutation: no model/agentType write, no adapter creation, no
      // user message stored, resume pointer left alone.
      expect(createAgentSpy).not.toHaveBeenCalled();
      const rowAfter = sessions.getById(session.id);
      expect(rowAfter.model).toBe(rowBefore.model);
      expect(rowAfter.agentType).toBe('codex');
      expect(rowAfter.status).toBe(rowBefore.status);
      expect(messageRepo.getBySessionId(session.id)).toHaveLength(messageCountBefore);
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('stale-native-id');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('non-interactive claude-code → codex override is rejected fail-closed (Fix #2 mirror)', async () => {
    const session = sessionRepo.create(project.id, 'Claude Started NI', 'initial prompt', {
      model: CLAUDE_OPUS,
      providerId: anthropicProvider.id,
    });
    const conv = conversations.ensureActiveConversation(session.id);
    messageRepo.create(session.id, 'user', 'first question', { conversationId: conv.id });
    messageRepo.create(session.id, 'assistant', 'first answer', { conversationId: conv.id });
    conversations.update(conv.id, { claudeSessionId: 'live-claude-id' });
    const rowBefore = sessions.getById(session.id);

    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      await expect(prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        options: { model: GPT_MODEL, interactive: false },
        controller: new AbortController(),
      })).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

      expect(createAgentSpy).not.toHaveBeenCalled();
      expect(sessions.getById(session.id)).toEqual(rowBefore);
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('live-claude-id');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('non-interactive turn with an unregistered model override stays on the legacy path (Fix #2 carve-out)', async () => {
    // An unregistered id carries no kind information (resolution merely
    // guesses 'claude-code'), so the guard must not treat it as a kind
    // change — mirrors the branch-continue guard's carve-out.
    const session = createStartedCodexSession();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { agentCallMeta } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        options: { model: 'unregistered-model-xyz', interactive: false },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('codex');
      expect(agentCallMeta.agentType).toBe('codex');
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('stale-native-id');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('non-interactive same-kind model override still proceeds on the existing adapter (Fix #2 control)', async () => {
    const session = createStartedCodexSession();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { agentCallMeta, queryParams } = await prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        options: { model: GPT_MODEL, interactive: false },
        controller: new AbortController(),
      });

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

  it('kindChanged branch clears a stale other-kind pendingModel (PR #1)', async () => {
    const session = createStartedCodexSession();
    // A schedule-with-model (or same-kind pendingModel) from before the
    // switch: kind-X override stranded on a row about to become kind-Y.
    sessions.update(session.id, { pendingModel: GPT_MODEL });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { session: updated } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on claude',
        workingDirectory: tempDir,
        options: { model: CLAUDE_OPUS, interactive: true },
        controller: new AbortController(),
      });

      expect(updated.agentType).toBe('claude-code');
      expect(updated.model).toBe(CLAUDE_OPUS);
      // Pre-fix: still GPT_MODEL, so the next scheduled fire would strand
      // the row or silently switch back.
      expect(updated.pendingModel).toBeNull();
      expect(sessions.getById(session.id).pendingModel).toBeNull();
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('kindChanged branch keeps a pendingModel that already agrees with the new kind (PR #1)', async () => {
    const session = createStartedCodexSession();
    sessions.update(session.id, { pendingModel: CLAUDE_OPUS });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
    try {
      const { session: updated } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on claude',
        workingDirectory: tempDir,
        options: { model: CLAUDE_OPUS, interactive: true },
        controller: new AbortController(),
      });

      expect(updated.agentType).toBe('claude-code');
      expect(updated.pendingModel).toBe(CLAUDE_OPUS);
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

  it('non-interactive claude-code → grok-build override is rejected fail-closed with zero mutation (FR8)', async () => {
    const session = createStartedSessionOnKind({
      name: 'Claude Grok NI', model: CLAUDE_OPUS, providerId: anthropicProvider.id,
      expectedAgentType: 'claude-code', resumeId: 'live-claude-id',
    });
    const rowBefore = sessions.getById(session.id);
    const messageCountBefore = messageRepo.getBySessionId(session.id).length;
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(grokStubAgent());
    try {
      await expect(prepareContinueTurn({
        session,
        sessionId: session.id,
        content: 'background turn',
        workingDirectory: tempDir,
        options: { model: GROK_MODEL, interactive: false },
        controller: new AbortController(),
      })).rejects.toMatchObject({ code: 'CROSS_KIND_MODEL_SWITCH' });

      expect(createAgentSpy).not.toHaveBeenCalled();
      const rowAfter = sessions.getById(session.id);
      expect(rowAfter.model).toBe(rowBefore.model);
      expect(rowAfter.agentType).toBe('claude-code');
      expect(rowAfter.providerId).toBe(rowBefore.providerId);
      expect(messageRepo.getBySessionId(session.id)).toHaveLength(messageCountBefore);
      expect(conversations.getActiveBySessionId(session.id).claudeSessionId).toBe('live-claude-id');
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('grok-build characterization: same-kind turn with no override resumes the new native id (FR6)', async () => {
    // Pre-existing resume shape: after a switch onto Grok, the following
    // same-kind turn (no model override) must resume the Grok thread created
    // by the switch turn and not replay the full transcript again. This must
    // pass BEFORE the allowlist edit — a failure here is a pre-existing Grok
    // resume bug outside this change.
    const session = createStartedSessionOnKind({
      name: 'Grok Same-kind', model: GROK_MODEL, providerId: xaiProvider.id,
      expectedAgentType: 'grok-build', resumeId: 'live-grok-id',
    });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(grokStubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up same kind on grok',
        workingDirectory: tempDir,
        options: { model: null },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('grok-build');
      expect(queryParams.options.resume).toBe('live-grok-id');
      expect(queryParams.prompt).not.toContain('<conversation_history>');
      expect(agentCallMeta.agentType).toBe('grok-build');
      expect(agentCallMeta.isResume).toBe(true);
    } finally {
      createAgentSpy.mockRestore();
    }
  });

  it('same-kind Grok model id change: agentType stays grok-build, resume withheld, history injected (FR10)', async () => {
    const session = createStartedSessionOnKind({
      name: 'Grok Model Swap', model: GROK_MODEL, providerId: xaiProvider.id,
      expectedAgentType: 'grok-build', resumeId: 'stale-grok-id',
    });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(grokStubAgent());
    try {
      const { queryParams, agentCallMeta } = await prepareContinueTurn({
        session: sessions.getById(session.id),
        sessionId: session.id,
        content: 'follow-up on the new grok model',
        workingDirectory: tempDir,
        options: { model: GROK_MODEL_2, interactive: true },
        controller: new AbortController(),
      });

      expect(createAgentSpy.mock.calls[0][0]).toBe('grok-build');
      expect(sessions.getById(session.id).agentType).toBe('grok-build');
      // The model id changed, so the model-switch context path applies even
      // though the kind did not (FR10).
      expect(queryParams.options.resume).toBeUndefined();
      expect(queryParams.prompt.startsWith('<conversation_history>')).toBe(true);
      expect(agentCallMeta.agentType).toBe('grok-build');
    } finally {
      createAgentSpy.mockRestore();
    }
  });
});
