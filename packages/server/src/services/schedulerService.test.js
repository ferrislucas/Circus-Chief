import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from './schedulerService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// Mock the database and websocket modules
vi.mock('../database.js', () => ({
  sessions: {
    getScheduledSessionsDue: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    claimScheduled: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
    getByConversationId: vi.fn(),
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
    updateMessageIdForSession: vi.fn(),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { sessions, messages, conversations, projects, attachments } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';

describe('SchedulerService', () => {
  let scheduler;
  let mockSessionManager;

  beforeEach(() => {
    scheduler = new SchedulerService();
    mockSessionManager = {
      isSessionActive: vi.fn().mockReturnValue(false),
      runSession: vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' }),
      continueSession: vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' }),
      continueSessionWithExistingMessage: vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' }),
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

  describe('scheduled executor start contract', () => {
    it.each([
      [undefined],
      [null],
      [true],
      [false],
      [{}],
      [{ started: false }],
      [{ started: 'true' }],
    ])('fails closed for an ambiguous executor result: %j', (result) => {
      expect(SchedulerService.didExecutorStart(result, 'session-1')).toBe(false);
    });

    it('accepts only an explicit started result', () => {
      expect(SchedulerService.didExecutorStart({ started: true, sessionId: 'session-1' }, 'session-1')).toBe(true);
    });

    it('fails closed when the executor reports a different session as started', () => {
      expect(SchedulerService.didExecutorStart({ started: true, sessionId: 'another-session' }, 'session-1')).toBe(false);
    });

    it('preserves an explicit executor rejection reason', () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', projectId: 'project-1' };

      expect(scheduler.finishScheduledStart(session, {
        started: false, sessionId: session.id, reason: 'executor_declined',
      })).toEqual({ started: false, sessionId: session.id, reason: 'executor_declined' });
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

  describe('isRunning', () => {
    it('is false before start()', () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it('is true after start()', () => {
      scheduler.initialize(mockSessionManager);
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('is false after stop()', () => {
      scheduler.initialize(mockSessionManager);
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('startIfEnabled', () => {
    it('returns false and does not start when VCR_MODE is set', () => {
      const startSpy = vi.spyOn(scheduler, 'start');
      const result = scheduler.startIfEnabled(mockSessionManager, { VCR_MODE: 'replay' });

      expect(result).toBe(false);
      expect(startSpy).not.toHaveBeenCalled();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('returns true and starts when VCR_MODE is unset', () => {
      const result = scheduler.startIfEnabled(mockSessionManager, {});
      expect(result).toBe(true);
      expect(scheduler.sessionManager).toBe(mockSessionManager);
      expect(scheduler.isRunning()).toBe(true);
    });

    it('treats empty VCR_MODE string the same as unset (matches /server-info contract)', () => {
      const result = scheduler.startIfEnabled(mockSessionManager, { VCR_MODE: '' });
      expect(result).toBe(true);
      expect(scheduler.isRunning()).toBe(true);
    });

    it('defaults to process.env when no env arg is passed', () => {
      const originalVcr = process.env.VCR_MODE;
      process.env.VCR_MODE = 'replay';
      try {
        const result = scheduler.startIfEnabled(mockSessionManager);
        expect(result).toBe(false);
        expect(scheduler.isRunning()).toBe(false);
      } finally {
        if (originalVcr === undefined) {
          delete process.env.VCR_MODE;
        } else {
          process.env.VCR_MODE = originalVcr;
        }
      }
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

    it('swallows a per-session failure and continues the sweep (recovery is startScheduledSession\'s job)', async () => {
      scheduler.initialize(mockSessionManager);
      const dueSessions = [
        { id: 'session-1', name: 'Session 1' },
        { id: 'session-2', name: 'Session 2' },
      ];

      sessions.getScheduledSessionsDue.mockReturnValue(dueSessions);

      const error = new Error('Failed to start session');
      const startSpy = vi.spyOn(scheduler, 'startScheduledSession');
      startSpy.mockRejectedValueOnce(error);
      startSpy.mockResolvedValueOnce({ claimed: true });

      await expect(scheduler.checkScheduledSessions()).resolves.toBeUndefined();

      // checkScheduledSessions no longer writes to the session record itself —
      // startScheduledSession is solely responsible for recording pre-launch
      // failures (see the dedicated recovery tests below). This loop only
      // needs to keep going after one session's failure.
      expect(startSpy).toHaveBeenCalledTimes(2);
      startSpy.mockRestore();
    });

    it('does not treat a lost claim (already started elsewhere) as an error', async () => {
      scheduler.initialize(mockSessionManager);
      const dueSession = { id: 'session-1', name: 'Test Session' };
      sessions.getScheduledSessionsDue.mockReturnValue([dueSession]);

      const startSpy = vi.spyOn(scheduler, 'startScheduledSession').mockResolvedValueOnce({ claimed: false });

      await expect(scheduler.checkScheduledSessions()).resolves.toBeUndefined();

      expect(sessions.update).not.toHaveBeenCalled();
      startSpy.mockRestore();
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
    it('does not claim a due schedule while its previous turn is still active', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.isSessionActive.mockReturnValue(true);
      const session = { id: 'session-1', projectId: 'project-1' };

      const result = await scheduler.startScheduledSession(session);

      expect(result).toEqual({
        claimed: false,
        started: false,
        reason: 'session_still_active',
        sessionId: 'session-1',
      });
      expect(sessions.claimScheduled).not.toHaveBeenCalled();
    });

    // Helper: make sessions.claimScheduled behave like the real repository
    // method for a single-caller (non-racing) test — succeeds once, returns
    // the pre-claim snapshot (optionally with the prompt override applied).
    function stubSuccessfulClaim(session) {
      sessions.claimScheduled.mockImplementation((id, { promptOverride } = {}) => {
        if (id !== session.id) return null;
        const hasOverride = typeof promptOverride === 'string' && promptOverride.trim() !== '';
        return hasOverride ? { ...session, pendingPrompt: promptOverride } : session;
      });
    }

    it('throws error if not initialized', async () => {
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1' };

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'SchedulerService not initialized with sessionManager'
      );
    });

    describe('launch budget gate', () => {
      it('refuses to claim a session that has exhausted its token budget', async () => {
        scheduler.initialize(mockSessionManager);
        const session = {
          id: 'session-1',
          name: 'Test Session',
          projectId: 'project-1',
          maxTotalTokens: 1000,
          inputTokens: 600,
          outputTokens: 500,
        };
        sessions.getById.mockReturnValue(session);

        const result = await scheduler.startScheduledSession(session);

        expect(result).toEqual({
          claimed: false,
          started: false,
          reason: 'launch_budget_exhausted',
          sessionId: 'session-1',
        });
        expect(sessions.claimScheduled).not.toHaveBeenCalled();
        expect(sessions.update).toHaveBeenCalledWith('session-1', {
          status: 'stopped',
          scheduledAt: null,
          pendingPrompt: null,
          pendingConversationId: null,
          pendingModel: null,
          error: 'Scheduled launch refused: max total tokens reached (1,000).',
        });
        expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
          sessionId: 'session-1',
          status: 'stopped',
        });
      });

      it('still launches an under-budget session', async () => {
        scheduler.initialize(mockSessionManager);
        const session = {
          id: 'session-1',
          name: 'Test Session',
          projectId: 'project-1',
          maxTotalTokens: 1000,
          inputTokens: 600,
          outputTokens: 300,
          pendingPrompt: 'Hello',
          pendingModel: null,
        };
        sessions.getById.mockReturnValue(session);
        sessions.claimScheduled.mockReturnValue(session);
        projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
        messages.getBySessionId.mockReturnValue([]);
        conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
        messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
        attachments.getBySessionId.mockReturnValue([]);

        const result = await scheduler.startScheduledSession(session);

        expect(result).toEqual({ claimed: true });
        expect(sessions.claimScheduled).toHaveBeenCalled();
        expect(mockSessionManager.runSession).toHaveBeenCalled();
      });
    });

    it('claims the session before doing any other work', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello' };
      sessions.claimScheduled.mockReturnValue(null);

      const result = await scheduler.startScheduledSession(session);

      expect(sessions.claimScheduled).toHaveBeenCalledWith('session-1', { promptOverride: undefined });
      expect(result).toEqual({ claimed: false });
      // A lost claim must never reach project lookup, prompt resolution, or launch.
      expect(projects.getById).not.toHaveBeenCalled();
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
      expect(mockSessionManager.continueSession).not.toHaveBeenCalled();
    });

    it('forwards an explicit prompt override to the atomic claim', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'saved prompt', pendingModel: null };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'edited prompt', conversationId: 'conv-1' });
      attachments.getBySessionId.mockReturnValue([]);

      const result = await scheduler.startScheduledSession(session, { promptOverride: 'edited prompt' });

      expect(sessions.claimScheduled).toHaveBeenCalledWith('session-1', { promptOverride: 'edited prompt' });
      // The launched turn uses the override the winning claim carried, not the stale persisted prompt.
      expect(mockSessionManager.runSession).toHaveBeenCalledWith('session-1', 'edited prompt', '/tmp', expect.objectContaining({}));
      expect(result).toEqual({ claimed: true });
    });

    it('records a recoverable error and preserves scheduling fields when project lookup fails', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello' };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue(null);

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'Project not found for session session-1'
      );

      // Recorded as a recoverable error...
      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'error',
        error: expect.stringContaining('Project not found for session session-1'),
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'error',
      });
      // ...and the scheduling fields were never cleared (the claim never
      // touched them, and this failure happened before the durable-clear step).
      expect(sessions.update).not.toHaveBeenCalledWith('session-1', expect.objectContaining({ scheduledAt: null }));
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    it('records a recoverable error when no active conversation exists for a fresh session', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello' };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue(null);

      await expect(scheduler.startScheduledSession(session)).rejects.toThrow(
        'No active conversation found for session session-1'
      );

      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'error',
        error: expect.stringContaining('No active conversation found for session session-1'),
      });
      expect(messages.create).not.toHaveBeenCalled();
    });

    it('updates session status and runs fresh session', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello', pendingModel: 'claude-sonnet-4-5' };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp', systemPrompt: 'Be helpful' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
      attachments.getBySessionId.mockReturnValue([]);

      const result = await scheduler.startScheduledSession(session);

      // The claim itself (mocked here) is responsible for the scheduled ->
      // starting transition; this durable-clear update only needs to null
      // out the scheduling fields once the launch is committed.
      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        scheduledAt: null,
        pendingPrompt: null,
        pendingConversationId: null,
        pendingModel: null,
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'starting',
      });
      expect(mockSessionManager.runSession).toHaveBeenCalledWith('session-1', 'Hello', '/tmp', { systemPrompt: 'Be helpful', fileAttachments: [], model: 'claude-sonnet-4-5' });
      expect(result).toEqual({ claimed: true });
    });

    it('uses gitWorktree for working directory when available', async () => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', gitWorktree: '/tmp/worktree', pendingPrompt: 'Hello', pendingModel: null };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp/main' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(mockSessionManager.runSession).toHaveBeenCalledWith('session-1', 'Hello', '/tmp/worktree', { systemPrompt: undefined, fileAttachments: [], model: null });
    });

    it('continues session when there are existing assistant messages', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.continueSession = vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' });
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Follow-up message', pendingConversationId: null, pendingModel: 'claude-opus-4-5' };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
      ]);
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(mockSessionManager.continueSession).toHaveBeenCalledWith('session-1', 'Follow-up message', '/tmp', { systemPrompt: undefined, fileAttachments: [], model: 'claude-opus-4-5' });
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    it.each([
      ['fresh session', (session) => { messages.getBySessionId.mockReturnValue([]); conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' }); messages.create.mockReturnValue({ id: 'msg-1' }); mockSessionManager.runSession.mockResolvedValue({ started: false, sessionId: session.id, reason: 'lane_run_ownership_lost' }); }],
      ['continuation', (session) => { messages.getBySessionId.mockReturnValue([{ role: 'assistant' }]); mockSessionManager.continueSession.mockResolvedValue({ started: false, sessionId: session.id, reason: 'lane_run_ownership_lost' }); }],
      ['existing-message continuation', (session) => { const scheduledSession = session; scheduledSession.pendingConversationId = 'conv-99'; mockSessionManager.continueSessionWithExistingMessage.mockResolvedValue({ started: false, sessionId: scheduledSession.id, reason: 'lane_run_ownership_lost' }); }],
    ])('returns ownership rejection and clears stale scheduler state for a declined %s', async (_name, configure) => {
      scheduler.initialize(mockSessionManager);
      const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Continue', pendingConversationId: null, pendingModel: null, scheduledAt: 1234 };
      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      attachments.getBySessionId.mockReturnValue([]);
      configure(session);
      stubSuccessfulClaim(session);

      const result = await scheduler.startScheduledSession(session);

      expect(result).toEqual({ started: false, reason: 'lane_run_ownership_lost', sessionId: session.id });
      expect(sessions.update).toHaveBeenLastCalledWith(session.id, expect.objectContaining({
        status: 'stopped', scheduledAt: null, pendingPrompt: null, pendingModel: null,
      }));
    });

    it('links file attachments to user message for fresh scheduled session', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1', name: 'Test Session', projectId: 'project-1',
        pendingPrompt: 'Analyze file', pendingModel: null,
      };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({
        id: 'msg-1', sessionId: 'session-1', role: 'user',
        content: 'Analyze file', conversationId: 'conv-1',
      });
      attachments.getBySessionId.mockReturnValue([
        { id: 'att-1', sessionId: 'session-1', filename: 'test.txt', messageId: null },
      ]);

      await scheduler.startScheduledSession(session);

      expect(attachments.updateMessageIdForSession).toHaveBeenCalledWith('session-1', 'msg-1');
    });

    it('does not call updateMessageIdForSession when there are no attachments', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1', name: 'Test Session', projectId: 'project-1',
        pendingPrompt: 'Hello', pendingModel: null,
      };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      messages.create.mockReturnValue({
        id: 'msg-1', sessionId: 'session-1', role: 'user',
        content: 'Hello', conversationId: 'conv-1',
      });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(attachments.updateMessageIdForSession).not.toHaveBeenCalled();
    });

    it('uses continueSessionWithExistingMessage for a persisted autonomous-loop continuation', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.continueSessionWithExistingMessage = vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' });
      const session = {
        id: 'session-1',
        name: 'Test Session',
        projectId: 'project-1',
        pendingPrompt: 'Continue',
        pendingConversationId: 'conv-99',
        pendingModel: 'claude-sonnet-4-5',
      };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp', systemPrompt: 'Be helpful' });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      // Should call continueSessionWithExistingMessage, not runSession or continueSession
      expect(mockSessionManager.continueSessionWithExistingMessage).toHaveBeenCalledWith(
        'session-1',
        'conv-99',
        '/tmp',
        { systemPrompt: 'Be helpful', model: 'claude-sonnet-4-5' }
      );
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
      expect(mockSessionManager.continueSession).not.toHaveBeenCalled();
    });

    it('clears pendingConversationId and pendingPrompt when using existing-message retry', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.continueSessionWithExistingMessage = vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' });
      const session = {
        id: 'session-1',
        name: 'Test Session',
        projectId: 'project-1',
        pendingPrompt: 'Initial prompt',
        pendingConversationId: 'conv-99',
        pendingModel: null,
      };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        scheduledAt: null,
        pendingPrompt: null,
        pendingConversationId: null,
        pendingModel: null,
      });
    });

    it('pendingConversationId takes precedence over hasAssistantResponses check', async () => {
      scheduler.initialize(mockSessionManager);
      mockSessionManager.continueSessionWithExistingMessage = vi.fn().mockResolvedValue({ started: true, sessionId: 'session-1' });
      const session = {
        id: 'session-1',
        name: 'Test Session',
        projectId: 'project-1',
        pendingPrompt: 'Initial prompt',
        pendingConversationId: 'conv-initial',
        pendingModel: null,
      };
      stubSuccessfulClaim(session);

      projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
      // Even if session-wide messages shows no assistant (fresh session), pendingConversationId wins
      messages.getBySessionId.mockReturnValue([]);
      attachments.getBySessionId.mockReturnValue([]);

      await scheduler.startScheduledSession(session);

      expect(mockSessionManager.continueSessionWithExistingMessage).toHaveBeenCalled();
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    describe('concurrency (manual/manual and manual/poller races)', () => {
      it('only one of two concurrent claims for the same session succeeds', async () => {
        scheduler.initialize(mockSessionManager);
        const session = { id: 'session-1', name: 'Test Session', projectId: 'project-1', pendingPrompt: 'Hello', pendingModel: null };

        // Simulate a real compare-and-set: the first caller to reach the
        // claim wins; every subsequent caller for the same id gets null.
        let claimedAlready = false;
        sessions.claimScheduled.mockImplementation((id) => {
          if (id !== session.id || claimedAlready) return null;
          claimedAlready = true;
          return session;
        });

        projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
        messages.getBySessionId.mockReturnValue([]);
        conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
        messages.create.mockReturnValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Hello', conversationId: 'conv-1' });
        attachments.getBySessionId.mockReturnValue([]);

        // One call represents the manual "Start Now" request, the other the
        // poller finding the same due session — both race the same claim.
        const [manual, poller] = await Promise.all([
          scheduler.startScheduledSession(session),
          scheduler.startScheduledSession(session),
        ]);

        const outcomes = [manual.claimed, poller.claimed].sort();
        expect(outcomes).toEqual([false, true]);

        // Exactly one agent launch, regardless of which caller won.
        expect(mockSessionManager.runSession).toHaveBeenCalledTimes(1);
        expect(messages.create).toHaveBeenCalledTimes(1);
      });

      it('two concurrent manual requests for the same session produce exactly one launch', async () => {
        scheduler.initialize(mockSessionManager);
        mockSessionManager.continueSession = vi.fn().mockResolvedValue(undefined);
        const session = {
          id: 'session-1', name: 'Test Session', projectId: 'project-1',
          pendingPrompt: 'Follow-up', pendingConversationId: null, pendingModel: null,
        };

        let claimedAlready = false;
        sessions.claimScheduled.mockImplementation((id) => {
          if (id !== session.id || claimedAlready) return null;
          claimedAlready = true;
          return session;
        });

        projects.getById.mockReturnValue({ id: 'project-1', workingDirectory: '/tmp' });
        messages.getBySessionId.mockReturnValue([
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Response' },
        ]);
        attachments.getBySessionId.mockReturnValue([]);

        const results = await Promise.all([
          scheduler.startScheduledSession(session),
          scheduler.startScheduledSession(session),
        ]);

        expect(results.filter((r) => r.claimed)).toHaveLength(1);
        expect(results.filter((r) => !r.claimed)).toHaveLength(1);
        expect(mockSessionManager.continueSession).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('rescheduleSession', () => {
    it('reschedules session with delay using Continue by default', async () => {
      scheduler.initialize(mockSessionManager);
      const now = Date.now();
      vi.setSystemTime(now);

      const session = {
        id: 'session-1',
        projectId: 'project-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 0,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };
      const updatedSession = {
        ...session,
        status: 'scheduled',
        scheduledAt: now + 15 * 60 * 1000,
        rescheduleCount: 1,
        pendingPrompt: 'Continue',
        pendingConversationId: null,
        error: 'Rescheduled (1x): Token limit reached',
      };

      sessions.getById.mockReturnValue(session);
      sessions.update.mockReturnValue(updatedSession);

      const result = await scheduler.rescheduleSession('session-1', 'Token limit reached');

      expect(result).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith('session-1', {
        status: 'scheduled',
        scheduledAt: now + 15 * 60 * 1000,
        rescheduleCount: 1,
        pendingPrompt: 'Continue',
        pendingConversationId: null,
        error: expect.stringContaining('Rescheduled (1x)'),
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_STATUS, {
        sessionId: 'session-1',
        status: 'scheduled',
      });
      expect(broadcastToSession).toHaveBeenCalledWith('session-1', WS_MESSAGE_TYPES.SESSION_UPDATED, {
        sessionId: 'session-1',
        session: updatedSession,
      });
      expect(broadcastToProject).toHaveBeenCalledWith('project-1', WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: 'project-1',
        sessionId: 'session-1',
        session: updatedSession,
      });
    });

    it('with retryExistingMessage=true sets pendingPrompt to existing message and stores pendingConversationId', async () => {
      scheduler.initialize(mockSessionManager);
      const now = Date.now();
      vi.setSystemTime(now);

      const session = {
        id: 'session-1',
        projectId: 'project-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 0,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);
      sessions.update.mockReturnValue({ ...session, status: 'scheduled' });
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'Do the thing' },
      ]);

      const result = await scheduler.rescheduleSession(
        'session-1',
        'Token limit reached',
        { retryExistingMessage: true, conversationId: 'conv-1' }
      );

      expect(result).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
        pendingPrompt: 'Do the thing',
        pendingConversationId: 'conv-1',
      }));
    });

    it('with retryExistingMessage=true falls back to Continue when no user message in conversation', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1',
        projectId: 'project-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 0,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);
      sessions.update.mockReturnValue({ ...session, status: 'scheduled' });
      messages.getByConversationId.mockReturnValue([]);

      const result = await scheduler.rescheduleSession(
        'session-1',
        'Token limit reached',
        { retryExistingMessage: true, conversationId: 'conv-1' }
      );

      expect(result).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
        pendingPrompt: 'Continue',
        pendingConversationId: null,
      }));
    });

    it('explicit retryExistingMessage=false sets Continue and no conversationId', async () => {
      scheduler.initialize(mockSessionManager);
      const session = {
        id: 'session-1',
        projectId: 'project-1',
        rescheduleDelayMinutes: 15,
        rescheduleCount: 0,
        maxRescheduleCount: null,
        maxTotalTokens: null,
      };

      sessions.getById.mockReturnValue(session);
      sessions.update.mockReturnValue({ ...session, status: 'scheduled' });

      const result = await scheduler.rescheduleSession(
        'session-1',
        'Token threshold',
        { retryExistingMessage: false }
      );

      expect(result).toBe(true);
      expect(sessions.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
        pendingPrompt: 'Continue',
        pendingConversationId: null,
      }));
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

  describe('hasReachedLaunchBudget', () => {
    it('returns false when no maxTotalTokens is set', () => {
      const session = { id: 'session-1', maxTotalTokens: null, inputTokens: 100, outputTokens: 100 };
      expect(scheduler.hasReachedLaunchBudget(session)).toBe(false);
    });

    it('returns true when total tokens reach the cap', () => {
      const session = { id: 'session-1', maxTotalTokens: 1000, inputTokens: 600, outputTokens: 400 };
      expect(scheduler.hasReachedLaunchBudget(session)).toBe(true);
    });

    it('returns false when total tokens are below the cap', () => {
      const session = { id: 'session-1', maxTotalTokens: 1000, inputTokens: 600, outputTokens: 300 };
      expect(scheduler.hasReachedLaunchBudget(session)).toBe(false);
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
