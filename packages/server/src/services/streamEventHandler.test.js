import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
    updateUsage: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
    getByConversationId: vi.fn(),
    create: vi.fn(),
  },
  workLogs: {
    create: vi.fn(),
    associatePendingLogs: vi.fn(),
  },
  conversations: {
    getActiveBySessionId: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    updateUsage: vi.fn(),
  },
  attachments: {
    getBySessionId: vi.fn(),
  },
  modelProviders: {
    getProviderByModelId: vi.fn(),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('./todoStore.js', () => ({
  updateTodos: vi.fn(),
}));

vi.mock('./summaryService.js', () => ({
  onSessionComplete: vi.fn(),
  onSessionActivity: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
}));

vi.mock('./diffService.js', () => ({
  getChanges: vi.fn(),
}));

vi.mock('./usageTracker.js', () => ({
  updateTurnUsage: vi.fn(),
  currentTurnUsage: new Map(),
  estimatedOutputTokens: new Map(),
  estimateTokens: vi.fn(),
}));

import { sessions, workLogs, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import * as summaryService from './summaryService.js';
import * as diffService from './diffService.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import {
  createWorkLog,
  associateAndBroadcastWorkLogs,
  broadcastSessionStatus,
  broadcastChangesUpdate,
  cleanupSessionState,
  handleTurnCompletion,
  handleSessionError,
  lastMessageIds,
  thinkingAccumulators,
  textAccumulators,
  activeSessions,
  activeConversationIds,
  currentModels,
  loggedToolUseIds,
} from './streamEventHandler.js';

describe('streamEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all module-level Maps
    lastMessageIds.clear();
    thinkingAccumulators.clear();
    textAccumulators.clear();
    activeSessions.clear();
    activeConversationIds.clear();
    currentModels.clear();
    loggedToolUseIds.clear();
  });

  // ── createWorkLog ─────────────────────────────────────────────────────

  describe('createWorkLog', () => {
    it('creates a work log and broadcasts it', () => {
      const mockLog = { id: 'wl-1', sessionId: 'sess-1', type: 'thinking', content: 'pondering...' };
      workLogs.create.mockReturnValue(mockLog);

      const result = createWorkLog('sess-1', 'thinking', 'pondering...');

      expect(workLogs.create).toHaveBeenCalledWith('sess-1', 'thinking', 'pondering...', null, null);
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_WORK_LOG,
        { sessionId: 'sess-1', log: mockLog }
      );
      expect(result).toBe(mockLog);
    });

    it('passes toolName to workLogs.create', () => {
      workLogs.create.mockReturnValue({ id: 'wl-2' });
      createWorkLog('sess-1', 'tool_input', '{}', 'Read');

      expect(workLogs.create).toHaveBeenCalledWith('sess-1', 'tool_input', '{}', null, 'Read');
    });

    it('always passes null for messageId (unassociated)', () => {
      workLogs.create.mockReturnValue({ id: 'wl-3' });
      createWorkLog('sess-1', 'tool_output', 'result', 'Write');

      // 4th arg (messageId) should always be null
      expect(workLogs.create.mock.calls[0][3]).toBeNull();
    });
  });

  // ── associateAndBroadcastWorkLogs ─────────────────────────────────────

  describe('associateAndBroadcastWorkLogs', () => {
    it('associates and broadcasts when count > 0', () => {
      workLogs.associatePendingLogs.mockReturnValue(3);

      const count = associateAndBroadcastWorkLogs('sess-1', 'msg-1');

      expect(workLogs.associatePendingLogs).toHaveBeenCalledWith('sess-1', 'msg-1');
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED,
        { sessionId: 'sess-1', messageId: 'msg-1' }
      );
      expect(count).toBe(3);
    });

    it('does not broadcast when count is 0', () => {
      workLogs.associatePendingLogs.mockReturnValue(0);

      const count = associateAndBroadcastWorkLogs('sess-1', 'msg-1');

      expect(broadcastToSession).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });
  });

  // ── broadcastSessionStatus ────────────────────────────────────────────

  describe('broadcastSessionStatus', () => {
    it('broadcasts status to session subscribers', () => {
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });

      broadcastSessionStatus('sess-1', 'waiting');

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'waiting' }
      );
    });

    it('broadcasts SESSION_UPDATED to project subscribers', () => {
      const mockSession = { projectId: 'proj-1', name: 'Test' };
      sessions.getById.mockReturnValue(mockSession);

      broadcastSessionStatus('sess-1', 'running');

      expect(broadcastToProject).toHaveBeenCalledWith(
        'proj-1',
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        {
          projectId: 'proj-1',
          sessionId: 'sess-1',
          session: { ...mockSession, status: 'running' },
        }
      );
    });

    it('does not broadcast to project if session not found', () => {
      sessions.getById.mockReturnValue(null);

      broadcastSessionStatus('sess-unknown', 'error');

      expect(broadcastToSession).toHaveBeenCalled(); // Still broadcasts to session
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  // ── broadcastChangesUpdate ────────────────────────────────────────────

  describe('broadcastChangesUpdate', () => {
    it('computes and broadcasts changes', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: 'diff --git a/file1.js b/file1.js\n+added',
        unstaged: null,
        untracked: null,
      });

      await broadcastChangesUpdate('sess-1', 'proj-1', '/workspace');

      expect(diffService.getChanges).toHaveBeenCalledWith('/workspace');
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.CHANGES_UPDATE,
        {
          sessionId: 'sess-1',
          hasChanges: true,
          changeCount: 1,
        }
      );
    });

    it('broadcasts hasChanges false when no changes', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: null,
        unstaged: null,
        untracked: null,
      });

      await broadcastChangesUpdate('sess-1', 'proj-1', '/workspace');

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.CHANGES_UPDATE,
        {
          sessionId: 'sess-1',
          hasChanges: false,
          changeCount: 0,
        }
      );
    });

    it('counts files from multiple diff sections', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: 'diff --git a/a.js b/a.js\ndiff --git a/b.js b/b.js\n',
        unstaged: 'diff --git a/c.js b/c.js\n',
        untracked: 'diff --git a/d.js b/d.js\n',
      });

      await broadcastChangesUpdate('sess-1', 'proj-1', '/workspace');

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.CHANGES_UPDATE,
        {
          sessionId: 'sess-1',
          hasChanges: true,
          changeCount: 4,
        }
      );
    });

    it('handles errors silently', async () => {
      diffService.getChanges.mockRejectedValue(new Error('not a git repo'));

      // Should not throw
      await expect(broadcastChangesUpdate('sess-1', 'proj-1', '/workspace')).resolves.toBeUndefined();
      expect(broadcastToSession).not.toHaveBeenCalled();
    });
  });

  // ── cleanupSessionState ───────────────────────────────────────────────

  describe('cleanupSessionState', () => {
    it('cleans up all session Maps', () => {
      // Populate all Maps
      textAccumulators.set('sess-1', 'some text');
      thinkingAccumulators.set('sess-1', 'thinking...');
      currentModels.set('sess-1', 'claude-3');
      loggedToolUseIds.set('sess-1', new Set(['tu-1']));
      activeSessions.set('sess-1', { controller: new AbortController() });

      cleanupSessionState('sess-1');

      expect(textAccumulators.has('sess-1')).toBe(false);
      expect(thinkingAccumulators.has('sess-1')).toBe(false);
      expect(currentModels.has('sess-1')).toBe(false);
      expect(loggedToolUseIds.has('sess-1')).toBe(false);
      expect(activeSessions.has('sess-1')).toBe(false);
    });

    it('does not clean up activeConversationIds by default', () => {
      activeConversationIds.set('sess-1', 'conv-1');

      cleanupSessionState('sess-1');

      expect(activeConversationIds.has('sess-1')).toBe(true);
    });

    it('cleans up activeConversationIds when includeConversationId is true', () => {
      activeConversationIds.set('sess-1', 'conv-1');

      cleanupSessionState('sess-1', true);

      expect(activeConversationIds.has('sess-1')).toBe(false);
    });

    it('does not affect other sessions', () => {
      textAccumulators.set('sess-1', 'text1');
      textAccumulators.set('sess-2', 'text2');
      activeSessions.set('sess-1', {});
      activeSessions.set('sess-2', {});

      cleanupSessionState('sess-1');

      expect(textAccumulators.has('sess-2')).toBe(true);
      expect(activeSessions.has('sess-2')).toBe(true);
    });
  });

  // ── handleTurnCompletion ──────────────────────────────────────────────

  describe('handleTurnCompletion', () => {
    it('associates work logs with last message', async () => {
      lastMessageIds.set('sess-1', 'msg-last');
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(2);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(workLogs.associatePendingLogs).toHaveBeenCalledWith('sess-1', 'msg-last');
      expect(lastMessageIds.has('sess-1')).toBe(false);
    });

    it('transitions to waiting status', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting' });
    });

    it('checks proactive reschedule', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(mockCheckReschedule).toHaveBeenCalledWith('sess-1');
    });

    it('returns true when rescheduled', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(result).toBe(true);
      // Should not call handleTemplateTriggerIfNeeded when rescheduled
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('calls handleTemplateTriggerIfNeeded when not rescheduled', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(mockHandleTemplate).toHaveBeenCalledWith('sess-1');
    });

    it('does not set waiting when session was aborted', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: true } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('does not set waiting when session not in activeSessions', async () => {
      // activeSessions does not contain sess-1
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('triggers summary generation on turn completion', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule);

      expect(summaryService.onSessionActivity).toHaveBeenCalledWith('sess-1');
      expect(summaryService.extractPrUrlIfNeeded).toHaveBeenCalledWith('sess-1');
    });

    it('skips template trigger when auto-send fires', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(true);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, mockAutoSend);

      expect(mockAutoSend).toHaveBeenCalledWith('sess-1');
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('runs template trigger when auto-send does not fire', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, mockAutoSend);

      expect(mockAutoSend).toHaveBeenCalledWith('sess-1');
      expect(mockHandleTemplate).toHaveBeenCalledWith('sess-1');
    });

    it('runs template trigger when handleAutoSendIfNeeded is undefined', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      // Pass undefined for handleAutoSendIfNeeded — should not throw, template should still run
      await expect(
        handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, undefined)
      ).resolves.not.toThrow();

      expect(mockHandleTemplate).toHaveBeenCalledWith('sess-1');
    });

    it('calls auto-send before template trigger (order check)', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, mockAutoSend);

      expect(mockAutoSend).toHaveBeenCalled();
      expect(mockHandleTemplate).toHaveBeenCalled();
      // Auto-send should be called before template trigger
      expect(mockAutoSend.mock.invocationCallOrder[0]).toBeLessThan(
        mockHandleTemplate.mock.invocationCallOrder[0]
      );
    });

    it('does not call auto-send or template trigger when session was aborted', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: true } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, mockAutoSend);

      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('does not call auto-send or template trigger when rescheduled', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', mockHandleTemplate, mockCheckReschedule, mockAutoSend);

      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });
  });

  // ── handleSessionError ────────────────────────────────────────────────

  describe('handleSessionError', () => {
    it('checks reschedule and returns true if rescheduled', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(true) };

      const result = await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      expect(result).toBe(true);
      expect(mockShouldReschedule).toHaveBeenCalledWith(mockSession, error, 'sess-1');
      expect(mockScheduler.rescheduleSession).toHaveBeenCalledWith('sess-1', error.message);
    });

    it('falls through to error handling when reschedule fails', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(false) };

      const result = await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: error.message });
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: error.message }
      );
    });

    it('sets error status when not reschedulable', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Unexpected error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Unexpected error' });
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: 'Unexpected error' }
      );
    });

    it('does not update when controller is aborted', async () => {
      const controller = { signal: { aborted: true } };
      const error = new Error('Aborted');
      const mockShouldReschedule = vi.fn();
      const mockScheduler = { rescheduleSession: vi.fn() };

      const result = await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      expect(result).toBe(false);
      expect(sessions.update).not.toHaveBeenCalled();
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('broadcasts conversation state when broadcastConversationState option is true', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      conversations.getById.mockReturnValue({ id: 'conv-1', name: 'Test Conv' });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler, {
        broadcastConversationState: true,
      });

      // Should broadcast conversation update
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.CONVERSATION_UPDATED,
        { sessionId: 'sess-1', conversation: { id: 'conv-1', name: 'Test Conv' } }
      );
      // Should broadcast error status to session and project
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'error' }
      );
    });

    it('does not broadcast conversation state when option is false', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      // Should NOT broadcast conversation update
      const conversationUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CONVERSATION_UPDATED
      );
      expect(conversationUpdateCalls).toHaveLength(0);
    });

    it('triggers summary generation on error', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Failed');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler);

      expect(summaryService.onSessionComplete).toHaveBeenCalledWith('sess-1');
    });

    it('uses custom errorLabel when provided', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Custom error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handleSessionError('sess-1', error, controller, mockShouldReschedule, mockScheduler, {
        errorLabel: 'Continue session error',
      });

      expect(consoleSpy).toHaveBeenCalledWith('Continue session error:', error);
      consoleSpy.mockRestore();
    });
  });

  // ── Module-level Maps ─────────────────────────────────────────────────

  describe('module-level Maps', () => {
    it('exports lastMessageIds as a Map', () => {
      expect(lastMessageIds).toBeInstanceOf(Map);
    });

    it('exports thinkingAccumulators as a Map', () => {
      expect(thinkingAccumulators).toBeInstanceOf(Map);
    });

    it('exports textAccumulators as a Map', () => {
      expect(textAccumulators).toBeInstanceOf(Map);
    });

    it('exports activeSessions as a Map', () => {
      expect(activeSessions).toBeInstanceOf(Map);
    });

    it('exports activeConversationIds as a Map', () => {
      expect(activeConversationIds).toBeInstanceOf(Map);
    });

    it('exports currentModels as a Map', () => {
      expect(currentModels).toBeInstanceOf(Map);
    });

    it('exports loggedToolUseIds as a Map', () => {
      expect(loggedToolUseIds).toBeInstanceOf(Map);
    });
  });
});
