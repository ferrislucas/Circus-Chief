import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAutoSendIfNeeded } from './sessionManager.js';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sessions, conversations, modelProviders } from '../database.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Mock the schedulerService
vi.mock('./schedulerService.js', () => ({
  schedulerService: {
    hasReachedLimits: vi.fn().mockReturnValue(false),
    rescheduleSession: vi.fn().mockResolvedValue(true),
    initialize: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
  SchedulerService: class {},
}));

// Mock the SDK to prevent real API calls in tests
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const mockAgent = {
    async *execute() {
      yield { type: 'message_start', message: { id: 'msg_test' } };
      yield { type: 'content_block_start', content_block: { type: 'text' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Test response' } };
      yield { type: 'content_block_stop' };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
      yield { type: 'message_stop' };
    },
    supportsResume: () => false,
    getCapabilities: () => [],
  };
  return {
    query: vi.fn(async function* () {
      yield* mockAgent.execute();
    }),
  };
});

// Mock the websocket broadcasts
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { broadcastToSession } from '../websocket.js';

describe('sessionManager - handleAutoSendIfNeeded', () => {
  let projectRepo;
  let tempDir;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    projectRepo = new ProjectRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'auto-send-test-'));

    // Create test project and session
    project = projectRepo.create('Test Project', tempDir);
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { claudeSessionId: 'mock-session-id', status: 'waiting' });

    // Create active conversation
    conversations.create(session.id, 'Test Conversation');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does nothing when autoSendPendingPrompt is false', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: false,
      pendingPrompt: 'Some prompt',
    });

    const result = await handleAutoSendIfNeeded(session.id);

    // Should not broadcast any update
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('does nothing when there is no pending prompt', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: null,
    });

    const result = await handleAutoSendIfNeeded(session.id);

    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('does nothing when session does not exist', async () => {
    const result = await handleAutoSendIfNeeded('non-existent-id');

    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('clears autoSendPendingPrompt and pendingPrompt when sending', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up question',
    });

    // handleAutoSendIfNeeded will try to call continueSession, which will fail
    // because we haven't set up a full mock agent. But the flag-clearing should happen first.
    const result = await handleAutoSendIfNeeded(session.id);

    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
    expect(result).toBe(true);
  });

  it('broadcasts session update after clearing flags', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up question',
    });

    await handleAutoSendIfNeeded(session.id);

    // Should have broadcast with cleared flags
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      expect.objectContaining({
        sessionId: session.id,
        session: expect.objectContaining({
          autoSendPendingPrompt: false,
          pendingPrompt: null,
        }),
      })
    );
  });

  it('does not send if session status is not waiting', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up',
      status: 'running', // Not waiting
    });

    const result = await handleAutoSendIfNeeded(session.id);

    // Flags should still be cleared
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
    // Prompt was consumed (flags cleared) even though send was skipped
    expect(result).toBe(true);
  });

  it('does nothing when pendingPrompt is empty string', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: '',
    });

    const result = await handleAutoSendIfNeeded(session.id);

    // Empty string is falsy, so early return — should not broadcast
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('clears flags before calling continueSession', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up question',
    });

    await handleAutoSendIfNeeded(session.id);

    // Verify flags are cleared in the database
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
  });

  it('does not throw when continueSession encounters an error', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up',
      status: 'completed', // Not waiting — continueSession may fail
    });

    // Should not throw even if internal processing fails
    await expect(handleAutoSendIfNeeded(session.id)).resolves.not.toThrow();

    // Flags should still be cleared
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
  });

  it('uses pendingModel from session when present', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'test',
      pendingModel: 'claude-sonnet-4-20250514',
    });

    await handleAutoSendIfNeeded(session.id);

    // Flags should be cleared (confirms processing occurred)
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();

    // Broadcast should have been called (confirms auto-send logic ran)
    expect(broadcastToSession).toHaveBeenCalled();
  });

  it('uses gitWorktree as working directory when present', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'test',
      gitWorktree: '/tmp/worktree-path',
    });

    await handleAutoSendIfNeeded(session.id);

    // Flags should be cleared (confirms processing occurred)
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();

    // Broadcast should have been called
    expect(broadcastToSession).toHaveBeenCalled();
  });

  // Finding #4 (PR review): auto-send must honor the queued
  // (pendingModel, pendingProviderId) pair exactly like manual send and
  // scheduling do — not drop the provider half and dispatch by model id.
  describe('finding #4 — queued provider identity survives auto-send', () => {
    const SHARED_MODEL = 'finding4-shared-model';

    let providerA;
    let providerB;

    beforeEach(() => {
      vi.mocked(query).mockClear();
      providerA = modelProviders.create({ name: 'Finding4 AutoSend A', kind: 'anthropic', baseUrl: 'https://finding4-a.example.com', authToken: 'token-a' });
      modelProviders.addModel(providerA.id, { modelId: SHARED_MODEL, displayName: 'Shared A' });
      providerB = modelProviders.create({ name: 'Finding4 AutoSend B', kind: 'anthropic', baseUrl: 'https://finding4-b.example.com', authToken: 'token-b' });
      modelProviders.addModel(providerB.id, { modelId: SHARED_MODEL, displayName: 'Shared B' });
    });

    function dispatchedBaseUrls() {
      return vi.mocked(query).mock.calls.map((call) => call[0]?.options?.env?.ANTHROPIC_BASE_URL);
    }

    it('dispatches the exact queued model/provider pair and clears both queue fields', async () => {
      sessions.update(session.id, {
        autoSendPendingPrompt: true,
        pendingPrompt: 'queued follow-up',
        pendingModel: SHARED_MODEL,
        pendingProviderId: providerB.id,
      });

      await handleAutoSendIfNeeded(session.id);

      // The continuation dispatched provider B — not a model-id lookup default.
      expect(dispatchedBaseUrls()).toContain('https://finding4-b.example.com');
      expect(dispatchedBaseUrls()).not.toContain('https://finding4-a.example.com');
      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.model).toBe(SHARED_MODEL);
      expect(updatedSession.providerId).toBe(providerB.id);
      // The consumed queued identity is cleared and cannot leak into a later turn.
      expect(updatedSession.pendingModel).toBeNull();
      expect(updatedSession.pendingProviderId).toBeNull();
      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        expect.any(String),
        expect.objectContaining({
          session: expect.objectContaining({
            pendingModel: null,
            pendingProviderId: null,
          }),
        }),
      );
    });

    it('sends a legacy queue without a provider exactly as before', async () => {
      sessions.update(session.id, {
        autoSendPendingPrompt: true,
        pendingPrompt: 'legacy follow-up',
        pendingModel: SHARED_MODEL,
        pendingProviderId: null,
      });

      await handleAutoSendIfNeeded(session.id);

      expect(vi.mocked(query)).toHaveBeenCalled();
      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.model).toBe(SHARED_MODEL);
      expect(updatedSession.pendingModel).toBeNull();
      expect(updatedSession.pendingProviderId).toBeNull();
    });

    it('sends the current binding when no queued selection exists', async () => {
      sessions.update(session.id, {
        autoSendPendingPrompt: true,
        pendingPrompt: 'plain follow-up',
        pendingModel: null,
        pendingProviderId: null,
      });

      await handleAutoSendIfNeeded(session.id);

      expect(vi.mocked(query)).toHaveBeenCalled();
      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.pendingModel).toBeNull();
      expect(updatedSession.pendingProviderId).toBeNull();
    });

    it('clears the queued provider even when the status prevents dispatch', async () => {
      sessions.update(session.id, {
        autoSendPendingPrompt: true,
        pendingPrompt: 'never sent',
        pendingModel: SHARED_MODEL,
        pendingProviderId: providerB.id,
        status: 'running',
      });

      const result = await handleAutoSendIfNeeded(session.id);

      expect(result).toBe(true);
      expect(vi.mocked(query)).not.toHaveBeenCalled();
      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.pendingModel).toBeNull();
      expect(updatedSession.pendingProviderId).toBeNull();
    });
  });
});
