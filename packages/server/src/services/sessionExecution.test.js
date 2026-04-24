import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the SDK to prevent real API calls — capture queryParams for assertions
// vi.hoisted ensures the variable is available when vi.mock factory runs (hoisted to top)
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

import { buildQueryParams, createAgentForSession } from './sessionExecution.js';
import { continueSession, runSession, continueSessionWithExistingMessage } from './sessionManager.js';
import * as sessionProvider from './sessionProvider.js';
import { agentGateway } from '../agents/AgentGateway.js';

import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { ConversationRepository } from '../db/ConversationRepository.js';

// ── buildQueryParams ────────────────────────────────────────────────────────

describe('buildQueryParams', () => {
  const savedVCR = process.env.VCR_MODE;

  afterEach(() => {
    if (savedVCR !== undefined) {
      process.env.VCR_MODE = savedVCR;
    } else {
      delete process.env.VCR_MODE;
    }
  });

  const baseArgs = () => ({
    prompt: 'Hello',
    workingDirectory: '/tmp/test',
    controller: new AbortController(),
    session: { mode: 'standard', projectId: 'proj-1' },
    sessionId: 'sess-1',
    systemPrompt: null,
    model: null,
    sessionEnv: {},
  });

  it('uses provided model', () => {
    const args = { ...baseArgs(), model: 'claude-sonnet-4-20250514' };
    const result = buildQueryParams(args);
    expect(result.options.model).toBe('claude-sonnet-4-20250514');
  });

  it('passes null model as-is', () => {
    const args = { ...baseArgs(), model: null };
    const result = buildQueryParams(args);
    expect(result.options.model).toBeNull();
  });

  it('forces Haiku in VCR mode', () => {
    process.env.VCR_MODE = '1';
    const args = { ...baseArgs(), model: 'claude-opus-4-20250514' };
    const result = buildQueryParams(args);
    expect(result.options.model).toBe('claude-haiku-4-5-20251001');
  });

  it('includes resume when resumeSessionId is provided', () => {
    const args = { ...baseArgs(), resumeSessionId: 'claude-session-abc' };
    const result = buildQueryParams(args);
    expect(result.options.resume).toBe('claude-session-abc');
  });

  it('omits resume when resumeSessionId is null', () => {
    const args = { ...baseArgs(), resumeSessionId: null };
    const result = buildQueryParams(args);
    expect(result.options.resume).toBeUndefined();
  });
});

// ── continueSessionCore model fallback ──────────────────────────────────────

describe('continueSessionCore model fallback', () => {
  let sessionRepo;
  let _messageRepo;
  let conversationRepo;
  let projectRepo;
  let session;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    _messageRepo = new MessageRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'session-exec-test-'));
    const project = projectRepo.create('Test Project', tempDir);

    session = sessionRepo.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, {
      claudeSessionId: 'mock-claude-session-id',
      model: 'claude-sonnet-4-20250514',
    });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes session.model to SDK when model option is null', async () => {
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: null });

    // The SDK query function should have been called with the session's model
    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-sonnet-4-20250514');
  });

  it('uses explicit model when provided', async () => {
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: 'claude-opus-4-20250514' });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-opus-4-20250514');
  });

  it('passes null to SDK when neither model option nor session.model is set', async () => {
    // Update session to have no model
    sessionRepo.update(session.id, { model: null });
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBeNull();
  });

  it('resolves provider from session.model when model option is null', async () => {
    const spy = vi.spyOn(sessionProvider, 'resolveProviderFromModel');
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: null });

    // resolveProviderFromModel should be called with session.model (the fallback),
    // not null, so third-party provider env vars are correctly resolved.
    expect(spy).toHaveBeenCalledWith('claude-sonnet-4-20250514');
    spy.mockRestore();
  });
});

// ── runSessionCore model fallback ───────────────────────────────────────────

describe('runSessionCore model fallback', () => {
  let sessionRepo;
  let projectRepo;
  let _conversationRepo;
  let session;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    _conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'run-session-test-'));
    const project = projectRepo.create('Test Project', tempDir);

    session = sessionRepo.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, {
      model: 'claude-sonnet-4-20250514',
    });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes session.model to SDK when model option is null', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-sonnet-4-20250514');
  });

  it('uses explicit model when provided', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: 'claude-opus-4-20250514' });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-opus-4-20250514');
  });
});

// ── continueSessionWithExistingMessage model fallback ───────────────────────

describe('continueSessionWithExistingMessage model fallback', () => {
  let sessionRepo;
  let messageRepo;
  let conversationRepo;
  let projectRepo;
  let session;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    messageRepo = new MessageRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'existing-msg-test-'));
    const project = projectRepo.create('Test Project', tempDir);

    session = sessionRepo.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessionRepo.update(session.id, {
      claudeSessionId: 'mock-claude-session-id',
      model: 'claude-sonnet-4-20250514',
    });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes session.model to SDK when model option is null', async () => {
    const conversation = conversationRepo.create(session.id, 'Test Conversation');
    messageRepo.create(session.id, 'user', 'Existing message', { conversationId: conversation.id });

    await continueSessionWithExistingMessage(session.id, conversation.id, tempDir, { model: null });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-sonnet-4-20250514');
  });

  it('uses explicit model when provided', async () => {
    const conversation = conversationRepo.create(session.id, 'Test Conversation');
    messageRepo.create(session.id, 'user', 'Existing message', { conversationId: conversation.id });

    await continueSessionWithExistingMessage(session.id, conversation.id, tempDir, { model: 'claude-opus-4-20250514' });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-opus-4-20250514');
  });

  it('resolves provider from session.model when model option is null', async () => {
    const spy = vi.spyOn(sessionProvider, 'resolveProviderFromModel');
    const conversation = conversationRepo.create(session.id, 'Test Conversation');
    messageRepo.create(session.id, 'user', 'Existing message', { conversationId: conversation.id });

    await continueSessionWithExistingMessage(session.id, conversation.id, tempDir, { model: null });

    // resolveProviderFromModel should be called with session.model (the fallback),
    // not null, so third-party provider env vars are correctly resolved.
    expect(spy).toHaveBeenCalledWith('claude-sonnet-4-20250514');
    spy.mockRestore();
  });
});

// ── buildQueryParams agent-aware ────────────────────────────────────────────

describe('buildQueryParams agent-aware', () => {
  const savedVCR = process.env.VCR_MODE;

  afterEach(() => {
    if (savedVCR !== undefined) process.env.VCR_MODE = savedVCR;
    else delete process.env.VCR_MODE;
  });

  const baseArgs = () => ({
    prompt: 'Hello',
    workingDirectory: '/tmp/test',
    controller: new AbortController(),
    session: { mode: 'standard', projectId: 'proj-1' },
    sessionId: 'sess-1',
    systemPrompt: null,
    model: 'gpt-4o',
    sessionEnv: { OPENAI_API_KEY: 'sk-test' },
  });

  it('claude-code (default) retains Claude-specific options', () => {
    const args = {
      ...baseArgs(),
      agentType: 'claude-code',
      model: 'claude-sonnet-4-20250514',
    };
    const result = buildQueryParams(args);
    expect(result.options.settingSources).toEqual(['project']);
    expect(result.options.includePartialMessages).toBe(true);
    expect(typeof result.options.spawnClaudeCodeProcess).toBe('function');
    expect(result.options.permissionMode).toBeDefined();
  });

  it('codex: options has cwd, abortController, env, model, systemPrompt, sandboxMode and omits Claude-specific fields', () => {
    const args = { ...baseArgs(), agentType: 'codex' };
    const result = buildQueryParams(args);
    expect(result.options.cwd).toBe('/tmp/test');
    expect(result.options.abortController).toBeInstanceOf(AbortController);
    expect(result.options.env).toEqual({ OPENAI_API_KEY: 'sk-test' });
    expect(result.options.model).toBe('gpt-4o');
    expect(result.options.systemPrompt).toBeNull();
    // standard session.mode → workspace-write sandbox
    expect(result.options.sandboxMode).toBe('workspace-write');

    expect(result.options.settingSources).toBeUndefined();
    expect(result.options.spawnClaudeCodeProcess).toBeUndefined();
    expect(result.options.includePartialMessages).toBeUndefined();
    expect(result.options.permissionMode).toBeUndefined();
    expect(result.options.resume).toBeUndefined();
  });

  it('codex: maps session.mode "plan" to sandbox "read-only"', () => {
    const args = {
      ...baseArgs(),
      agentType: 'codex',
      session: { mode: 'plan', projectId: 'proj-1' },
    };
    expect(buildQueryParams(args).options.sandboxMode).toBe('read-only');
  });

  it('codex: maps session.mode "yolo" to sandbox "danger-full-access"', () => {
    const args = {
      ...baseArgs(),
      agentType: 'codex',
      session: { mode: 'yolo', projectId: 'proj-1' },
    };
    expect(buildQueryParams(args).options.sandboxMode).toBe('danger-full-access');
  });

  it('codex: ignores resumeSessionId (no resume option)', () => {
    const args = {
      ...baseArgs(),
      agentType: 'codex',
      resumeSessionId: 'some-prior-session',
    };
    const result = buildQueryParams(args);
    expect(result.options.resume).toBeUndefined();
  });

  it('codex: VCR mode forces gpt-4o-mini', () => {
    process.env.VCR_MODE = '1';
    const args = { ...baseArgs(), agentType: 'codex', model: 'gpt-4o' };
    const result = buildQueryParams(args);
    expect(result.options.model).toBe('gpt-4o-mini');
  });

  it('codex: propagates string systemPrompt', () => {
    const args = { ...baseArgs(), agentType: 'codex', systemPrompt: 'be helpful' };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toBe('be helpful');
  });
});

// ── createAgentForSession config forwarding ────────────────────────────────

describe('createAgentForSession config forwarding', () => {
  it('claude-code → calls agentGateway.createAgent("claude-code", {})', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    createAgentForSession('claude-code');
    expect(spy).toHaveBeenCalledWith('claude-code', {});
    spy.mockRestore();
  });

  it('codex → calls agentGateway.createAgent("codex", { spawnCodexProcess: <function> })', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    createAgentForSession('codex');
    expect(spy).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({ spawnCodexProcess: expect.any(Function) }),
    );
    spy.mockRestore();
  });
});

// ── Phase 7: runtime glue reads session.agentType ──────────────────────────

describe('Phase 7: sessionExecution agent-type dispatch', () => {
  let sessionRepo;
  let conversationRepo;
  let projectRepo;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'phase7-exec-test-'));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runSession for session.agentType="codex" calls agentGateway.createAgent("codex", ...), not "claude-code"', async () => {
    // Stub the Codex adapter so we don't actually spawn a process: swap in a
    // generator that yields a single assistant + result.
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'codex reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    const project = projectRepo.create('Codex RunSession Project', tempDir);
    const session = sessionRepo.create(project.id, 'Codex Session', 'initial prompt', {
      agentType: 'codex',
      model: 'gpt-4o-test',
    });

    await runSession(session.id, 'initial prompt', tempDir, { model: 'gpt-4o-test' });

    expect(createAgentSpy).toHaveBeenCalled();
    const [agentTypeArg] = createAgentSpy.mock.calls[0];
    expect(agentTypeArg).toBe('codex');
    // And not the Claude SDK mock — Codex does not flow through @anthropic-ai/claude-agent-sdk.
    expect(mockQuery).not.toHaveBeenCalled();

    createAgentSpy.mockRestore();
  });

  it('continueSession for session.agentType="codex" does NOT pass resume (canResume=false)', async () => {
    let capturedQueryParams = null;
    const stubAgent = {
      execute: vi.fn(async function* (queryParams) {
        capturedQueryParams = queryParams;
        yield { type: 'assistant', text: 'codex reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    const project = projectRepo.create('Codex Continue Project', tempDir);
    const session = sessionRepo.create(project.id, 'Codex Session', 'initial prompt', {
      agentType: 'codex',
      model: 'gpt-4o-test',
    });
    // Simulate a prior Codex turn having "claudeSessionId" set — even if set,
    // the Codex code path must NOT forward it as resume because Codex adapter
    // doesn't support resume.
    sessionRepo.update(session.id, { claudeSessionId: 'prior-codex-id' });
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'follow up', tempDir, { model: 'gpt-4o-test' });

    expect(createAgentSpy).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({ spawnCodexProcess: expect.any(Function) }),
    );
    expect(capturedQueryParams).not.toBeNull();
    // Codex query params must not carry a resume field, regardless of any
    // prior claudeSessionId on the session row.
    expect(capturedQueryParams.options.resume).toBeUndefined();

    createAgentSpy.mockRestore();
  });
});
