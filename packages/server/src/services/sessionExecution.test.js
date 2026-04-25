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

import { buildQueryParams } from './sessionExecution.js';
import { continueSession, runSession, continueSessionWithExistingMessage } from './sessionManager.js';
import * as sessionProvider from './sessionProvider.js';

import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { ConversationRepository } from '../db/ConversationRepository.js';
import { sessions } from '../database.js';

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
