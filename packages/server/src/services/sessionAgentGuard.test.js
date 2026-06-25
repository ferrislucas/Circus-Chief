import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkCrossKindSwitch,
  agentLabel,
  AGENT_TYPE_LABELS,
  sessionHasNoAssistantMessages,
  deriveAgentTypeUpdate,
} from './sessionAgentGuard.js';
import { projects, sessions, messages, modelProviders } from '../database.js';

describe('sessionAgentGuard', () => {
  describe('agentLabel', () => {
    it('returns "Claude Code" for claude-code', () => {
      expect(agentLabel('claude-code')).toBe('Claude Code');
    });

    it('returns "Codex" for codex', () => {
      expect(agentLabel('codex')).toBe('Codex');
    });

    it('returns the raw value for unknown agent types', () => {
      expect(agentLabel('unknown-type')).toBe('unknown-type');
    });

    it('returns "unknown" for null/undefined', () => {
      expect(agentLabel(null)).toBe('unknown');
      expect(agentLabel(undefined)).toBe('unknown');
    });
  });

  describe('AGENT_TYPE_LABELS', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(AGENT_TYPE_LABELS)).toBe(true);
    });

    it('includes a label for gemini', () => {
      expect(AGENT_TYPE_LABELS.gemini).toBe('Gemini');
    });
  });

  describe('checkCrossKindSwitch', () => {
    let project;
    let anthropicProvider;
    let openaiProvider;

    beforeEach(() => {
      project = projects.create('Guard Test Project', '/tmp/guard-test');

      // Anthropic-kind provider
      anthropicProvider = modelProviders.create({
        name: 'Anthropic Guard Test',
        baseUrl: 'https://api.anthropic.guard',
        authToken: 'key-a',
        kind: 'anthropic',
      });
      modelProviders.addModel(anthropicProvider.id, {
        modelId: 'claude-sonnet-guard',
        displayName: 'Claude Sonnet Guard',
        tier: 'sonnet',
      });
      modelProviders.addModel(anthropicProvider.id, {
        modelId: 'claude-opus-guard',
        displayName: 'Claude Opus Guard',
        tier: 'opus',
      });

      // OpenAI-kind provider
      openaiProvider = modelProviders.create({
        name: 'OpenAI Guard Test',
        baseUrl: 'https://api.openai.guard',
        authToken: 'key-o',
        kind: 'openai',
      });
      modelProviders.addModel(openaiProvider.id, {
        modelId: 'gpt-4o-guard',
        displayName: 'GPT 4o Guard',
        tier: 'custom',
      });
    });

    afterEach(() => {
      try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
      try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
      try { projects.delete(project.id); } catch { /* noop */ }
    });

    it('returns null for same-kind (Claude session + Claude model)', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      expect(checkCrossKindSwitch(session, 'claude-opus-guard')).toBeNull();
    });

    it('returns null for same-kind (Codex session + Codex model)', () => {
      const session = { agentType: 'codex', model: 'gpt-4o-guard' };
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('returns null when no model is requested and session model matches kind', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('returns error for Claude session + Codex model', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      const result = checkCrossKindSwitch(session, 'gpt-4o-guard');
      expect(result).toEqual({
        error: 'CROSS_KIND_MODEL_SWITCH',
        message: expect.stringContaining('Claude Code'),
      });
      expect(result.message).toContain('Codex');
    });

    it('returns error for Codex session + Claude model', () => {
      const session = { agentType: 'codex', model: 'gpt-4o-guard' };
      const result = checkCrossKindSwitch(session, 'claude-sonnet-guard');
      expect(result).toEqual({
        error: 'CROSS_KIND_MODEL_SWITCH',
        message: expect.stringContaining('Codex'),
      });
      expect(result.message).toContain('Claude Code');
    });

    it('defaults agentType to claude-code when not set', () => {
      const session = { model: null };
      // null model resolves to claude-code, and session defaults to claude-code => same kind
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('detects cross-kind switch when session has no agentType and model is OpenAI', () => {
      const session = { model: null };
      const result = checkCrossKindSwitch(session, 'gpt-4o-guard');
      expect(result).not.toBeNull();
      expect(result.error).toBe('CROSS_KIND_MODEL_SWITCH');
    });
  });
});

describe('sessionHasNoAssistantMessages', () => {
  let project;
  let session;

  beforeEach(() => {
    project = projects.create('Guard Helper Test', '/tmp/guard-helper');
    session = sessions.create(project.id, 'Helper Session', 'test prompt');
  });

  afterEach(() => {
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  it('returns true when the session has no messages at all', () => {
    // The session was just created; it may have a user message from creation.
    // Let's test with a fresh session that has only a user message.
    expect(sessionHasNoAssistantMessages(session.id)).toBe(true);
  });

  it('returns false when the session has an assistant message', () => {
    messages.create(session.id, 'assistant', 'Hello from assistant');
    expect(sessionHasNoAssistantMessages(session.id)).toBe(false);
  });

  it('returns true when the session has only user messages', () => {
    messages.create(session.id, 'user', 'Another user message');
    expect(sessionHasNoAssistantMessages(session.id)).toBe(true);
  });
});

describe('deriveAgentTypeUpdate', () => {
  let project;
  let session;
  let anthropicProvider;
  let openaiProvider;
  let googleProvider;

  const CLAUDE_MODEL = 'claude-derive-test';
  const GPT_MODEL = 'gpt-derive-test';
  const GEMINI_MODEL = 'gemini-derive-test';

  beforeEach(() => {
    project = projects.create('Derive Test Project', '/tmp/derive-test');

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Derive Test',
      baseUrl: 'https://api.anthropic.derive',
      authToken: 'key-a',
      kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: CLAUDE_MODEL,
      displayName: 'Claude Derive',
      tier: 'sonnet',
    });

    openaiProvider = modelProviders.create({
      name: 'OpenAI Derive Test',
      baseUrl: 'https://api.openai.derive',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: GPT_MODEL,
      displayName: 'GPT Derive',
      tier: 'custom',
    });

    googleProvider = modelProviders.create({
      name: 'Google Derive Test',
      baseUrl: 'https://generativelanguage.googleapis.com',
      authToken: 'key-g',
      kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, {
      modelId: GEMINI_MODEL,
      displayName: 'Gemini Derive',
      tier: 'custom',
    });

    // Create a waiting Codex session (no assistant messages)
    session = sessions.create(project.id, 'Derive Session', 'test prompt', {
      model: GPT_MODEL,
      providerId: openaiProvider.id,
      status: 'waiting',
    });
  });

  afterEach(() => {
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  it('returns agentType update when switching from codex to claude-code (draft)', () => {
    const freshSession = sessions.getById(session.id);
    const update = deriveAgentTypeUpdate(freshSession, session.id, CLAUDE_MODEL);
    expect(update.agentType).toBe('claude-code');
  });

  it('returns agentType update when switching to gemini (draft)', () => {
    const freshSession = sessions.getById(session.id);
    const update = deriveAgentTypeUpdate(freshSession, session.id, GEMINI_MODEL);
    expect(update.agentType).toBe('gemini');
  });

  it('returns {} for same-kind model change (no agentType flip needed)', () => {
    // Create a Claude waiting session
    const claudeSession = sessions.create(project.id, 'Claude Derive Session', 'test', {
      model: CLAUDE_MODEL,
      providerId: anthropicProvider.id,
      status: 'waiting',
    });
    const freshSession = sessions.getById(claudeSession.id);

    // Same-kind: switching between two Claude models → no agentType change
    const update = deriveAgentTypeUpdate(freshSession, claudeSession.id, CLAUDE_MODEL);
    expect(update.agentType).toBeUndefined();
  });

  it('returns {} when the session has assistant messages (not a draft)', () => {
    messages.create(session.id, 'assistant', 'I am an assistant');
    const freshSession = sessions.getById(session.id);
    const update = deriveAgentTypeUpdate(freshSession, session.id, CLAUDE_MODEL);
    expect(update).toEqual({});
  });

  it('does not auto-set providerId when caller passes an explicit providerId', () => {
    const freshSession = sessions.getById(session.id);
    // Caller explicitly passes providerId → we must not override it
    const update = deriveAgentTypeUpdate(freshSession, session.id, CLAUDE_MODEL, {
      providerId: anthropicProvider.id,
    });
    // agentType should still be derived
    expect(update.agentType).toBe('claude-code');
    // but providerId must NOT be set in the returned update (caller controls it)
    expect(update.providerId).toBeUndefined();
  });

  it('auto-derives providerId when caller omits it and model belongs to a known provider', () => {
    const freshSession = sessions.getById(session.id);
    const update = deriveAgentTypeUpdate(freshSession, session.id, CLAUDE_MODEL);
    // providerId should be auto-set since caller didn't supply one
    expect(update.providerId).toBe(anthropicProvider.id);
  });
});
