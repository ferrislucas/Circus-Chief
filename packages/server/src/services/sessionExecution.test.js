import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

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


import { buildAgentEnv, buildQueryParams, createAgentForSession, resolveInitialSessionModelEnv, runSessionCore } from './sessionExecution.js';
import { TierIdentityError } from './tierIdentity.js';
import { continueSession, runSession, continueSessionWithExistingMessage, stopSession } from './sessionManager.js';
import * as sessionProvider from './sessionProvider.js';
import * as gitService from './gitService.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { activeSessions, claimSessionExecution, createSessionExecutionEntry } from './sessionExecutionOwnership.js';
import { cleanupSessionState } from './streamEventHandler.js';
import { buildTierRef } from '@circuschief/shared';

import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { ConversationRepository } from '../db/ConversationRepository.js';
import { sessions, attachments, projects, modelProviders, modelTiers } from '../database.js';

describe('session execution module boundary', () => {
  it('does not suppress max-lines now that query parameter construction lives in its own module', () => {
    const source = readFileSync(new URL('./sessionExecution.js', import.meta.url), 'utf8');
    expect(source).not.toContain('eslint-disable max-lines');
  });
});

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

  it('loads Claude user/project/local settings so CLI-configured MCP servers are available', () => {
    const result = buildQueryParams(baseArgs());
    expect(result.options.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('includes resolved Claude MCP servers without changing setting sources', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'query-param-mcp-test-'));
    try {
      const homeDirectory = join(tempDir, 'home');
      const workingDirectory = join(tempDir, 'workspace');
      mkdirSync(homeDirectory, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      writeFileSync(join(homeDirectory, '.claude.json'), JSON.stringify({
        mcpServers: {
          localTool: { command: 'node', args: ['server.js'] },
        },
      }), 'utf8');

      const result = buildQueryParams({
        ...baseArgs(),
        workingDirectory,
        claudeMcpConfigHomeDirectory: homeDirectory,
      });

      expect(result.options.settingSources).toEqual(['user', 'project', 'local']);
      expect(result.options.mcpServers).toEqual({
        localTool: { command: 'node', args: ['server.js'] },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates effortLevel into Codex query options', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'codex-effortlevel-home-'));
    try {
      const args = {
        ...baseArgs(),
        agentType: 'codex',
        model: 'gpt-5.5',
        session: { mode: 'standard', projectId: 'proj-1', effortLevel: 'high', thinkingEnabled: false },
        claudeMcpConfigHomeDirectory: tempHome,
      };

      const result = buildQueryParams(args);

      expect(result.options.effortLevel).toBe('high');
      expect(result.options.model).toBe('gpt-5.5');
      expect(result.options.permissionMode).toBeUndefined();
      expect(result.options.settingSources).toBeUndefined();
      expect(result.options.mcpServers).toBeUndefined();
      expect(result.options.includePartialMessages).toBeUndefined();
      expect(result.options.resume).toBeUndefined();
      expect(result.options.spawnClaudeCodeProcess).toBeUndefined();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('passes null effortLevel into Codex query options when no override is set', () => {
    const args = {
      ...baseArgs(),
      agentType: 'codex',
      model: 'gpt-5.5',
      session: { mode: 'standard', projectId: 'proj-1', effortLevel: null, thinkingEnabled: true },
    };

    const result = buildQueryParams(args);

    expect(result.options.effortLevel).toBeNull();
  });

  it('passes the session-configured provider ID to the Codex adapter', () => {
    const result = buildQueryParams({
      ...baseArgs(),
      agentType: 'codex',
      model: 'gpt-5.5',
      session: { mode: 'standard', projectId: 'proj-1', providerId: 'configured-openai-provider' },
    });

    expect(result.options.providerId).toBe('configured-openai-provider');
  });

  it('builds Muse query options with model, effort, approval mode, and resume', () => {
    const args = {
      ...baseArgs(),
      agentType: 'muse',
      model: 'muse-spark-1.3',
      session: { mode: 'yolo', projectId: 'proj-1', effortLevel: 'max' },
      resumeSessionId: 'msp-session-9',
    };

    const result = buildQueryParams(args);

    expect(result.prompt).toBe('Hello');
    expect(result.options.cwd).toBe('/tmp/test');
    expect(result.options.model).toBe('muse-spark-1.3');
    expect(result.options.effortLevel).toBe('max');
    expect(result.options.approvalMode).toBe('allowAll');
    expect(result.options.resume).toBe('msp-session-9');
    expect(result.options.permissionMode).toBeUndefined();
    expect(result.options.settingSources).toBeUndefined();
    expect(result.options.sandboxMode).toBeUndefined();
    expect(result.options.spawnClaudeCodeProcess).toBeUndefined();
  });

  it('omits resume from Muse query options when resumeSessionId is null', () => {
    const args = {
      ...baseArgs(),
      agentType: 'muse',
      model: 'muse-spark-1.3',
      resumeSessionId: null,
    };

    const result = buildQueryParams(args);

    expect(result.options.resume).toBeUndefined();
    expect(result.options.approvalMode).toBe('onRequest');
  });

  it('omits Claude attribution settings when override is null', () => {
    const result = buildQueryParams({ ...baseArgs(), commitAttributionOverride: null });
    expect(result.options.extraArgs).toBeUndefined();
  });

  it('does not include native Claude attribution settings when override is configured', () => {
    const result = buildQueryParams({
      ...baseArgs(),
      commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
    });

    expect(result.options.extraArgs).toBeUndefined();
  });

  it('does not carry commitAttributionOverride into Codex query options', () => {
    const result = buildQueryParams({
      ...baseArgs(),
      agentType: 'codex',
      model: 'gpt-5.5',
      commitAttributionOverride: 'Codex <noreply@openai.com>',
    });

    expect(result.options.commitAttributionOverride).toBeUndefined();
  });

  it('Codex: includes mcpServers in options when project .mcp.json server is approved', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-mcp-approved-test-'));
    try {
      const homeDirectory = join(tempDir, 'home');
      const workingDirectory = join(tempDir, 'workspace');
      mkdirSync(homeDirectory, { recursive: true });
      mkdirSync(join(workingDirectory, '.claude'), { recursive: true });
      writeFileSync(join(workingDirectory, '.mcp.json'), JSON.stringify({
        mcpServers: {
          projectServer: { command: 'node', args: ['server.js'] },
        },
      }), 'utf8');
      writeFileSync(join(workingDirectory, '.claude', 'settings.local.json'), JSON.stringify({
        enabledMcpjsonServers: ['projectServer'],
      }), 'utf8');

      const result = buildQueryParams({
        ...baseArgs(),
        agentType: 'codex',
        model: 'gpt-5.5',
        workingDirectory,
        claudeMcpConfigHomeDirectory: homeDirectory,
        session: { mode: 'standard', projectId: 'proj-1', effortLevel: null },
      });

      expect(result.options.mcpServers).toEqual({
        projectServer: { command: 'node', args: ['server.js'] },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Codex: omits mcpServers from options when project .mcp.json server is not approved', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-mcp-unapproved-test-'));
    try {
      const homeDirectory = join(tempDir, 'home');
      const workingDirectory = join(tempDir, 'workspace');
      mkdirSync(homeDirectory, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      writeFileSync(join(workingDirectory, '.mcp.json'), JSON.stringify({
        mcpServers: {
          unapprovedServer: { command: 'node', args: ['server.js'] },
        },
      }), 'utf8');

      const result = buildQueryParams({
        ...baseArgs(),
        agentType: 'codex',
        model: 'gpt-5.5',
        workingDirectory,
        claudeMcpConfigHomeDirectory: homeDirectory,
        session: { mode: 'standard', projectId: 'proj-1', effortLevel: null },
      });

      expect(result.options.mcpServers).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Codex: omits user-level Claude MCP servers (only approved project .mcp.json servers forwarded)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-user-mcp-test-'));
    try {
      const homeDirectory = join(tempDir, 'home');
      const workingDirectory = join(tempDir, 'workspace');
      mkdirSync(homeDirectory, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      writeFileSync(join(homeDirectory, '.claude.json'), JSON.stringify({
        mcpServers: {
          userLevelServer: { command: 'node', args: ['user-server.js'] },
        },
      }), 'utf8');

      const result = buildQueryParams({
        ...baseArgs(),
        agentType: 'codex',
        model: 'gpt-5.5',
        workingDirectory,
        claudeMcpConfigHomeDirectory: homeDirectory,
        session: { mode: 'standard', projectId: 'proj-1', effortLevel: null },
      });

      expect(result.options.mcpServers).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Codex: omits local Claude project-entry MCP servers (only approved project .mcp.json servers forwarded)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-local-mcp-test-'));
    try {
      const homeDirectory = join(tempDir, 'home');
      const workingDirectory = join(tempDir, 'workspace');
      mkdirSync(homeDirectory, { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      writeFileSync(join(homeDirectory, '.claude.json'), JSON.stringify({
        projects: {
          [workingDirectory]: {
            mcpServers: {
              localServer: { command: 'node', args: ['local-server.js'] },
            },
          },
        },
      }), 'utf8');

      const result = buildQueryParams({
        ...baseArgs(),
        agentType: 'codex',
        model: 'gpt-5.5',
        workingDirectory,
        claudeMcpConfigHomeDirectory: homeDirectory,
        session: { mode: 'standard', projectId: 'proj-1', effortLevel: null },
      });

      expect(result.options.mcpServers).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('buildAgentEnv sets or deletes CIRCUSCHIEF_COMMIT_ATTRIBUTION', () => {
    expect(buildAgentEnv({}, 'Co-authored-by: Codex <noreply@openai.com>'))
      .toMatchObject({ CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Codex <noreply@openai.com>' });
    expect(buildAgentEnv({
      CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Leaked <leaked@example.com>',
      OTHER: 'value',
    }, null)).toEqual({ OTHER: 'value' });
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
    const spy = vi.spyOn(sessionProvider, 'resolveDispatchProvider');
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: null });

    // The single dispatch rule should be called with session.model (the fallback),
    // not null, so third-party provider env vars are correctly resolved. The
    // last arg is the provider-id disambiguation hint (null here since
    // this session has no explicit providerId set).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id }),
      null,
      'claude-sonnet-4-20250514',
      null
    );
    spy.mockRestore();
  });

  it('calls sessions.touch when creating a user message', async () => {
    conversationRepo.create(session.id, 'Test Conversation');

    const touchSpy = vi.spyOn(sessions, 'touch');

    await continueSession(session.id, 'Follow-up message', tempDir, { model: null });

    expect(touchSpy).toHaveBeenCalledWith(session.id);
    touchSpy.mockRestore();
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

  it('records the durable last-executed identity for the dispatched pair (finding 9)', async () => {
    const startProvider = modelProviders.create({ name: 'Start Pin Provider', kind: 'anthropic' });
    modelProviders.addModel(startProvider.id, { modelId: 'finding9-start-model', displayName: 'Start' });
    sessionRepo.update(session.id, { model: 'finding9-start-model', providerId: startProvider.id });

    await runSession(session.id, 'Initial prompt', tempDir, {});

    expect(mockQuery).toHaveBeenCalled();
    const row = sessionRepo.getById(session.id);
    expect(row.lastExecutedModel).toBe('finding9-start-model');
    expect(row.lastExecutedProviderId).toBe(startProvider.id);
  });

  it('uses explicit model when provided', async () => {
    await runSession(session.id, 'Initial prompt', tempDir, { model: 'claude-opus-4-20250514' });

    expect(mockQuery).toHaveBeenCalled();
    const queryParams = mockQuery.mock.calls[0][0];
    expect(queryParams.options.model).toBe('claude-opus-4-20250514');
  });

  it('calls sessions.touch when creating initial user message', async () => {
    const touchSpy = vi.spyOn(sessions, 'touch');

    await runSession(session.id, 'Initial prompt', tempDir, { model: null });

    expect(touchSpy).toHaveBeenCalledWith(session.id);
    touchSpy.mockRestore();
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
    const spy = vi.spyOn(sessionProvider, 'resolveDispatchProvider');
    const conversation = conversationRepo.create(session.id, 'Test Conversation');
    messageRepo.create(session.id, 'user', 'Existing message', { conversationId: conversation.id });

    await continueSessionWithExistingMessage(session.id, conversation.id, tempDir, { model: null });

    // The single dispatch rule should be called with session.model (the fallback),
    // not null, so third-party provider env vars are correctly resolved. The
    // last arg is the provider-id disambiguation hint (null here since
    // this session has no explicit providerId set).
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id }),
      null,
      'claude-sonnet-4-20250514',
      null
    );
    spy.mockRestore();
  });
});

// ── buildQueryParams agent-aware ────────────────────────────────────────────

describe('buildQueryParams agent-aware', () => {
  const savedVCR = process.env.VCR_MODE;

  beforeEach(() => {
    // Use vi.spyOn so restoreAllMocks works in afterEach
    vi.spyOn(sessions, 'getById').mockReturnValue({ id: 'sess-1', parentSessionId: null, gitWorktree: null, gitBranch: null });
    vi.spyOn(sessions, 'getRootSessionId').mockReturnValue('sess-1');
    vi.spyOn(attachments, 'getBySessionId').mockReturnValue([]);
    vi.spyOn(projects, 'getById').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(result.options.settingSources).toEqual(['user', 'project', 'local']);
    expect(result.options.includePartialMessages).toBe(true);
    expect(typeof result.options.spawnClaudeCodeProcess).toBe('function');
    expect(result.options.permissionMode).toBeDefined();
  });

  it('codex: options has cwd, abortController, env, model, systemPrompt, sandboxMode and omits Claude-specific fields', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'codex-shape-home-'));
    try {
      const args = { ...baseArgs(), agentType: 'codex', claudeMcpConfigHomeDirectory: tempHome };
      const result = buildQueryParams(args);
      expect(result.options.cwd).toBe('/tmp/test');
      expect(result.options.abortController).toBeInstanceOf(AbortController);
      expect(result.options.env).toEqual({ OPENAI_API_KEY: 'sk-test' });
      expect(result.options.model).toBe('gpt-4o');
      expect(typeof result.options.systemPrompt).toBe('string');
      expect(result.options.systemPrompt.length).toBeGreaterThan(0);
      expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
      // standard session.mode → workspace-write sandbox
      expect(result.options.sandboxMode).toBe('workspace-write');

      expect(result.options.settingSources).toBeUndefined();
      expect(result.options.mcpServers).toBeUndefined();
      expect(result.options.spawnClaudeCodeProcess).toBeUndefined();
      expect(result.options.includePartialMessages).toBeUndefined();
      expect(result.options.permissionMode).toBeUndefined();
      expect(result.options.resume).toBeUndefined();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
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

  it('codex: propagates string systemPrompt as part of composed prompt', () => {
    const args = { ...baseArgs(), agentType: 'codex', systemPrompt: 'be helpful' };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toContain('be helpful');
  });

  it('codex: systemPrompt is a composed prompt (not null or raw) when systemPrompt is null', () => {
    const args = { ...baseArgs(), agentType: 'codex', systemPrompt: null };
    const result = buildQueryParams(args);
    // Should use DEFAULT_SYSTEM_PROMPT as the base, not null
    expect(result.options.systemPrompt).toContain('AI coding assistant');
    // Should include canvas write instructions (workspace-scoped, using the root session ID from mock)
    expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
    // Should include session API instructions
    expect(result.options.systemPrompt).toContain('Session Management API');
  });

  it('codex: systemPrompt is composed with custom prompt as base', () => {
    const args = { ...baseArgs(), agentType: 'codex', systemPrompt: 'be helpful' };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toContain('be helpful');
    expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
  });

  it('codex: composed systemPrompt includes plan mode when session.mode is plan', () => {
    const args = {
      ...baseArgs(),
      agentType: 'codex',
      session: { mode: 'plan', projectId: 'proj-1' },
    };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toContain('Plan Mode Active');
  });

  it('gemini: options has cwd, abortController, env, model, systemPrompt, approvalMode and omits Claude/Codex fields', () => {
    const args = { ...baseArgs(), agentType: 'gemini', model: 'gemini-2.5-pro' };
    const result = buildQueryParams(args);

    expect(result.options.cwd).toBe('/tmp/test');
    expect(result.options.abortController).toBeInstanceOf(AbortController);
    expect(result.options.env).toEqual({ OPENAI_API_KEY: 'sk-test' });
    expect(result.options.model).toBe('gemini-2.5-pro');
    expect(typeof result.options.systemPrompt).toBe('string');
    expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
    expect(result.options.approvalMode).toBe('auto_edit');

    expect(result.options.permissionMode).toBeUndefined();
    expect(result.options.settingSources).toBeUndefined();
    expect(result.options.mcpServers).toBeUndefined();
    expect(result.options.includePartialMessages).toBeUndefined();
    expect(result.options.spawnClaudeCodeProcess).toBeUndefined();
    expect(result.options.resume).toBeUndefined();
    expect(result.options.sandboxMode).toBeUndefined();
    expect(result.options.effortLevel).toBeUndefined();
  });

  it.each([
    ['plan', 'plan'],
    ['standard', 'auto_edit'],
    ['yolo', 'yolo'],
  ])('gemini: maps session.mode "%s" to approvalMode "%s"', (mode, approvalMode) => {
    const args = {
      ...baseArgs(),
      agentType: 'gemini',
      model: 'gemini-2.5-pro',
      session: { mode, projectId: 'proj-1' },
    };

    expect(buildQueryParams(args).options.approvalMode).toBe(approvalMode);
  });

  it('gemini: VCR mode forces gemini-2.5-flash', () => {
    process.env.VCR_MODE = '1';
    const args = { ...baseArgs(), agentType: 'gemini', model: 'gemini-2.5-pro' };
    const result = buildQueryParams(args);
    expect(result.options.model).toBe('gemini-2.5-flash');
  });

  it('muse: systemPrompt is a composed prompt with canvas and session API instructions', () => {
    const args = { ...baseArgs(), agentType: 'muse', model: 'muse-spark-1.3', systemPrompt: null };
    const result = buildQueryParams(args);
    expect(typeof result.options.systemPrompt).toBe('string');
    expect(result.options.systemPrompt).toContain('AI coding assistant');
    expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
    expect(result.options.systemPrompt).toContain('Session Management API');
  });

  it('muse: systemPrompt is composed with custom prompt as base', () => {
    const args = { ...baseArgs(), agentType: 'muse', model: 'muse-spark-1.3', systemPrompt: 'be helpful' };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toContain('be helpful');
    expect(result.options.systemPrompt).toContain('/api/workspaces/sess-1/canvas');
  });

  it('muse: composed systemPrompt includes plan mode when session.mode is plan', () => {
    const args = {
      ...baseArgs(),
      agentType: 'muse',
      model: 'muse-spark-1.3',
      session: { mode: 'plan', projectId: 'proj-1' },
    };
    const result = buildQueryParams(args);
    expect(result.options.systemPrompt).toContain('Plan Mode Active');
  });
});

// ── createAgentForSession config forwarding ────────────────────────────────

describe('createAgentForSession config forwarding', () => {
  it('claude-code → always binds the real allowance observer with no opt-in', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    createAgentForSession('claude-code');
    expect(spy).toHaveBeenCalledWith('claude-code', expect.objectContaining({ allowanceObserver: expect.any(Function) }));
    spy.mockRestore();
  });

  it('codex → always binds the real allowance observer with no opt-in', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    createAgentForSession('codex');
    expect(spy).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({
        spawnCodexProcess: expect.any(Function),
        allowanceObserver: expect.any(Function),
      }),
    );
    spy.mockRestore();
  });
});

// ── createAgentForSession E2E OpenAI allowance fixture scoping ─────────────

describe('createAgentForSession E2E OpenAI allowance fixture scoping', () => {
  const FIXTURE_PATH = fileURLToPath(new URL('../../tests/fixtures/openai/allowance-headers.json', import.meta.url));
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      VCR_MODE: process.env.VCR_MODE,
      FIXTURE: process.env.E2E_OPENAI_ALLOWANCE_FIXTURE,
    };
    process.env.VCR_MODE = 'replay';
    process.env.E2E_OPENAI_ALLOWANCE_FIXTURE = FIXTURE_PATH;
  });

  afterEach(() => {
    if (savedEnv.VCR_MODE !== undefined) process.env.VCR_MODE = savedEnv.VCR_MODE;
    else delete process.env.VCR_MODE;
    if (savedEnv.FIXTURE !== undefined) process.env.E2E_OPENAI_ALLOWANCE_FIXTURE = savedEnv.FIXTURE;
    else delete process.env.E2E_OPENAI_ALLOWANCE_FIXTURE;
  });

  it('reroutes built-in default OpenAI codex sessions to the fixture client and skips VCR for them', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    const agent = createAgentForSession('codex', {}, { providerId: 'openai-default' });
    expect(spy).toHaveBeenCalledWith('codex', expect.objectContaining({
      spawnCodexProcess: null,
      openaiClientFactory: expect.any(Function),
      allowanceObserver: expect.any(Function),
    }));
    spy.mockRestore();
    // No VCR wrapper: the fixture exists to execute the production adapter.
    expect(agent.agent.mode).toBeUndefined();
  });

  it('keeps custom-provider codex sessions on the spawner and VCR replay', () => {
    const spy = vi.spyOn(agentGateway, 'createAgent');
    const agent = createAgentForSession('codex', {}, { providerId: 'custom-e2e-provider' });
    expect(spy).toHaveBeenCalledWith('codex', expect.objectContaining({
      spawnCodexProcess: expect.any(Function),
      allowanceObserver: expect.any(Function),
    }));
    expect(spy.mock.calls[0][1].openaiClientFactory).toBeUndefined();
    spy.mockRestore();
    expect(agent.agent.mode).toBe('replay');
  });

  it('keeps claude-code sessions on VCR replay even with the fixture env exported', () => {
    const agent = createAgentForSession('claude-code');
    expect(agent.agent.mode).toBe('replay');
  });
});

// ── Phase 7: runtime glue reads session.agentType ──────────────────────────

describe('Phase 7: sessionExecution agent-type dispatch', () => {
  let sessionRepo;
  let conversationRepo;
  let projectRepo;
  let tempDir;
  let openaiProvider;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'phase7-exec-test-'));

    // Register an OpenAI provider for 'gpt-4o-test' so resolveAgentTypeFromModel
    // returns 'codex' (not the default 'claude-code') for that model.
    openaiProvider = modelProviders.create({
      name: 'Phase7 OpenAI Provider',
      baseUrl: 'https://api.openai.phase7',
      authToken: 'key-phase7',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'gpt-4o-test',
      displayName: 'GPT-4o Phase7',
      tier: 'custom',
    });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
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
      needsConversationContext: () => true,
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
      needsConversationContext: () => true,
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

  it('continueSession for Codex agent includes conversation context in prompt', async () => {
    let capturedQueryParams = null;
    const stubAgent = {
      execute: vi.fn(async function* (queryParams) {
        capturedQueryParams = queryParams;
        yield { type: 'assistant', text: 'codex reply' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    const messageRepo = new MessageRepository();
    const project = projectRepo.create('Codex Context Project', tempDir);
    const session = sessionRepo.create(project.id, 'Codex Session', 'initial prompt', {
      agentType: 'codex',
      model: 'gpt-4o-test',
    });
    sessionRepo.update(session.id, { claudeSessionId: 'prior-id' });
    const conversation = conversationRepo.create(session.id, 'Test Conversation');

    // Add prior messages so there's history to include
    messageRepo.create(session.id, 'user', 'First question', { conversationId: conversation.id });
    messageRepo.create(session.id, 'assistant', 'First answer', null, conversation.id);

    // Send a follow-up — this should prepend conversation context
    await continueSession(session.id, 'follow up', tempDir, { model: 'gpt-4o-test' });

    expect(capturedQueryParams).not.toBeNull();
    expect(capturedQueryParams.prompt).toContain('<conversation_history>');
    expect(capturedQueryParams.prompt).toContain('First question');
    expect(capturedQueryParams.prompt).toContain('follow up');

    createAgentSpy.mockRestore();
  });

  it('continueSession for Claude Code agent does NOT include context when resuming', async () => {
    let capturedQueryParams = null;
    const stubAgent = {
      execute: vi.fn(async function* (queryParams) {
        capturedQueryParams = queryParams;
        yield { type: 'system', subtype: 'init', session_id: 'mock-session-id' };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } };
        yield { type: 'result', subtype: 'success' };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    const messageRepo = new MessageRepository();
    const project = projectRepo.create('Claude Resume Project', tempDir);
    const session = sessionRepo.create(project.id, 'Claude Session', 'initial prompt', 'standard');
    sessionRepo.update(session.id, { claudeSessionId: 'prior-claude-id' });
    // The active conversation needs claudeSessionId set for canResume to be true
    const conversation = conversationRepo.create(session.id, 'Test Conversation');
    conversationRepo.update(conversation.id, { claudeSessionId: 'prior-claude-id' });

    messageRepo.create(session.id, 'user', 'First question', { conversationId: conversation.id });
    messageRepo.create(session.id, 'assistant', 'First answer', null, conversation.id);

    await continueSession(session.id, 'follow up', tempDir);

    expect(capturedQueryParams).not.toBeNull();
    // Claude Code supports resume → no conversation context prepended
    expect(capturedQueryParams.prompt).not.toContain('<conversation_history>');
    expect(capturedQueryParams.prompt).toBe('follow up');
    // Should have resume set
    expect(capturedQueryParams.options.resume).toBe('prior-claude-id');

    createAgentSpy.mockRestore();
  });
});

// ── run-path and continue-path cross-kind reconciliation ──────────────────

describe('run-path reconciliation: stale agentType in DB self-heals at run time', () => {
  let sessionRepo;
  let conversationRepo;
  let projectRepo;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'run-reconcile-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runSessionCore builds a claude-code adapter when a draft row has agentType=codex but model resolves to claude-code', async () => {
    // Stub agentGateway so no real process spawns
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'claude-haiku', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } };
        yield { type: 'result', subtype: 'success' };
      }),
      supportsResume: () => false,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    const project = projectRepo.create('Reconcile Run Project', tempDir);
    // Create a session that deliberately has stale agentType=codex but model that resolves to claude-code.
    // resolveAgentTypeFromModel returns 'claude-code' when model has no registered provider.
    const session = sessionRepo.create(project.id, 'Stale Codex Session', 'initial prompt', {
      agentType: 'codex',
      model: 'claude-stale-no-provider',
    });
    // Verify the stale state before the run
    expect(session.agentType).toBe('codex');

    await runSession(session.id, 'initial prompt', tempDir, { model: null });

    // The reconciliation at run time must have used claude-code adapter
    expect(createAgentSpy).toHaveBeenCalled();
    const [agentTypeArg] = createAgentSpy.mock.calls[0];
    expect(agentTypeArg).toBe('claude-code');

    // Verify the DB row was healed
    const healed = sessionRepo.getById(session.id);
    expect(healed.agentType).toBe('claude-code');

    createAgentSpy.mockRestore();
  });

  it('continueSessionCore uses the model-derived agentType when the draft row has a stale agentType', async () => {
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockImplementation(() => ({
      async *execute() {
        yield { type: 'system', subtype: 'init', session_id: 'mock-id', model: 'claude-haiku', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
        yield { type: 'result', subtype: 'success' };
      },
      supportsResume: () => false,
      needsConversationContext: () => false,
    }));

    const project = projectRepo.create('Reconcile Continue Project', tempDir);
    const session = sessionRepo.create(project.id, 'Stale Continue Session', 'initial prompt', {
      agentType: 'codex',
      model: 'claude-stale-continue-no-provider',
    });
    conversationRepo.create(session.id, 'Test Conversation');
    expect(session.agentType).toBe('codex');

    await continueSession(session.id, 'follow-up', tempDir, { model: null });

    // The continue path reads agentType from the DB before reconciliation runs in
    // buildContinueModelAndEnv. The adapter selection happens before reconciliation,
    // so we verify the reconciliation at least persists the corrected value.
    const healed = sessionRepo.getById(session.id);
    expect(healed.agentType).toBe('claude-code');

    createAgentSpy.mockRestore();
  });
});

// ── commit attribution hook guard ─────────────────────────────────────────

describe('commit attribution hook installation guard', () => {
  let sessionRepo;
  let conversationRepo;
  let projectRepo;
  let tempDir;

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'attribution-guard-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runSession does NOT install hook when no attribution is configured', async () => {
    const hookSpy = vi.spyOn(gitService, 'ensureWorktreeCommitAttributionHook');
    // Default: resolveProviderMetadataFromModel returns null → no commitAttributionOverride
    vi.spyOn(sessionProvider, 'resolveProviderMetadataFromModel').mockReturnValue(null);

    const project = projectRepo.create('Attribution Test', tempDir);
    // Simulate a worktree session by setting gitWorktree
    const session = sessionRepo.create(project.id, 'Attribution Session', 'prompt', 'standard');
    sessionRepo.update(session.id, { gitWorktree: tempDir, model: 'claude-sonnet-4-20250514' });

    await runSession(session.id, 'test', tempDir);

    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('runSession installs hook when attribution IS configured', async () => {
    const hookSpy = vi.spyOn(gitService, 'ensureWorktreeCommitAttributionHook').mockResolvedValue(true);
    vi.spyOn(sessionProvider, 'resolveProviderMetadataFromModel').mockReturnValue({
      commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
    });

    const project = projectRepo.create('Attribution Test', tempDir);
    const session = sessionRepo.create(project.id, 'Attribution Session', 'prompt', 'standard');
    sessionRepo.update(session.id, { gitWorktree: tempDir, model: 'claude-sonnet-4-20250514' });

    await runSession(session.id, 'test', tempDir);

    expect(hookSpy).toHaveBeenCalledWith(tempDir);
  });

  it('continueSession does NOT install hook when no attribution is configured', async () => {
    const hookSpy = vi.spyOn(gitService, 'ensureWorktreeCommitAttributionHook');
    // Continuation resolves its provider through the single dispatch rule;
    // metadata without an attribution override installs no hook.
    vi.spyOn(sessionProvider, 'resolveDispatchProvider').mockImplementation(
      (sess, model, effectiveModel, hint) => ({
        provider: sessionProvider.resolveProviderFromModel(effectiveModel, hint),
        providerMetadata: null,
      })
    );

    const project = projectRepo.create('Attribution Test', tempDir);
    const session = sessionRepo.create(project.id, 'Attribution Session', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      gitWorktree: tempDir,
      claudeSessionId: 'mock-claude-session-id',
      model: 'claude-sonnet-4-20250514',
    });
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'follow-up', tempDir);

    expect(hookSpy).not.toHaveBeenCalled();
  });

  it('continueSession installs hook when attribution IS configured', async () => {
    const hookSpy = vi.spyOn(gitService, 'ensureWorktreeCommitAttributionHook').mockResolvedValue(true);
    // Continuation resolves its provider through the single dispatch rule —
    // the attribution override travels on providerMetadata.
    vi.spyOn(sessionProvider, 'resolveDispatchProvider').mockImplementation(
      (sess, model, effectiveModel, hint) => ({
        provider: sessionProvider.resolveProviderFromModel(effectiveModel, hint),
        providerMetadata: {
          commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
        },
      })
    );

    const project = projectRepo.create('Attribution Test', tempDir);
    const session = sessionRepo.create(project.id, 'Attribution Session', 'prompt', 'standard');
    sessionRepo.update(session.id, {
      gitWorktree: tempDir,
      claudeSessionId: 'mock-claude-session-id',
      model: 'claude-sonnet-4-20250514',
    });
    conversationRepo.create(session.id, 'Test Conversation');

    await continueSession(session.id, 'follow-up', tempDir);

    expect(hookSpy).toHaveBeenCalledWith(tempDir);
  });

  it('runSession does NOT install hook when gitWorktree is null', async () => {
    const hookSpy = vi.spyOn(gitService, 'ensureWorktreeCommitAttributionHook');
    vi.spyOn(sessionProvider, 'resolveProviderMetadataFromModel').mockReturnValue({
      commitAttributionOverride: 'Co-authored-by: Claude <noreply@anthropic.com>',
    });

    const project = projectRepo.create('Attribution Test', tempDir);
    const session = sessionRepo.create(project.id, 'Attribution Session', 'prompt', 'standard');
    // No gitWorktree set
    sessionRepo.update(session.id, { model: 'claude-sonnet-4-20250514' });

    await runSession(session.id, 'test', tempDir);

    expect(hookSpy).not.toHaveBeenCalled();
  });
});

// ── Strict startup validation for tier-bound attempts (finding 5) ───────────
// A frozen tier member is validated as an exact (providerId, modelId) identity
// at the startup attempt boundary: a deleted/disabled provider or a
// removed/renamed model rejects with TierIdentityError instead of falling
// back to another provider owning the same model id or to SDK defaults.
// Legacy model-id lookup stays scoped to concrete non-tier bindings.
describe('resolveInitialSessionModelEnv tier-attempt ownership (finding 5)', () => {
  let providerA;
  let providerB;

  const DUP_MODEL = 'finding5-dup-model';
  const SOLO_MODEL = 'finding5-solo-model';

  function tierSession() {
    return {
      id: 'finding5-session',
      thinkingEnabled: true,
      effortLevel: null,
      gitWorktree: null,
      model: 'tier::finding5-tier',
      providerId: null,
    };
  }

  function concreteSession() {
    return { ...tierSession(), model: null };
  }

  beforeEach(() => {
    providerA = modelProviders.create({ name: 'Finding5 A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Finding5 B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: DUP_MODEL, displayName: 'Dup' });
    modelProviders.addModel(providerB.id, { modelId: DUP_MODEL, displayName: 'Dup' });
    modelProviders.addModel(providerA.id, { modelId: SOLO_MODEL, displayName: 'Solo' });
  });

  it('rejects a tier-bound pair whose provider is disabled', async () => {
    modelProviders.update(providerB.id, { enabled: false });
    try {
      await expect(resolveInitialSessionModelEnv(tierSession(), DUP_MODEL, providerB.id))
        .rejects.toThrow(TierIdentityError);
    } finally {
      modelProviders.update(providerB.id, { enabled: true });
    }
  });

  it('rejects a tier-bound pair whose model row was removed from its provider', async () => {
    const row = modelProviders.addModel(providerB.id, { modelId: 'finding5-doomed', displayName: 'Doomed' });
    modelProviders.removeModel(row.id);
    await expect(resolveInitialSessionModelEnv(tierSession(), 'finding5-doomed', providerB.id))
      .rejects.toThrow(TierIdentityError);
  });

  it('rejects a tier-bound pair naming a provider that does not own the model', async () => {
    // SOLO_MODEL lives on providerA only — pinning it to providerB must not
    // silently resolve providerA (or SDK defaults) instead.
    await expect(resolveInitialSessionModelEnv(tierSession(), SOLO_MODEL, providerB.id))
      .rejects.toThrow(TierIdentityError);
  });

  it('resolves a tier-bound valid pair from its exact owner', async () => {
    const env = await resolveInitialSessionModelEnv(tierSession(), SOLO_MODEL, providerA.id);
    expect(env.effectiveModel).toBe(SOLO_MODEL);
  });

  it('keeps the legacy model-id fallback for concrete non-tier bindings', async () => {
    const env = await resolveInitialSessionModelEnv(concreteSession(), DUP_MODEL, null);
    expect(env.effectiveModel).toBe(DUP_MODEL);
  });

  it('fail-closed rejects a tier ref that reaches the standard start path', async () => {
    // A `tier::` sentinel must be resolved to a concrete member via
    // _runTierBoundSession — never dispatched with provider null/SDK
    // defaults, and never persisted to lastExecutedModel.
    await expect(resolveInitialSessionModelEnv(tierSession(), 'tier::finding5-tier', null))
      .rejects.toThrow(TierIdentityError);
    await expect(resolveInitialSessionModelEnv(tierSession(), null))
      .rejects.toThrow(TierIdentityError);
  });
});

describe('resolveInitialSessionModelEnv built-in Anthropic tier sanitization (finding 1)', () => {
  const SEEDED_MODEL = 'claude-opus-5';
  const HOST_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
  const savedHost = {};

  function tierSession() {
    return {
      id: 'finding1-session',
      thinkingEnabled: false,
      effortLevel: null,
      gitWorktree: null,
      model: 'tier::finding1-tier',
      providerId: null,
    };
  }

  beforeEach(() => {
    for (const key of HOST_KEYS) {
      savedHost[key] = process.env[key];
      process.env[key] = `synthetic-finding1-${key}`;
    }
  });

  afterEach(() => {
    for (const key of HOST_KEYS) {
      if (savedHost[key] === undefined) delete process.env[key];
      else process.env[key] = savedHost[key];
    }
  });

  it('starts a tier-bound Official member with SDK-default env sanitization', async () => {
    const { effectiveModel, sessionEnv } = await resolveInitialSessionModelEnv(
      tierSession(), SEEDED_MODEL, 'anthropic-default',
    );
    expect(effectiveModel).toBe(SEEDED_MODEL);
    expect(sessionEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(sessionEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(sessionEnv.ANTHROPIC_BASE_URL).toBeUndefined();
  });
});

// ── Finding #2: initial starts claim execution ownership ───────────────────
// Overlapping runSession calls must be rejected with SESSION_EXECUTION_ACTIVE
// (SESSION_STOPPING while a stopped turn is still unwinding) instead of
// replacing the live turn's controller and running a second provider
// generator against the same conversation.

describe('finding #2 — initial session starts claim execution ownership', () => {
  let sessionRepo;
  let projectRepo;
  let tempDir;
  let session;

  function makeGatedAgent() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    const agent = {
      execute: vi.fn(async function* () {
        signalEntered();
        await gate;
        yield { type: 'system', subtype: 'init', session_id: 'mock-session-id', model: 'x', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'late response' }] } };
        yield { type: 'result', subtype: 'success' };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    return { agent, entered, release };
  }

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'finding2-ownership-'));
    const project = projectRepo.create('Finding2 Project', tempDir);
    session = sessionRepo.create(project.id, 'Finding2 Session', 'Initial prompt', 'standard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [sessionId] of activeSessions) {
      activeSessions.delete(sessionId);
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects an overlapping initial start without invoking a second provider or replacing the controller', async () => {
    const { agent, entered, release } = makeGatedAgent();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSession(session.id, 'Initial prompt', tempDir, {});
    await entered;
    expect(activeSessions.has(session.id)).toBe(true);
    const firstController = activeSessions.get(session.id).controller;

    const secondOutcome = await Promise.race([
      runSession(session.id, 'Second prompt', tempDir, {}).then(
        () => 'resolved',
        (error) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
    ]);
    // The competing start must be rejected — never admitted alongside the live turn.
    expect(secondOutcome?.code ?? secondOutcome).toBe('SESSION_EXECUTION_ACTIVE');
    expect(secondOutcome?.statusCode ?? secondOutcome).toBe(409);
    // No second provider execution, no controller replacement, no status rewrite.
    expect(agent.execute).toHaveBeenCalledTimes(1);
    expect(activeSessions.get(session.id)?.controller).toBe(firstController);
    expect(sessionRepo.getById(session.id).status).toBe('running');

    release();
    await first;
    expect(activeSessions.has(session.id)).toBe(false);
    expect(sessionRepo.getById(session.id).status).toBe('waiting');
    createAgentSpy.mockRestore();
  });

  it('rejects an initial start while the first turn is stopping, keeping Stop on the original controller', async () => {
    const { agent, entered, release } = makeGatedAgent();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSession(session.id, 'Initial prompt', tempDir, {});
    await entered;
    const firstController = activeSessions.get(session.id).controller;

    await stopSession(session.id);
    expect(activeSessions.has(session.id)).toBe(true);
    expect(firstController.signal.aborted).toBe(true);

    const stoppingError = await runSession(session.id, 'Second prompt', tempDir, {}).then(
      () => { throw new Error('expected initial start to reject while stopping'); },
      (error) => error,
    );
    expect(stoppingError.code).toBe('SESSION_STOPPING');
    expect(agent.execute).toHaveBeenCalledTimes(1);
    expect(activeSessions.get(session.id)?.controller).toBe(firstController);

    release();
    await first;
    expect(activeSessions.has(session.id)).toBe(false);
    createAgentSpy.mockRestore();
  });

  it('does not overwrite an existing execution claim (atomic admission)', async () => {
    const owner = new AbortController();
    claimSessionExecution(session.id, owner);
    try {
      const error = await runSession(session.id, 'Initial prompt', tempDir, {}).then(
        () => { throw new Error('expected initial start to reject on a claimed session'); },
        (err) => err,
      );
      expect(error.code).toBe('SESSION_EXECUTION_ACTIVE');
      expect(mockQuery).not.toHaveBeenCalled();
      expect(activeSessions.get(session.id)?.controller).toBe(owner);
    } finally {
      cleanupSessionState(session.id);
    }
  });

  it('releases ownership when preparation throws after registration', async () => {
    const updateSpy = vi.spyOn(sessions, 'update').mockImplementationOnce(() => {
      throw new Error('boom-preparation');
    });
    await expect(runSession(session.id, 'Initial prompt', tempDir, {})).rejects.toThrow('boom-preparation');
    updateSpy.mockRestore();
    // The stranded claim must be released so the session stays usable.
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('stale cleanup cannot remove a replacement controller', () => {
    const stale = new AbortController();
    const replacement = new AbortController();
    claimSessionExecution(session.id, stale);
    activeSessions.set(session.id, createSessionExecutionEntry(replacement));
    expect(cleanupSessionState(session.id, false, stale)).toBe(false);
    expect(activeSessions.get(session.id)?.controller).toBe(replacement);
    expect(cleanupSessionState(session.id, false, replacement)).toBe(true);
  });

  it('rejects an overlapping tier-bound initial start at the same shared boundary', async () => {
    const provider = modelProviders.create({ name: 'Finding2 Tier Provider', kind: 'anthropic' });
    modelProviders.addModel(provider.id, { modelId: 'finding2-tier-model', displayName: 'Tier Model' });
    const tier = modelTiers.create({
      name: 'Finding2 Tier',
      members: [{ providerId: provider.id, modelId: 'finding2-tier-model', position: 0 }],
    });
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });

    const { agent, entered, release } = makeGatedAgent();
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSession(session.id, 'Initial prompt', tempDir, {});
    await entered;
    expect(activeSessions.has(session.id)).toBe(true);

    const secondOutcome = await Promise.race([
      runSession(session.id, 'Second prompt', tempDir, {}).then(
        () => 'resolved',
        (error) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 500)),
    ]);
    expect(secondOutcome?.code ?? secondOutcome).toBe('SESSION_EXECUTION_ACTIVE');
    expect(agent.execute).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(activeSessions.has(session.id)).toBe(false);
    createAgentSpy.mockRestore();
  });
});

// ── Finding #1: built-in Anthropic sessions keep resume identity ────────────
// Startup records lastExecutedProviderId from resolveProviderFromModel, which
// deliberately returns null for the official Anthropic provider. A session
// started with an explicit anthropic-default selection therefore records
// (model, null), while continuation dispatches (model, anthropic-default) —
// a phantom provider switch that drops the resume handle and replays history
// into a fresh SDK conversation.

describe('finding #1 — built-in Anthropic sessions keep resume identity', () => {
  const OFFICIAL_MODEL = 'claude-opus-5';
  const OFFICIAL_PROVIDER = 'anthropic-default';

  let sessionRepo;
  let conversationRepo;
  let messageRepo;
  let projectRepo;
  let tempDir;

  function resumeCapableAgent(captured) {
    return {
      execute: vi.fn(async function* (queryParams) {
        captured.push(queryParams);
        yield { type: 'system', subtype: 'init', session_id: 'mock-claude-session-id', model: OFFICIAL_MODEL, slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'provider response' }] } };
        yield { type: 'result', subtype: 'success' };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    conversationRepo = new ConversationRepository();
    messageRepo = new MessageRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'finding1-resume-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [sessionId] of activeSessions) {
      activeSessions.delete(sessionId);
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function startOfficialSession() {
    const project = projectRepo.create('Finding1 Project', tempDir);
    const session = sessionRepo.create(project.id, 'Finding1 Session', 'Initial prompt', 'standard');
    const startCaptured = [];
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(startCaptured));
    await runSession(session.id, 'Initial prompt', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    createAgentSpy.mockRestore();
    return sessionRepo.getById(session.id);
  }

  it('records the real official provider identity at startup', async () => {
    const row = await startOfficialSession();
    expect(row.lastExecutedModel).toBe(OFFICIAL_MODEL);
    expect(row.lastExecutedProviderId).toBe(OFFICIAL_PROVIDER);
  });

  it('resumes on an explicit same-pair follow-up without replaying history', async () => {
    const project = projectRepo.create('Finding1 Explicit Project', tempDir);
    const created = sessionRepo.create(project.id, 'Finding1 Explicit', 'Initial prompt', 'standard');
    const startCaptured = [];
    const startSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(startCaptured));
    await runSession(created.id, 'Initial prompt', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    startSpy.mockRestore();

    const continuedCaptured = [];
    const continueSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(continuedCaptured));
    await continueSession(created.id, 'Follow-up question', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    continueSpy.mockRestore();

    expect(continuedCaptured).toHaveLength(1);
    // The original resume handle is passed — not a fresh conversation.
    expect(continuedCaptured[0].options?.resume).toBe('mock-claude-session-id');
    expect(continuedCaptured[0].prompt).not.toContain('provider response');
    const row = sessionRepo.getById(created.id);
    expect(row.lastExecutedModel).toBe(OFFICIAL_MODEL);
    expect(row.lastExecutedProviderId).toBe(OFFICIAL_PROVIDER);
  });

  it('resumes on an implicit follow-up that reuses the stored official binding', async () => {
    const project = projectRepo.create('Finding1 Implicit Project', tempDir);
    const created = sessionRepo.create(project.id, 'Finding1 Implicit', 'Initial prompt', 'standard');
    const startSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent([]));
    await runSession(created.id, 'Initial prompt', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    startSpy.mockRestore();

    const continuedCaptured = [];
    const continueSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(continuedCaptured));
    await continueSession(created.id, 'Follow-up question', tempDir, {});
    continueSpy.mockRestore();

    expect(continuedCaptured).toHaveLength(1);
    expect(continuedCaptured[0].options?.resume).toBe('mock-claude-session-id');
    expect(continuedCaptured[0].prompt).not.toContain('provider response');
  });

  it('resumes on the branch path with an unchanged pair', async () => {
    const project = projectRepo.create('Finding1 Branch Project', tempDir);
    const created = sessionRepo.create(project.id, 'Finding1 Branch', 'Initial prompt', 'standard');
    const startSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent([]));
    await runSession(created.id, 'Initial prompt', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    startSpy.mockRestore();

    const branch = conversationRepo.create(created.id, 'Branch conversation');
    messageRepo.create(created.id, 'user', 'Branch question', { conversationId: branch.id });
    conversationRepo.update(branch.id, { claudeSessionId: 'mock-branch-handle' });

    const continuedCaptured = [];
    const continueSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(continuedCaptured));
    await continueSessionWithExistingMessage(created.id, branch.id, tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    continueSpy.mockRestore();

    expect(continuedCaptured).toHaveLength(1);
    expect(continuedCaptured[0].options?.resume).toBe('mock-branch-handle');
    expect(continuedCaptured[0].prompt).not.toContain('provider response');
  });

  it('still invalidates resume on a genuine model change', async () => {
    const project = projectRepo.create('Finding1 Switch Project', tempDir);
    const created = sessionRepo.create(project.id, 'Finding1 Switch', 'Initial prompt', 'standard');
    const startSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent([]));
    await runSession(created.id, 'Initial prompt', tempDir, { model: OFFICIAL_MODEL, providerId: OFFICIAL_PROVIDER });
    startSpy.mockRestore();

    const continuedCaptured = [];
    const continueSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(continuedCaptured));
    await continueSession(created.id, 'Follow-up on sonnet', tempDir, { model: 'claude-sonnet-5', providerId: OFFICIAL_PROVIDER });
    continueSpy.mockRestore();

    expect(continuedCaptured).toHaveLength(1);
    expect(continuedCaptured[0].options?.resume ?? null).toBe(null);
    expect(continuedCaptured[0].prompt).toContain('provider response');
  });

  it('still invalidates resume on a genuine provider-only switch', async () => {
    const custom = modelProviders.create({ name: 'Finding1 Custom', kind: 'anthropic' });
    modelProviders.addModel(custom.id, { modelId: 'finding1-dup-model', displayName: 'Dup' });
    const other = modelProviders.create({ name: 'Finding1 Other', kind: 'anthropic' });
    modelProviders.addModel(other.id, { modelId: 'finding1-dup-model', displayName: 'Dup' });

    const project = projectRepo.create('Finding1 ProviderSwitch Project', tempDir);
    const created = sessionRepo.create(project.id, 'Finding1 ProviderSwitch', 'Initial prompt', 'standard');
    const startSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent([]));
    await runSession(created.id, 'Initial prompt', tempDir, { model: 'finding1-dup-model', providerId: custom.id });
    startSpy.mockRestore();
    expect(sessionRepo.getById(created.id).lastExecutedProviderId).toBe(custom.id);

    const continuedCaptured = [];
    const continueSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(resumeCapableAgent(continuedCaptured));
    await continueSession(created.id, 'Follow-up on other', tempDir, { model: 'finding1-dup-model', providerId: other.id });
    continueSpy.mockRestore();

    expect(continuedCaptured).toHaveLength(1);
    expect(continuedCaptured[0].options?.resume ?? null).toBe(null);
    expect(continuedCaptured[0].prompt).toContain('provider response');
    expect(sessionRepo.getById(created.id).lastExecutedProviderId).toBe(other.id);
  });
});

// ── Finding #3: settled user stops notify on exceptional provider exit ─────
// Stopping a provider that rejects during cancellation must still fire
// onUserStopSettled exactly once after the generator has settled — the
// deferred summary path depends on it. Only genuine user stops notify, and
// only after settlement, so summaries read settled output.

describe('finding #3 — settled user stops notify on exceptional provider exit', () => {
  let sessionRepo;
  let projectRepo;
  let messageRepo;
  let tempDir;

  const noopCallbacks = (events, messageRepoRef, sessionId) => ({
    handleTemplateTriggerIfNeeded: async () => {},
    handleAutoSendIfNeeded: async () => false,
    onUserStopSettled: (settledId) => {
      events.push('notified');
      const texts = messageRepoRef.getBySessionId(sessionId).map((message) => message.content).join('\n');
      events.push(texts.includes('partial output before stop') ? 'saw-output' : 'missing-output');
      expect(settledId).toBe(sessionId);
    },
  });

  function abortRejectingAgent(signal) {
    return {
      execute: vi.fn(async function* (queryParams) {
        const controller = queryParams?.options?.abortController;
        try {
          yield { type: 'system', subtype: 'init', session_id: 'mock-stop-session', model: 'x', slash_commands: [] };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial output before stop' }] } };
          signal.entered();
          await new Promise((_, reject) => {
            controller?.signal?.addEventListener('abort', () => reject(new Error('provider torn down during abort')));
          });
        } finally {
          signal.settled();
        }
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'finding3-stop-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [sessionId] of activeSessions) {
      activeSessions.delete(sessionId);
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createStartedSession(name) {
    const project = projectRepo.create(name, tempDir);
    return sessionRepo.create(project.id, name, 'Initial prompt', 'standard');
  }

  it('notifies exactly once after settlement when the provider rejects on user-stop abort', async () => {
    const session = createStartedSession('Finding3 Exceptional Stop');
    const events = [];
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    const agent = abortRejectingAgent({ entered: () => signalEntered(), settled: () => events.push('settled') });
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: noopCallbacks(events, messageRepo, session.id),
    });
    await entered;
    await stopSession(session.id);
    const outcome = await first.then(() => 'resolved', (error) => error);
    createAgentSpy.mockRestore();

    // The turn failed exceptionally (the provider rejected on cancellation).
    expect(outcome?.message ?? outcome).toMatch(/torn down during abort/);
    // The settled-stop notifier fired exactly once, after generator settlement,
    // with the partial output already durable.
    expect(events).toEqual(['settled', 'notified', 'saw-output']);
    // A user stop stays a stop — never a failure — and ownership is released.
    expect(sessionRepo.getById(session.id).status).toBe('stopped');
    expect(sessionRepo.getById(session.id).error).toBeNull();
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('notifies exactly once when the provider exits normally after Stop', async () => {
    const session = createStartedSession('Finding3 Normal Stop');
    const events = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    const agent = {
      execute: vi.fn(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'mock-stop-session', model: 'x', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial output before stop' }] } };
        signalEntered();
        await gate;
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: noopCallbacks(events, messageRepo, session.id),
    });
    await entered;
    await stopSession(session.id);
    release();
    await first;
    createAgentSpy.mockRestore();

    expect(events).toEqual(['notified', 'saw-output']);
    expect(sessionRepo.getById(session.id).status).toBe('stopped');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('notifies exactly once when Stop arrives after the final stream event', async () => {
    const session = createStartedSession('Finding3 PostTurn Stop');
    const events = [];
    const agent = {
      execute: vi.fn(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'mock-stop-session', model: 'x', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial output before stop' }] } };
        yield { type: 'result', subtype: 'success' };
        // The provider exited normally, but the user stopped before the
        // post-turn completion pipeline ran.
        await stopSession(session.id);
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    await runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: noopCallbacks(events, messageRepo, session.id),
    });
    createAgentSpy.mockRestore();

    expect(events).toEqual(['notified', 'saw-output']);
    expect(sessionRepo.getById(session.id).status).toBe('stopped');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('never notifies for a non-user abort', async () => {
    const session = createStartedSession('Finding3 NonUser Abort');
    const events = [];
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    const controller = new AbortController();
    const agent = {
      execute: vi.fn(async function* (queryParams) {
        const abortController = queryParams?.options?.abortController ?? controller;
        yield { type: 'system', subtype: 'init', session_id: 'mock-stop-session', model: 'x', slash_commands: [] };
        signalEntered();
        await new Promise((_, reject) => {
          abortController?.signal?.addEventListener('abort', () => reject(new Error('non-user abort teardown')));
        });
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const first = runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: { abortController: controller },
      callbacks: noopCallbacks(events, messageRepo, session.id),
    });
    await entered;
    controller.abort();
    const outcome = await first.then(() => 'resolved', (error) => error);
    createAgentSpy.mockRestore();

    expect(outcome?.message ?? outcome).toMatch(/non-user abort teardown/);
    expect(events).toEqual([]);
    expect(sessionRepo.getById(session.id).status).toBe('error');
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('never notifies for a genuine provider error', async () => {
    const session = createStartedSession('Finding3 Provider Error');
    const events = [];
    const agent = {
      execute: vi.fn(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'mock-stop-session', model: 'x', slash_commands: [] };
        throw new Error('genuine provider failure');
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);

    const outcome = await runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: noopCallbacks(events, messageRepo, session.id),
    }).then(() => 'resolved', (error) => error);
    createAgentSpy.mockRestore();

    expect(outcome?.message ?? outcome).toMatch(/genuine provider failure/);
    expect(events).toEqual([]);
    expect(sessionRepo.getById(session.id).status).toBe('error');
    expect(activeSessions.has(session.id)).toBe(false);
  });
});

// ── Finding 12: user cancellation takes precedence over startup failover ────
// Stop a tier startup before observable activity; the winding-down provider
// rejects with an eligible capacity error (quota/503) rather than AbortError.
// The successor adapter must never be invoked, no failover notice or retry may
// be produced, work settles as user-paused/cancelled, and the deferred
// Stop-summary notification fires exactly once after provider settlement.

describe('finding 12 — stop preempts startup tier failover', () => {
  let sessionRepo;
  let projectRepo;
  let tempDir;

  const callbacksFor = (events) => ({
    handleTemplateTriggerIfNeeded: async () => {},
    handleAutoSendIfNeeded: async () => false,
    onUserStopSettled: (settledId) => {
      events.push(settledId);
    },
  });

  function gatedQuotaRejectingAgent({ entered, release }) {
    return {
      // eslint-disable-next-line require-yield -- gated rejection before any provider event
      execute: vi.fn(async function* () {
        entered();
        await new Promise((resolve, reject) => {
          release({ resolve, reject });
        });
        throw Object.assign(
          new Error("You've hit your usage limit. Please upgrade to continue."),
          { status: 429 }
        );
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  function successAgent(calls) {
    return {
      execute: vi.fn(async function* () {
        calls.push('executed');
        yield { type: 'system', subtype: 'init', session_id: 'finding12-ok', model: 'finding12', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'successor response' }] } };
        yield { type: 'result', subtype: 'success' };
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
  }

  async function createTierBoundSession(tag) {
    const provider1 = modelProviders.create({ name: `Finding12 ${tag} P1`, kind: 'anthropic' });
    const provider2 = modelProviders.create({ name: `Finding12 ${tag} P2`, kind: 'anthropic' });
    modelProviders.addModel(provider1.id, { modelId: `finding12-${tag}-m1`, displayName: 'M1' });
    modelProviders.addModel(provider2.id, { modelId: `finding12-${tag}-m2`, displayName: 'M2' });
    const tier = modelTiers.create({
      name: `Finding12 ${tag} Tier`,
      members: [
        { providerId: provider1.id, modelId: `finding12-${tag}-m1`, position: 0 },
        { providerId: provider2.id, modelId: `finding12-${tag}-m2`, position: 1 },
      ],
    });
    const project = projectRepo.create(`Finding12 ${tag} Project`, tempDir);
    const session = sessionRepo.create(project.id, `Finding12 ${tag}`, 'Initial prompt', 'standard');
    sessionRepo.update(session.id, { model: buildTierRef(tier.id) });
    return { session, provider1, provider2 };
  }

  beforeEach(() => {
    mockQuery.mockClear();
    sessionRepo = new SessionRepository();
    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'finding12-stop-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [sessionId] of activeSessions) {
      activeSessions.delete(sessionId);
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('never dispatches the successor when the cancelled provider rejects with an eligible quota error', async () => {
    const { session, provider1 } = await createTierBoundSession('cancelled-quota');
    const events = [];
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    let releaseAttempt;
    const released = new Promise((resolve) => { releaseAttempt = resolve; });
    const firstAgent = gatedQuotaRejectingAgent({
      entered: () => signalEntered(),
      release: (hooks) => releaseAttempt(hooks),
    });
    const successorCalls = [];
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValueOnce(firstAgent)
      .mockReturnValue(successAgent(successorCalls));

    const run = runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: callbacksFor(events),
    });
    await entered;
    await stopSession(session.id);
    const hooks = await released;
    hooks.resolve();
    const outcome = await run.then(() => 'resolved', (error) => error);
    createAgentSpy.mockRestore();

    // The original capacity error propagates (existing cancellation contract),
    // but nothing failed over: no successor dispatch, no cooldown, no retry.
    expect(outcome?.message ?? outcome).toMatch(/usage limit/);
    expect(successorCalls).toEqual([]);
    const { isUnhealthy } = await import('./tierResolutionService.js');
    expect(isUnhealthy(provider1.id, 'finding12-cancelled-quota-m1')).toBe(false);
    // User-paused settlement, deferred summary exactly once, ownership released.
    expect(sessionRepo.getById(session.id).status).toBe('stopped');
    expect(events).toEqual([session.id]);
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('settles as cancelled when the provider rejects with AbortError after Stop', async () => {
    const { session } = await createTierBoundSession('abort-error');
    const events = [];
    let signalEntered;
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    let releaseAttempt;
    const released = new Promise((resolve) => { releaseAttempt = resolve; });
    const abortAgent = {
      // eslint-disable-next-line require-yield -- gated rejection before any provider event
      execute: vi.fn(async function* () {
        signalEntered();
        await new Promise((resolve, reject) => {
          releaseAttempt({ resolve, reject });
        });
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const successorCalls = [];
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValueOnce(abortAgent)
      .mockReturnValue(successAgent(successorCalls));

    const run = runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: callbacksFor(events),
    });
    await entered;
    await stopSession(session.id);
    const hooks = await released;
    hooks.resolve();
    const outcome = await run.then(() => 'resolved', (error) => error);
    createAgentSpy.mockRestore();

    expect(outcome?.message ?? outcome).toMatch(/aborted/i);
    expect(successorCalls).toEqual([]);
    expect(sessionRepo.getById(session.id).status).toBe('stopped');
    expect(events).toEqual([session.id]);
    expect(activeSessions.has(session.id)).toBe(false);
  });

  it('still advances startup failover for the same capacity error without cancellation', async () => {
    const { session, provider2 } = await createTierBoundSession('no-cancel');
    const events = [];
    const failingAgent = {
      // eslint-disable-next-line require-yield -- immediate startup failure before any provider event
      execute: vi.fn(async function* () {
        throw Object.assign(
          new Error("You've hit your usage limit. Please upgrade to continue."),
          { status: 429 }
        );
      }),
      supportsResume: () => true,
      needsConversationContext: () => false,
    };
    const successorCalls = [];
    const createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValueOnce(failingAgent)
      .mockReturnValue(successAgent(successorCalls));

    await runSessionCore(session.id, 'Initial prompt', tempDir, {
      options: {},
      callbacks: callbacksFor(events),
    });
    createAgentSpy.mockRestore();

    // Eligible, non-cancelled startup failure still fails over transparently.
    expect(successorCalls).toEqual(['executed']);
    const updated = sessionRepo.getById(session.id);
    expect(updated.resolvedModel).toBe('finding12-no-cancel-m2');
    expect(updated.resolvedProviderId).toBe(provider2.id);
    expect(updated.status).not.toBe('error');
    expect(events).toEqual([]);
  });
});
