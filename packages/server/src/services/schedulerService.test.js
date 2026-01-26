import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from './schedulerService.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Mock the database and websocket modules
vi.mock('../database.js', () => ({
  sessions: {
    getScheduledSessionsDue: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
    create: vi.fn(),
  },
  conversations: {
    getActiveBySessionId: vi.fn(),
  },
  projects: {
    getById: vi.fn(),
  },
  attachments: {
    getBySessionId: vi.fn(),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

import { sessions, messages, conversations, projects, attachments } from '../database.js';
import { broadcastToSession } from '../websocket.js';

describe('SchedulerService', () => {
  let scheduler;
  let mockSessionManager;

  beforeEach(() => {
    scheduler = new SchedulerService();
    mockSessionManager = {
      runSession: vi.fn().mockResolvedValue(undefined),
    };
    vi.clearAllMocks();

    // Set default mock return values
    sessions.getScheduledSessionsDue.mockReturnValue([]);

    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('initializes with dependencies', () => {
      scheduler.initialize(mockSessionManager);
      expect(scheduler.sessionManager).toBe(mockSessionManager);
    });

    it('has default poll interval of 30 seconds', () => {
      expect(scheduler.pollInterval).toBe(30000);
    });
  });

  describe('start and stop', () => {
    it('starts the scheduler and runs immediately', () => {
      scheduler.initialize(mockSessionManager);
      const checkSpy = vi.spyOn(scheduler, 'checkScheduledSessions');

      scheduler.start();

      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.intervalId).not.toBeNull();
      checkSpy.mockRestore();
    });

    it('prevents starting twice', () => {
      scheduler.initialize(mockSessionManager);
      scheduler.start();
      const firstIntervalId = scheduler.intervalId;

      const checkSpy = vi.spyOn(scheduler, 'checkScheduledSessions');
      scheduler.start();

      // Should not create a new interval
      expect(scheduler.intervalId).toBe(firstIntervalId);
      expect(checkSpy).toHaveBeenCalledTimes(0); // No additional call

      checkSpy.mockRestore();
    });

    it('stops the scheduler', () => {
      scheduler.initialize(mockSessionManager);
      scheduler.start();

      expect(scheduler.intervalId).not.toBeNull();
      scheduler.stop();

      expect(scheduler.intervalId).toBeNull();
    });

    it('safely handles stopping when not started', () => {
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.intervalId).toBeNull();
    });
  });

  describe('checkScheduledSessions', () => {
    it('finds and starts due sessions', async () => {
      scheduler.initialize(mockSessionManager);
      const dueSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'scheduled',
      };

      sessions.getScheduledSessionsDue.mockReturnValue([dueSession]);

      const startSpy = vi.spyOn(scheduler, 'startScheduledSession');
      await scheduler.checkScheduledSessions();

      expect(sessions.getScheduledSessionsDue).toHaveBeenCalledWith(expect.any(Number));
      expect(startSpy).toHaveBeenCalledWith(dueSession);
      startSpy.mockRestore();
    });

    it('handles multiple due sessions', async () => {
      scheduler.initialize(mockSessionManager);
      const dueSessions = [
        { id: 'session-1', name: 'Session 1' },
        { id: 'session-2', name: 'Session 2' },
        { id: 'session-3', name: 'Session 3' },
      ];

      sessions.getScheduledSessionsDue.mockReturnValue(dueSessions);

      const startSpy = vi.spyOn(scheduler, 'startScheduledSession');
      await scheduler.checkScheduledSessions();

      expect(startSpy).toHaveBeenCalledTimes(3);
      startSpy.mockRestore();
    });

    it('handles errors when starting sessions', async () => {
      scheduler.initialize(mockSessionManager);
      const dueSession = {
        id: 'session-1',
        name: 'Test Session',
      };

      sessions.getScheduledSessionsDue.mockReturnValue([dueSession]);

      const error = new Error('Failed to start session');
      vi.spyOn(scheduler, 'startScheduledSession').mockRejectedValueOnce(error);

      await scheduler.checkScheduledSessions();

      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'error',
        error: expect.stringContaining('Failed to start scheduled session'),
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'error',
      });
    });

    it('ignores sessions when no sessions are due', async () => {
      scheduler.initialize(mockSessionManager);
      sessions.getScheduledSessionsDue.mockReturnValue([]);

      const startSpy = vi.spyOn(scheduler, 'startScheduledSession');
      await scheduler.checkScheduledSessions();

      expect(startSpy).not.toHaveBeenCalled();
      startSpy.mockRestore();
    });
  });

  describe('startScheduledSession', () => {
    it('throws error if not initialized', async () => {
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1' };

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'SchedulerService not initialized with sessionManager'
      );
    });

    it('throws error if project not found', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1' };

      projects.getById.mockReturnValue(null);

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'Project not found for session session-1'
      );
    });

    it('throws error if no pendingPrompt found', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: null };

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([]);

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'No pendingPrompt found for session session-1'
      );
    });

    it('updates session status and runs fresh session', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello', pendingModel: 'claude-sonnet-4-5' };

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp', systemPrompt: 'Be helpful' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'starting',
        scheduledAt: null,
        pendingPrompt: null,
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'starting',
      });
      expect(mockSessionManager.runSession).toHaveBeenCalledWith('session-1', 'Hello', '/tmp', 'Be helpful', [], 'claude-sonnet-4-5');
    });

    it('uses gitWorktree for working directory when available', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', gitWorktree: '/tmp/worktree', pendingPrompt: 'Hello', pendingModel: null };

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp/main' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(mockSessionManager.runSession).toHaveBeenCalledWith('session-1', 'Hello', '/tmp/worktree', undefined, [], null);
    });

    it('continues session when there are existing assistant messages', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.continueSession = vi.fn().mockResolvedValue(undefined);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Follow-up message', pendingModel: 'claude-opus-4-5' };

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
      ]);
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(mockSessionManager.continueSession).toHaveBeenCalledWith('session-1', 'Follow-up message', '/tmp', undefined, [], 'claude-opus-4-5');
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });
  });

  describe('rescheduleSession', () => {
    it('reschedules session with delay', async () => {
      scheduler.initialize(mockSessionManager);
      const now = Date.now();
      vi.setSystemTime(now);

      const session = {
        id: 'session-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 0,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'First message' },
      ]);

      const result = await scheduler.rescheduleSession('session-1', 'Token limit reached');

      expect(result).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'scheduled',
        scheduledAt: now + 15 * 60 * 1000,
        rescheduleCount: 1,
        pendingPrompt: 'First message',
        error: expect.stringContaining('Rescheduled (1x)'),
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'scheduled',
      });
    });

    it('respects max reschedule count', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 2,
        maxRescheduleCount: 2,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);

      const result = await scheduler.rescheduleSession('session-1', 'Token limit reached');

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'error',
        error: expect.stringContaining('Reschedule limits reached'),
      });
    });

    it('returns false if session not found', async () => {
      scheduler.initialize(mockSessionManager);
      sessions.getById.mockReturnValue(null);

      const result = await scheduler.rescheduleSession('nonexistent', 'Some reason');

      expect(result).toBe(false);
    });

    it('increments reschedule count on each reschedule', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 5,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'Test message' },
      ]);

      await scheduler.rescheduleSession('session-1', 'Reason');

      const updateCall = sessions.update.mock.calls[0][1];
      expect(updateCall.rescheduleCount).toBe(6);
    });
  });

  describe('hasReachedLimits', () => {
    it('returns false when no limits are set', () => {
      const session = {
        maxRescheduleCount: null,
        maxTotalTokens: null,
        rescheduleCount: 5,
        inputTokens: 50000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(false);
    });

    it('returns true when max reschedule count is reached', () => {
      const session = {
        maxRescheduleCount: 3,
        rescheduleCount: 3,
        maxTotalTokens: null,
        inputTokens: 50000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(true);
    });

    it('returns false when below max reschedule count', () => {
      const session = {
        maxRescheduleCount: 5,
        rescheduleCount: 2,
        maxTotalTokens: null,
        inputTokens: 50000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(false);
    });

    it('returns true when max total tokens is reached', () => {
      const session = {
        maxRescheduleCount: null,
        maxTotalTokens: 150000,
        rescheduleCount: 1,
        inputTokens: 100000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(true);
    });

    it('returns false when below max total tokens', () => {
      const session = {
        maxRescheduleCount: null,
        maxTotalTokens: 200000,
        rescheduleCount: 1,
        inputTokens: 100000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(false);
    });

    it('respects both limits when set', () => {
      const session = {
        maxRescheduleCount: 2,
        maxTotalTokens: 200000,
        rescheduleCount: 3, // Exceeds max count
        inputTokens: 100000,
        outputTokens: 50000,
      };

      const result = scheduler.hasReachedLimits(session);

      expect(result).toBe(true);
    });
  });

  describe('shouldProactivelyReschedule', () => {
    it('returns false when no threshold is set', () => {
      const session = {
        rescheduleAtTokenCount: null,
        inputTokens: 150000,
        outputTokens: 50000,
      };

      const result = scheduler.shouldProactivelyReschedule(session);

      expect(result).toBe(false);
    });

    it('returns false when below threshold', () => {
      const session = {
        rescheduleAtTokenCount: 200000,
        inputTokens: 100000,
        outputTokens: 50000,
      };

      const result = scheduler.shouldProactivelyReschedule(session);

      expect(result).toBe(false);
    });

    it('returns true when at or above threshold', () => {
      const session = {
        rescheduleAtTokenCount: 150000,
        inputTokens: 100000,
        outputTokens: 50000,
      };

      const result = scheduler.shouldProactivelyReschedule(session);

      expect(result).toBe(true);
    });

    it('returns true when well above threshold', () => {
      const session = {
        rescheduleAtTokenCount: 100000,
        inputTokens: 150000,
        outputTokens: 100000,
      };

      const result = scheduler.shouldProactivelyReschedule(session);

      expect(result).toBe(true);
    });
  });

  describe('polling intervals', () => {
    it('polls at specified intervals', async () => {
      scheduler.initialize(mockSessionManager);
      const checkSpy = vi.spyOn(scheduler, 'checkScheduledSessions');

      scheduler.start();
      expect(checkSpy).toHaveBeenCalledTimes(1);

      // Advance time by one poll interval
      vi.advanceTimersByTime(30000);
      expect(checkSpy).toHaveBeenCalledTimes(2);

      // Advance time by another interval
      vi.advanceTimersByTime(30000);
      expect(checkSpy).toHaveBeenCalledTimes(3);

      checkSpy.mockRestore();
    });
  });
});
