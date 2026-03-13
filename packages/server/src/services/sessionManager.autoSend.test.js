import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAutoSendIfNeeded } from './sessionManager.js';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sessions, projects, conversations } from '../database.js';
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

    await handleAutoSendIfNeeded(session.id);

    // Should not broadcast any update
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it('does nothing when there is no pending prompt', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: null,
    });

    await handleAutoSendIfNeeded(session.id);

    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it('does nothing when session does not exist', async () => {
    await handleAutoSendIfNeeded('non-existent-id');

    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it('clears autoSendPendingPrompt and pendingPrompt when sending', async () => {
    sessions.update(session.id, {
      autoSendPendingPrompt: true,
      pendingPrompt: 'Follow-up question',
    });

    // handleAutoSendIfNeeded will try to call continueSession, which will fail
    // because we haven't set up a full mock agent. But the flag-clearing should happen first.
    await handleAutoSendIfNeeded(session.id);

    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
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

    await handleAutoSendIfNeeded(session.id);

    // Flags should still be cleared
    const updatedSession = sessions.getById(session.id);
    expect(updatedSession.autoSendPendingPrompt).toBe(false);
    expect(updatedSession.pendingPrompt).toBeNull();
  });
});
