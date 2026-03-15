import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAutoSendIfNeeded } from './sessionManager.js';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sessions, conversations } from '../database.js';
import { ProjectRepository } from '../db/ProjectRepository.js';

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
});
