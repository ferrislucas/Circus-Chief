import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
    updateUsage: vi.fn(),
    touch: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
    getByConversationId: vi.fn(),
    getLastByConversationIdAndRole: vi.fn(),
    create: vi.fn(),
  },
  workLogs: {
    create: vi.fn(),
    associatePendingLogs: vi.fn(),
  },
  conversations: {
    getActiveBySessionId: vi.fn(),
    ensureActiveConversation: vi.fn(),
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

vi.mock('./gitService.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
}));

vi.mock('./usageTracker.js', () => ({
  updateTurnUsage: vi.fn(),
  currentTurnUsage: new Map(),
  estimatedOutputTokens: new Map(),
  estimateTokens: vi.fn(),
}));

vi.mock('./workflowSessionService.js', () => ({
  withActiveLaneRunOwnership: vi.fn((_sessionId, mutation) => mutation()),
}));

import { sessions, messages, workLogs, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import * as summaryService from './summaryService.js';
import * as diffService from './diffService.js';
import * as gitService from './gitService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  createWorkLog,
  associateAndBroadcastWorkLogs,
  broadcastSessionStatus,
  broadcastChangesUpdate,
  cleanupSessionState,
  handleStreamEvent,
  handleTurnCompletion,
  handleSessionError,
  lastMessageIds,
  thinkingAccumulators,
  textAccumulators,
  activeSessions,
  activeConversationIds,
  currentModels,
  loggedToolUseIds,
  finalErrorSessionIds,
  finalResultEvents,
  getResultEvent,
} from './streamEventHandler.js';
import { wakeupTurnStates, recordExplicitSchedule, captureScheduleWakeup, __resetWakeupTurnStatesForTest } from './scheduleWakeupBridge.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';
import { getPrompt, parkPrompt } from './promptStore.js';

describe('streamEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gitService.isGitRepo.mockResolvedValue(true);
    // Clear all module-level Maps
    lastMessageIds.clear();
    thinkingAccumulators.clear();
    textAccumulators.clear();
    activeSessions.clear();
    activeConversationIds.clear();
    currentModels.clear();
    loggedToolUseIds.clear();
    finalErrorSessionIds.clear();
    finalResultEvents.clear();
    __resetWakeupTurnStatesForTest();
    messages.getByConversationId.mockReturnValue([]);
    messages.getLastByConversationIdAndRole.mockReturnValue(null);
    messages.getBySessionId.mockReturnValue([]);
    messages.create.mockImplementation((sessionId, role, content, options = {}) => ({
      id: `msg-${role}`,
      sessionId,
      conversationId: options.conversationId ?? null,
      role,
      content,
    }));
    withActiveLaneRunOwnership.mockImplementation((_sessionId, mutation) => mutation());
  });

  // ── createWorkLog ─────────────────────────────────────────────────────

  describe('createWorkLog', () => {
    it('creates a work log and broadcasts it', () => {
      const mockLog = { id: 'wl-1', sessionId: 'sess-1', type: 'thinking', content: 'pondering...' };
      workLogs.create.mockReturnValue(mockLog);

      const result = createWorkLog('sess-1', 'thinking', 'pondering...');

      expect(workLogs.create).toHaveBeenCalledWith('sess-1', 'thinking', 'pondering...', { messageId: null, toolName: null });
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

      expect(workLogs.create).toHaveBeenCalledWith('sess-1', 'tool_input', '{}', { messageId: null, toolName: 'Read' });
    });

    it('always passes null for messageId (unassociated)', () => {
      workLogs.create.mockReturnValue({ id: 'wl-3' });
      createWorkLog('sess-1', 'tool_output', 'result', 'Write');

      // 4th arg is now an options object; messageId should always be null
      expect(workLogs.create.mock.calls[0][3].messageId).toBeNull();
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
      gitService.isGitRepo.mockResolvedValue(true);
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
      gitService.isGitRepo.mockResolvedValue(true);
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
      gitService.isGitRepo.mockResolvedValue(true);
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
      gitService.isGitRepo.mockResolvedValue(true);
      diffService.getChanges.mockRejectedValue(new Error('not a git repo'));

      // Should not throw
      await expect(broadcastChangesUpdate('sess-1', 'proj-1', '/workspace')).resolves.toBeUndefined();
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('skips changes update for non-git directories', async () => {
      gitService.isGitRepo.mockResolvedValue(false);

      await broadcastChangesUpdate('sess-1', 'proj-1', '/workspace');

      expect(diffService.getChanges).not.toHaveBeenCalled();
      expect(broadcastToSession).not.toHaveBeenCalled();
    });
  });

  // ── getResultEvent ────────────────────────────────────────────────────

  describe('getResultEvent', () => {
    it('returns null when no result event was captured', () => {
      expect(getResultEvent('sess-1')).toBeNull();
    });

    it('returns the captured result event record', () => {
      const record = { subtype: 'success', isError: false, resultText: 'Done.' };
      finalResultEvents.set('sess-1', record);
      expect(getResultEvent('sess-1')).toEqual(record);
    });

    it('consumes the entry on read — a second read returns null', () => {
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: 'Done.' });

      expect(getResultEvent('sess-1')).not.toBeNull();
      expect(getResultEvent('sess-1')).toBeNull();
      expect(finalResultEvents.has('sess-1')).toBe(false);
    });

    it('does not affect other sessions when consuming one', () => {
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: 'A' });
      finalResultEvents.set('sess-2', { subtype: 'success', isError: false, resultText: 'B' });

      getResultEvent('sess-1');

      expect(finalResultEvents.has('sess-1')).toBe(false);
      expect(finalResultEvents.has('sess-2')).toBe(true);
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
      lastMessageIds.set('sess-1', 'msg-1');
      finalResultEvents.set('sess-1', { subtype: 'success' });
      activeConversationIds.set('sess-1', 'conv-1');
      activeSessions.set('sess-1', { controller: new AbortController() });
      finalErrorSessionIds.add('sess-1');

      cleanupSessionState('sess-1', true);

      expect(textAccumulators.has('sess-1')).toBe(false);
      expect(thinkingAccumulators.has('sess-1')).toBe(false);
      expect(currentModels.has('sess-1')).toBe(false);
      expect(loggedToolUseIds.has('sess-1')).toBe(false);
      expect(lastMessageIds.has('sess-1')).toBe(false);
      expect(finalErrorSessionIds.has('sess-1')).toBe(false);
      expect(finalResultEvents.has('sess-1')).toBe(false);
      expect(activeConversationIds.has('sess-1')).toBe(false);
      expect(activeSessions.has('sess-1')).toBe(false);
    });

    it('settles a parked prompt before clearing its turn state', async () => {
      const controller = new AbortController();
      activeSessions.set('sess-1', { controller });
      const parked = parkPrompt({
        sessionId: 'sess-1', conversationId: 'conv-1', kind: 'permission',
        payload: { toolName: 'Read', input: {}, displayName: 'Read' }, signal: controller.signal,
      });

      cleanupSessionState('sess-1', true, controller);

      await expect(parked).resolves.toEqual({ behavior: 'deny', message: 'Session was cancelled.' });
      expect(getPrompt('sess-1')).toBeNull();
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

    it('does not let an old execution clean up replacement execution state', () => {
      const oldController = new AbortController();
      const replacementController = new AbortController();
      textAccumulators.set('sess-1', 'replacement text');
      thinkingAccumulators.set('sess-1', 'replacement thinking');
      currentModels.set('sess-1', 'replacement-model');
      loggedToolUseIds.set('sess-1', new Set(['replacement-tool']));
      finalErrorSessionIds.add('sess-1');
      finalResultEvents.set('sess-1', { subtype: 'success' });
      activeConversationIds.set('sess-1', 'replacement-conversation');
      activeSessions.set('sess-1', { controller: replacementController });

      const cleaned = cleanupSessionState('sess-1', true, oldController);

      expect(cleaned).toBe(false);
      expect(activeSessions.get('sess-1')?.controller).toBe(replacementController);
      expect(textAccumulators.get('sess-1')).toBe('replacement text');
      expect(thinkingAccumulators.get('sess-1')).toBe('replacement thinking');
      expect(currentModels.get('sess-1')).toBe('replacement-model');
      expect(loggedToolUseIds.get('sess-1')).toEqual(new Set(['replacement-tool']));
      expect(finalErrorSessionIds.has('sess-1')).toBe(true);
      expect(finalResultEvents.get('sess-1')).toEqual({ subtype: 'success' });
      expect(activeConversationIds.get('sess-1')).toBe('replacement-conversation');
    });

    it('cleans up state when the expected controller still owns the session', () => {
      const controller = new AbortController();
      textAccumulators.set('sess-1', 'some text');
      activeConversationIds.set('sess-1', 'conv-1');
      activeSessions.set('sess-1', { controller });

      const cleaned = cleanupSessionState('sess-1', true, controller);

      expect(cleaned).toBe(true);
      expect(textAccumulators.has('sess-1')).toBe(false);
      expect(activeSessions.has('sess-1')).toBe(false);
      expect(activeConversationIds.has('sess-1')).toBe(false);
    });

    it('still cleans up when the owner already deregistered (stopSession path)', () => {
      const controller = new AbortController();
      textAccumulators.set('sess-1', 'partial text');
      thinkingAccumulators.set('sess-1', 'partial thinking');
      currentModels.set('sess-1', 'some-model');
      loggedToolUseIds.set('sess-1', new Set(['tool-1']));
      finalErrorSessionIds.add('sess-1');
      finalResultEvents.set('sess-1', { subtype: 'error' });
      activeConversationIds.set('sess-1', 'conv-1');
      // stopSession() removed the activeSessions entry before the turn unwound;
      // an absent entry must not be mistaken for a live replacement execution.
      activeSessions.delete('sess-1');

      const cleaned = cleanupSessionState('sess-1', true, controller);

      expect(cleaned).toBe(true);
      expect(textAccumulators.has('sess-1')).toBe(false);
      expect(thinkingAccumulators.has('sess-1')).toBe(false);
      expect(currentModels.has('sess-1')).toBe(false);
      expect(loggedToolUseIds.has('sess-1')).toBe(false);
      expect(finalErrorSessionIds.has('sess-1')).toBe(false);
      expect(finalResultEvents.has('sess-1')).toBe(false);
      expect(activeConversationIds.has('sess-1')).toBe(false);
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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('lands both status dimensions when an aborted turn has no recorded outcome', async () => {
      const controller = { signal: { aborted: true } };
      activeSessions.set('sess-1', { controller });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ status: 'running' });

      await handleTurnCompletion('sess-1', '/workspace', {}, { controller });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', {
        status: 'stopped',
        executionState: 'stopped',
      });
    });

    it('does not let an aborted older turn stop a newer registered turn', async () => {
      const oldController = { signal: { aborted: true } };
      const newController = { signal: { aborted: false } };
      activeSessions.set('sess-1', { controller: newController });
      sessions.getById.mockReturnValue({ status: 'running' });

      await handleTurnCompletion('sess-1', '/workspace', {}, { controller: oldController });

      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('does not let a normally-completing older turn mark a newer turn waiting', async () => {
      const oldController = { signal: { aborted: false } };
      const newController = { signal: { aborted: false } };
      activeSessions.set('sess-1', { controller: newController });
      sessions.getById.mockReturnValue({ status: 'running' });

      await handleTurnCompletion('sess-1', '/workspace', {}, { controller: oldController });

      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('clears stale error when transitioning to waiting status', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('checks proactive reschedule', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(mockCheckReschedule).toHaveBeenCalledWith('sess-1');
    });

    it('returns true when rescheduled', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(result).toEqual({ wasRescheduled: true, heldForLimit: false });
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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(mockHandleTemplate).toHaveBeenCalledWith('sess-1');
    });

    it('lands stopped, not waiting, when the session was aborted', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: true } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'stopped', executionState: 'stopped' });
    });

    it('does not set waiting when session not in activeSessions', async () => {
      // activeSessions does not contain sess-1
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('triggers summary generation on turn completion', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(summaryService.onSessionActivity).toHaveBeenCalledWith('sess-1');
      expect(summaryService.extractPrUrlIfNeeded).toHaveBeenCalledWith('sess-1');
    });

    it('completes the turn normally on natural completion (no usage-limit/outage signal)', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: 'Done, all tests pass.' });
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: 'Here is the finished implementation.' },
      ]);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('advances the card when a genuine completion summary merely mentions a limit/outage phrase in passing', async () => {
      // Regression guard for Issue 1: the Claude Code `result` event's text IS the
      // final assistant message, so a work summary that happens to contain a framed
      // terminal phrase (e.g. "Fixed HTTP 503 Service Unavailable handling...") must
      // still advance the card, not be misclassified as a graceful usage-limit/outage hold.
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: 'Fixed HTTP 503 Service Unavailable handling in the proxy' });
      messages.getBySessionId.mockReturnValue([]);

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      const result = await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('holds completion when the result event carries usage-limit text, but still sets waiting', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: "You've reached your usage limit" });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      const result = await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: true });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
      expect(summaryService.onSessionActivity).toHaveBeenCalledWith('sess-1');
      expect(mockHandleTemplate).toHaveBeenCalledWith('sess-1');
    });

    it('holds completion when the result event carries service-error text, but still sets waiting', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: 'The server is overloaded' });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('held + proactively-rescheduled turns early-return before any normal-completion side effect runs (Issue 3)', async () => {
      // A proactively-rescheduled turn never advances the card, held or not — the
      // session is about to be re-run automatically, so completion side effects
      // (PR extraction, summary, changes broadcast, auto-send, template trigger)
      // belong to the *continued* turn, not this one. Running them here would let
      // handleTemplateTriggerIfNeeded double-drive the session while it's
      // simultaneously scheduled to retry.
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: "You've reached your usage limit" });

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      // Proactive reschedule still ran and fired.
      expect(mockCheckReschedule).toHaveBeenCalledWith('sess-1');
      expect(result).toEqual({ wasRescheduled: true, heldForLimit: false });
      // The card must not advance...
      // ...and the next-template trigger must not fire (the session was rescheduled)...
      expect(mockHandleTemplate).not.toHaveBeenCalled();
      // ...nor any other normal-completion side effect, deferred to the continued turn.
      expect(summaryService.extractPrUrlIfNeeded).not.toHaveBeenCalled();
      expect(summaryService.onSessionActivity).not.toHaveBeenCalled();
      expect(diffService.getChanges).not.toHaveBeenCalled();
      expect(mockAutoSend).not.toHaveBeenCalled();
      // The waiting-status transition (before the reschedule check) still occurs.
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('non-held turns with proactive token-threshold rescheduling keep existing reschedule behavior (early return, no side effects)', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      messages.getBySessionId.mockReturnValue([]);

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: true, heldForLimit: false });
      // Unchanged legacy behavior: reschedule short-circuits before other side effects.
      expect(summaryService.extractPrUrlIfNeeded).not.toHaveBeenCalled();
      expect(summaryService.onSessionActivity).not.toHaveBeenCalled();
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('does not reuse a stale held result event on a later natural completion (consume-on-read)', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      messages.getBySessionId.mockReturnValue([]);

      // First turn: a genuine usage-limit result event holds the completion move.
      finalResultEvents.set('sess-1', { subtype: 'success', isError: false, resultText: "You've reached your usage limit" });
      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });
      // The held event must have been consumed (deleted) on read.
      expect(finalResultEvents.has('sess-1')).toBe(false);

      // Second turn: no new result event was captured for this turn (e.g. the
      // handler ran before a fresh `result` event arrived). The stale held
      // payload from the first turn must NOT be reused — completion should
      // proceed normally since there's no signal for this turn.
      vi.clearAllMocks();
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
      messages.getBySessionId.mockReturnValue([]);
      workLogs.associatePendingLogs.mockReturnValue(0);
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule });
    });

    it('skips template trigger when auto-send fires', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);
      sessions.getById.mockReturnValue({ projectId: 'proj-1' });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(true);

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: mockAutoSend });

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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: mockAutoSend });

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
        handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: undefined })
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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: mockAutoSend });

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

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: mockAutoSend });

      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('does not call auto-send or template trigger when rescheduled', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      await handleTurnCompletion('sess-1', '/workspace', { handleTemplateTriggerIfNeeded: mockHandleTemplate, checkProactiveReschedule: mockCheckReschedule, handleAutoSendIfNeeded: mockAutoSend });

      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('preserves error state after a final result error', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      activeConversationIds.set('sess-1', 'conv-1');
      lastMessageIds.set('sess-1', 'msg-last');
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
      ]);
      workLogs.associatePendingLogs.mockReturnValue(1);

      await handleStreamEvent('sess-1', {
        type: 'result',
        subtype: 'error',
        error: 'usage limit reached',
      });

      vi.clearAllMocks();
      workLogs.associatePendingLogs.mockReturnValue(1);
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      expect(workLogs.associatePendingLogs).toHaveBeenCalledWith('sess-1', 'msg-last');
      expect(lastMessageIds.has('sess-1')).toBe(false);
      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
      expect(broadcastToSession.mock.calls.some(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_STATUS && call[2]?.status === 'waiting'
      )).toBe(false);
      expect(summaryService.onSessionActivity).not.toHaveBeenCalled();
      expect(summaryService.extractPrUrlIfNeeded).not.toHaveBeenCalled();
      expect(diffService.getChanges).not.toHaveBeenCalled();
      expect(mockCheckReschedule).not.toHaveBeenCalled();
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
      expect(finalErrorSessionIds.has('sess-1')).toBe(false);
    });

    // ── handleScheduledContinuationIfNeeded (mid-turn schedule hook) ──────

    it('re-applies scheduled status while preserving successful completion side effects', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const futureScheduledAt = Date.now() + 3600000;
      sessions.getById.mockReturnValue({
        id: 'sess-1',
        projectId: 'proj-1',
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Continue the analysis',
      });
      sessions.update.mockReturnValue({
        id: 'sess-1',
        projectId: 'proj-1',
        status: 'scheduled',
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Continue the analysis',
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(summaryService.extractPrUrlIfNeeded).toHaveBeenCalledWith('sess-1');
      expect(summaryService.onSessionActivity).toHaveBeenCalledWith('sess-1');
      expect(diffService.getChanges).toHaveBeenCalledWith('/workspace');

      // Auto-send and template trigger must NOT fire for this turn
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('preserves explicit scheduled continuation instead of proactive rescheduling', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const futureScheduledAt = Date.now() + 3600000;
      const session = {
        id: 'sess-1',
        projectId: 'proj-1',
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Explicit continuation',
        pendingConversationId: 'conv-explicit',
        pendingModel: 'gpt-5.4',
      };
      sessions.getById.mockReturnValue(session);
      sessions.update.mockImplementation((sessionId, updates) => {
        if (sessionId === 'sess-1') {
          Object.assign(session, updates);
        }
        return session;
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(true);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      expect(mockCheckReschedule).not.toHaveBeenCalled();
      expect(session).toMatchObject({
        status: 'scheduled',
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Explicit continuation',
        pendingConversationId: 'conv-explicit',
        pendingModel: 'gpt-5.4',
      });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(summaryService.extractPrUrlIfNeeded).toHaveBeenCalledWith('sess-1');
      expect(summaryService.onSessionActivity).toHaveBeenCalledWith('sess-1');
      expect(diffService.getChanges).toHaveBeenCalledWith('/workspace');
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('re-applies scheduled status when scheduledAt became due before turn completion', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const pastScheduledAt = Date.now() - 1000;
      sessions.getById.mockReturnValue({
        id: 'sess-1',
        projectId: 'proj-1',
        scheduledAt: pastScheduledAt,
        pendingPrompt: 'Continue',
      });
      sessions.update.mockReturnValue({
        id: 'sess-1',
        projectId: 'proj-1',
        status: 'scheduled',
        scheduledAt: pastScheduledAt,
        pendingPrompt: 'Continue',
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'scheduled' }
      );
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('does not re-apply scheduled status when pendingPrompt is missing', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      sessions.getById.mockReturnValue({
        projectId: 'proj-1',
        scheduledAt: Date.now() + 3600000,
        pendingPrompt: null, // no prompt
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      // Normal waiting write should have happened
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('does not re-apply scheduled status when scheduledAt is 0', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      sessions.getById.mockReturnValue({
        projectId: 'proj-1',
        scheduledAt: 0,
        pendingPrompt: 'Some prompt',
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      // scheduledAt=0 should not flip to 'scheduled'; normal waiting write should have happened
      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('does not re-apply scheduled status when scheduledAt is negative', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      sessions.getById.mockReturnValue({
        projectId: 'proj-1',
        scheduledAt: -1000,
        pendingPrompt: 'Some prompt',
      });
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockAutoSend = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
    });

    it('mid-turn schedule wins over autoSendPendingPrompt', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const futureScheduledAt = Date.now() + 3600000;
      sessions.getById.mockReturnValue({
        projectId: 'proj-1',
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Scheduled continuation',
        autoSendPendingPrompt: true, // would normally trigger auto-send
      });

      const mockCheckReschedule = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn();
      const mockAutoSend = vi.fn();

      const result = await handleTurnCompletion('sess-1', '/workspace', {
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
      });

      expect(result).toEqual({ wasRescheduled: false, heldForLimit: false });
      // Auto-send must NOT fire — schedule wins
      expect(mockAutoSend).not.toHaveBeenCalled();
    });
  });

  // ── ScheduleWakeup bridge (end-to-end wiring) ─────────────────────────

  describe('ScheduleWakeup bridge', () => {
    /** Assistant event carrying a ScheduleWakeup tool_use block. */
    function wakeupEvent(input) {
      return {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: "I'll wait for the scheduled wakeup." },
            { type: 'tool_use', id: 'tool-wakeup', name: 'ScheduleWakeup', input },
          ],
        },
      };
    }

    /** Stateful session mock so the completion predicate observes the bridge's write. */
    function statefulSession(overrides = {}) {
      const session = {
        id: 'sess-1',
        projectId: 'proj-1',
        scheduledAt: null,
        pendingPrompt: null,
        laneRunId: null,
        ...overrides,
      };
      sessions.getById.mockReturnValue(session);
      sessions.update.mockImplementation((sessionId, updates) => {
        if (sessionId === 'sess-1') Object.assign(session, updates);
        return session;
      });
      return session;
    }

    beforeEach(() => {
      // Reset all turn-scoped wakeup state for 'sess-1' (pending wakeup, the
      // tool_use dedup set, and the explicit-schedule recency marker) — not
      // just pendingWakeups — since several tests below reuse the same
      // tool_use id ('tool-wakeup') across `it` blocks.
      __resetWakeupTurnStatesForTest();
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1' });
      workLogs.associatePendingLogs.mockReturnValue(0);
      diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
    });

    it('turns a ScheduleWakeup call into a scheduled continuation', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession();

      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 1200,
        reason: 'waiting for the full E2E suite',
        prompt: 'Continue: check /tmp/e2e-full-run.log',
      }));

      // Nothing is persisted until the turn actually ends.
      expect(session.scheduledAt).toBeNull();

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(session).toMatchObject({
        status: 'scheduled',
        pendingPrompt: 'Continue: check /tmp/e2e-full-run.log',
        pendingConversationId: null,
      });
      expect(session.scheduledAt).toBeGreaterThan(Date.now());
      // No intermediate 'waiting' status is broadcast on the wakeup path.
      expect(broadcastToSession).not.toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'waiting' }
      );
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'scheduled' }
      );
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          sessionId: 'sess-1',
          session: expect.objectContaining({
            status: 'scheduled',
            pendingPrompt: 'Continue: check /tmp/e2e-full-run.log',
            pendingConversationId: null,
          }),
        })
      );
      expect(broadcastToProject).toHaveBeenCalledWith(
        'proj-1',
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          sessionId: 'sess-1',
          session: expect.objectContaining({ scheduledAt: session.scheduledAt }),
        })
      );
    });

    it('turns the SDK dynamic autonomous-loop sentinel into a resumable existing-message continuation', async () => {
      const controller = new AbortController();
      activeSessions.set('sess-1', { controller });
      const session = statefulSession();
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
      messages.getLastByConversationIdAndRole.mockReturnValue({ id: 'msg-loop-user', role: 'user', content: '/loop' });

      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600,
        reason: 'wait for external work',
        prompt: '<<autonomous-loop-dynamic>>',
      }), { controller });

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      }, { controller });

      expect(session).toMatchObject({
        status: 'scheduled',
        pendingPrompt: 'Continue',
        pendingConversationId: 'conv-loop',
      });
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          session: expect.objectContaining({ pendingConversationId: 'conv-loop' }),
        })
      );
    });

    it('suppresses auto-send and the template trigger, like a REST schedule', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      statefulSession({ autoSendPendingPrompt: true });

      await handleStreamEvent('sess-1', wakeupEvent({ delaySeconds: 600, reason: 'r', prompt: 'Continue' }));

      const mockAutoSend = vi.fn().mockResolvedValue(false);
      const mockHandleTemplate = vi.fn().mockResolvedValue(undefined);
      const mockCheckReschedule = vi.fn().mockResolvedValue(false);

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: mockCheckReschedule,
        handleAutoSendIfNeeded: mockAutoSend,
        handleTemplateTriggerIfNeeded: mockHandleTemplate,
      });

      expect(mockCheckReschedule).not.toHaveBeenCalled();
      expect(mockAutoSend).not.toHaveBeenCalled();
      expect(mockHandleTemplate).not.toHaveBeenCalled();
    });

    it('associates a wakeup supersession diagnostic with the current turn', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      statefulSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Explicitly scheduled prompt',
      });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600,
        reason: 'r',
        prompt: 'Earlier wakeup prompt',
      }));
      recordExplicitSchedule('sess-1', activeSessions.get('sess-1').controller);

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(workLogs.create).toHaveBeenCalledWith(
        'sess-1',
        'tool_output',
        expect.stringContaining('superseded'),
        expect.objectContaining({ toolName: 'ScheduleWakeup' })
      );
      const supersessionLogIndex = workLogs.create.mock.calls.findIndex(([, , content]) => content.includes('superseded'));
      const supersessionLogOrder = workLogs.create.mock.invocationCallOrder[supersessionLogIndex];
      expect(workLogs.associatePendingLogs).toHaveBeenLastCalledWith('sess-1', 'msg-assistant');
      expect(workLogs.associatePendingLogs.mock.invocationCallOrder.at(-1)).toBeGreaterThan(supersessionLogOrder);
      expect(lastMessageIds.has('sess-1')).toBe(false);
    });

    it('leaves an ordinary turn untouched', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession();

      await handleStreamEvent('sess-1', {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
      });

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(session.status).toBe('waiting');
      expect(session.scheduledAt).toBeNull();
    });

    it('skips the intermediate waiting write when a captured wakeup is applied', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession();

      await handleStreamEvent('sess-1', wakeupEvent({ delaySeconds: 600, prompt: 'Continue' }));

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(session.status).toBe('scheduled');
      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', { status: 'waiting', error: null });
      const scheduledWrites = sessions.update.mock.calls.filter(
        (call) => call[0] === 'sess-1' && call[1]?.status === 'scheduled'
      );
      expect(scheduledWrites).toHaveLength(1);
    });

    it('refuses to restore \'scheduled\' when a superseded lane run carries a leftover schedule', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession({
        laneRunId: 'run-1',
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Leftover schedule',
      });
      withActiveLaneRunOwnership.mockReturnValue(null);

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(session.status).not.toBe('scheduled');
      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', { status: 'scheduled' });
      expect(broadcastToSession).not.toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'scheduled' }
      );
    });

    it('restores \'scheduled\' through the lane fence when the lane run is still active', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession({
        laneRunId: 'run-1',
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Leftover schedule',
      });

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(withActiveLaneRunOwnership).toHaveBeenCalledWith('sess-1', expect.any(Function));
      expect(session.status).toBe('scheduled');
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_STATUS,
        { sessionId: 'sess-1', status: 'scheduled' }
      );
    });

    it('does not apply lane fencing to a non-workflow session', async () => {
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
      const session = statefulSession({
        scheduledAt: Date.now() + 3_600_000,
        pendingPrompt: 'Leftover schedule',
      });

      await handleTurnCompletion('sess-1', '/workspace', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      expect(session.status).toBe('scheduled');
      expect(withActiveLaneRunOwnership).not.toHaveBeenCalled();
    });

    it('discards a dynamic autonomous-loop wakeup across the error path', async () => {
      const controller = { signal: { aborted: false } };
      activeSessions.set('sess-1', { controller });
      const session = statefulSession();
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
      messages.getByConversationId.mockReturnValue([{ id: 'msg-loop-user', role: 'user', content: '/loop' }]);

      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 270,
        reason: 'r',
        prompt: '<<autonomous-loop-dynamic>>',
      }));

      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(true) };
      const result = await handleSessionError('sess-1', new Error('stream blew up'), {
        controller,
        shouldRescheduleOnError: vi.fn().mockReturnValue(true),
        schedulerService: mockScheduler,
      });

      // ScheduleWakeup only takes effect after a successful completion, so an
      // error falls through to the ordinary automatic-reschedule policy.
      expect(result).toBe(true);
      expect(mockScheduler.rescheduleSession).toHaveBeenCalled();
      expect(session.pendingConversationId).not.toBe('conv-loop');
      expect(wakeupTurnStates.has(controller)).toBe(false);
    });

    it('discards a dynamic autonomous-loop wakeup when the turn is cleaned up without completing', async () => {
      const controller = { signal: { aborted: false } };
      activeSessions.set('sess-1', { controller });
      statefulSession();
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-loop', claudeSessionId: 'claude-loop' });
      messages.getByConversationId.mockReturnValue([{ id: 'msg-loop-user', role: 'user', content: '/loop' }]);

      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600,
        reason: 'r',
        prompt: '<<autonomous-loop-dynamic>>',
      }));
      expect(wakeupTurnStates.get(activeSessions.get('sess-1').controller)?.pendingWakeup).toBeTruthy();

      cleanupSessionState('sess-1');

      expect(wakeupTurnStates.get(controller)?.pendingWakeup).toBeFalsy();
    });

    it('keeps a replacement turn isolated while an aborted turn finally unwinds', async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const session = statefulSession();
      const callbacks = {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      activeSessions.set('sess-1', { controller: controllerA });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600, reason: 'turn A', prompt: 'STALE TURN A PROMPT',
      }), { controller: controllerA });

      // stopSession() aborts and deregisters A before its async finally runs.
      controllerA.abort();
      activeSessions.delete('sess-1');
      activeSessions.set('sess-1', { controller: controllerB });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 900, reason: 'turn B', prompt: 'TURN B PROMPT',
      }), { controller: controllerB });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600, reason: 'stale turn A event', prompt: 'STALE TURN A EVENT PROMPT',
      }), { controller: controllerA });

      expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'TURN B PROMPT' });

      // A's delayed completion/finally cannot read, apply, or clear B's state.
      await handleTurnCompletion('sess-1', '/workspace', callbacks, { controller: controllerA });
      expect(wakeupTurnStates.has(controllerA)).toBe(false);
      expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'TURN B PROMPT' });
      expect(session.pendingPrompt).not.toBe('STALE TURN A PROMPT');

      expect(cleanupSessionState('sess-1', true, controllerA)).toBe(false);
      expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'TURN B PROMPT' });

      await handleTurnCompletion('sess-1', '/workspace', callbacks, { controller: controllerB });
      expect(session).toMatchObject({ status: 'scheduled', pendingPrompt: 'TURN B PROMPT' });
      expect(session.pendingPrompt).not.toBe('STALE TURN A PROMPT');
    });

    it('makes the double-clear of an aborted turn idempotent (guard clear is a no-op after completion-path clear)', async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      statefulSession();
      const callbacks = {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      activeSessions.set('sess-1', { controller: controllerA });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 600, reason: 'turn A', prompt: 'STALE TURN A PROMPT',
      }), { controller: controllerA });

      controllerA.abort();
      activeSessions.delete('sess-1');
      activeSessions.set('sess-1', { controller: controllerB });
      await handleStreamEvent('sess-1', wakeupEvent({
        delaySeconds: 900, reason: 'turn B', prompt: 'TURN B PROMPT',
      }), { controller: controllerB });

      // The non-owner completion path already cleared A's wakeup state.
      await handleTurnCompletion('sess-1', '/workspace', callbacks, { controller: controllerA });
      expect(wakeupTurnStates.has(controllerA)).toBe(false);

      // The unwinding finally then hits the early-return guard, which clears A
      // again. It must stay a no-op for A and must not touch B's entry.
      expect(cleanupSessionState('sess-1', true, controllerA)).toBe(false);
      expect(wakeupTurnStates.has(controllerA)).toBe(false);
      expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'TURN B PROMPT' });
    });

    it('clears an aborted turn wakeup state when its finally runs before the completion path (guard-order independence)', async () => {
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      statefulSession();

      activeSessions.set('sess-1', { controller: controllerA });
      captureScheduleWakeup('sess-1', controllerA, [
        { type: 'tool_use', id: 'wk-guard-a', name: 'ScheduleWakeup', input: { delaySeconds: 600, prompt: 'TURN A PROMPT' } },
      ]);

      // A replacement registers; A's finally runs first with NO prior
      // completion-path clear — the exact leak this hardening removes.
      controllerA.abort();
      activeSessions.delete('sess-1');
      activeSessions.set('sess-1', { controller: controllerB });
      captureScheduleWakeup('sess-1', controllerB, [
        { type: 'tool_use', id: 'wk-guard-b', name: 'ScheduleWakeup', input: { delaySeconds: 900, prompt: 'TURN B PROMPT' } },
      ]);

      expect(cleanupSessionState('sess-1', true, controllerA)).toBe(false);
      expect(wakeupTurnStates.has(controllerA)).toBe(false);
      expect(wakeupTurnStates.get(controllerB)?.pendingWakeup).toMatchObject({ prompt: 'TURN B PROMPT' });
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

      const result = await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(result).toBe(true);
      expect(mockShouldReschedule).toHaveBeenCalledWith(mockSession, error, 'sess-1');
      expect(mockScheduler.rescheduleSession).toHaveBeenCalledWith(
        'sess-1',
        error.message,
        expect.objectContaining({ retryExistingMessage: expect.any(Boolean) })
      );
    });

    it('falls through to error handling when reschedule fails', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { agentType: 'codex', autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(false) };

      const result = await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: error.message });
      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('Codex failed before completing this turn'),
        { conversationId: 'conv-1' }
      );
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: error.message }
      );
    });

    it('sets error status when not reschedulable', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Unexpected error');
      sessions.getById.mockReturnValue({ agentType: 'codex', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'start' },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Unexpected error' });
      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('Unexpected error'),
        { conversationId: 'conv-1' }
      );
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: 'Unexpected error' }
      );
    });

    it('creates and broadcasts Codex final error messages before SESSION_ERROR', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('usage limit reached');
      sessions.getById.mockReturnValue({ agentType: 'codex', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'Implement the plan' },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('Codex failed before completing this turn'),
        { conversationId: 'conv-1' }
      );
      expect(messages.create.mock.calls[0][2]).toContain('usage limit reached');

      const sessionMessageCallIndex = broadcastToSession.mock.calls.findIndex(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_MESSAGE
      );
      const sessionErrorCallIndex = broadcastToSession.mock.calls.findIndex(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_ERROR
      );
      expect(sessionMessageCallIndex).toBeGreaterThanOrEqual(0);
      expect(sessionErrorCallIndex).toBeGreaterThanOrEqual(0);
      expect(sessionMessageCallIndex).toBeLessThan(sessionErrorCallIndex);
    });

    it('creates final error messages with an ensured conversation when no active conversation ID exists', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('adapter startup failed');
      sessions.getById.mockReturnValue({ agentType: 'codex', autoRescheduleEnabled: false });
      conversations.ensureActiveConversation.mockReturnValue({ id: 'conv-created' });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(conversations.ensureActiveConversation).toHaveBeenCalledWith('sess-1');
      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('Codex failed before completing this turn'),
        { conversationId: 'conv-created' }
      );
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_MESSAGE,
        {
          message: expect.objectContaining({ conversationId: 'conv-created', role: 'assistant' }),
          conversationId: 'conv-created',
        }
      );
    });

    it('does not update when controller is aborted', async () => {
      const controller = { signal: { aborted: true } };
      const error = new Error('Aborted');
      const mockShouldReschedule = vi.fn();
      const mockScheduler = { rescheduleSession: vi.fn() };

      const result = await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(result).toBe(false);
      expect(sessions.update).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('does not create or broadcast visible messages for rescheduled errors', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { agentType: 'codex', autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(true) };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create).not.toHaveBeenCalled();
      expect(broadcastToSession.mock.calls.some((call) => call[1] === WS_MESSAGE_TYPES.SESSION_MESSAGE)).toBe(false);
      expect(broadcastToSession.mock.calls.some((call) => call[1] === WS_MESSAGE_TYPES.SESSION_ERROR)).toBe(false);
    });

    it('does not duplicate the same generated assistant failure message', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('usage limit reached');
      const generatedContent = 'Codex failed before completing this turn:\n\nusage limit reached';
      sessions.getById.mockReturnValue({ agentType: 'codex', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
        { id: 'msg-assistant', sessionId: 'sess-1', conversationId: 'conv-1', role: 'assistant', content: generatedContent },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create).not.toHaveBeenCalled();
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: 'usage limit reached' }
      );
    });

    it('does not duplicate an assistant failure after the latest user when it contains the raw error', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('context window exceeded');
      sessions.getById.mockReturnValue({ agentType: 'codex', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
        { id: 'msg-assistant', sessionId: 'sess-1', conversationId: 'conv-1', role: 'assistant', content: 'Run failed: context window exceeded' },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create).not.toHaveBeenCalled();
    });

    it('does not duplicate a Claude Code visible error containing the raw error', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('process exited with code 1');
      sessions.getById.mockReturnValue({ agentType: 'claude-code', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
        { id: 'msg-assistant', sessionId: 'sess-1', conversationId: 'conv-1', role: 'assistant', content: 'Claude reported: process exited with code 1' },
      ]);

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create).not.toHaveBeenCalled();
    });

    it('uses fallback wording for unknown adapter types', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('adapter failed');
      sessions.getById.mockReturnValue({ agentType: 'other-agent', autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(messages.create.mock.calls[0][2]).toMatch(/^The agent failed before completing this turn/);
    });

    it('broadcasts conversation state when broadcastConversationState option is true', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });
      activeConversationIds.set('sess-1', 'conv-1');
      conversations.getById.mockReturnValue({ id: 'conv-1', name: 'Test Conv' });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
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

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

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

      await handleSessionError('sess-1', error, { controller, shouldRescheduleOnError: mockShouldReschedule, schedulerService: mockScheduler });

      expect(summaryService.onSessionComplete).toHaveBeenCalledWith('sess-1');
    });

    it('uses custom errorLabel when provided', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Custom error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        errorLabel: 'Continue session error',
      });

      expect(consoleSpy).toHaveBeenCalledWith('Continue session error:', error);
      consoleSpy.mockRestore();
    });

    it('calls extractPrUrlIfNeeded before onSessionComplete', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Failed after creating PR');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(summaryService.extractPrUrlIfNeeded).toHaveBeenCalledWith('sess-1');
      expect(summaryService.onSessionComplete).toHaveBeenCalledWith('sess-1');
      // Verify call order: extractPrUrlIfNeeded should be called before onSessionComplete
      expect(summaryService.extractPrUrlIfNeeded.mock.invocationCallOrder[0]).toBeLessThan(
        summaryService.onSessionComplete.mock.invocationCallOrder[0]
      );
    });

    it('does not call extractPrUrlIfNeeded when controller is aborted', async () => {
      const controller = { signal: { aborted: true } };
      const error = new Error('Aborted');

      const mockShouldReschedule = vi.fn();
      const mockScheduler = { rescheduleSession: vi.fn() };

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(summaryService.extractPrUrlIfNeeded).not.toHaveBeenCalled();
      expect(summaryService.onSessionComplete).not.toHaveBeenCalled();
    });

    it('does not call extractPrUrlIfNeeded when session is rescheduled', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(true) };

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(result).toBe(true);
      expect(summaryService.extractPrUrlIfNeeded).not.toHaveBeenCalled();
      expect(summaryService.onSessionComplete).not.toHaveBeenCalled();
    });

    it('calls handleTemplateTriggerIfNeeded when session errors (not rescheduled)', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Process exited with code 1');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };
      const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(mockTemplateTrigger).toHaveBeenCalledWith('sess-1');
    });

    it('does not call handleTemplateTriggerIfNeeded when session is rescheduled', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(true) };
      const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(result).toBe(true);
      expect(mockTemplateTrigger).not.toHaveBeenCalled();
    });

    it('does not call handleTemplateTriggerIfNeeded when controller is aborted', async () => {
      const controller = { signal: { aborted: true } };
      const error = new Error('Aborted');

      const mockShouldReschedule = vi.fn();
      const mockScheduler = { rescheduleSession: vi.fn() };
      const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(mockTemplateTrigger).not.toHaveBeenCalled();
    });

    it('calls handleTemplateTriggerIfNeeded when reschedule was attempted but failed (limits reached)', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('token limit exceeded');
      const mockSession = { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true };
      sessions.getById.mockReturnValue(mockSession);

      const mockShouldReschedule = vi.fn().mockReturnValue(true);
      const mockScheduler = { rescheduleSession: vi.fn().mockResolvedValue(false) };
      const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(mockTemplateTrigger).toHaveBeenCalledWith('sess-1');
    });

    it('calls handleTemplateTriggerIfNeeded after both extractPrUrlIfNeeded and onSessionComplete', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Process exited with code 1');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };
      const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

      await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      // Verify invocation order: extractPrUrlIfNeeded < onSessionComplete < handleTemplateTriggerIfNeeded
      expect(summaryService.extractPrUrlIfNeeded.mock.invocationCallOrder[0]).toBeLessThan(
        summaryService.onSessionComplete.mock.invocationCallOrder[0]
      );
      expect(summaryService.onSessionComplete.mock.invocationCallOrder[0]).toBeLessThan(
        mockTemplateTrigger.mock.invocationCallOrder[0]
      );
    });

    it('handles missing handleTemplateTriggerIfNeeded gracefully', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Failed');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      // Do NOT pass handleTemplateTriggerIfNeeded
      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: error.message });
    });

    // ── Mid-turn scheduled continuation on error path ────────────────────

    it('preserves explicit schedule on error path instead of marking error', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some transient failure');
      const futureScheduledAt = Date.now() + 3600000;
      const session = {
        id: 'sess-1',
        autoRescheduleEnabled: false,
        scheduledAt: futureScheduledAt,
        pendingPrompt: 'Continue the analysis',
      };
      sessions.getById.mockReturnValue(session);
      sessions.update.mockImplementation((sessionId, updates) => {
        if (sessionId === 'sess-1') Object.assign(session, updates);
        return session;
      });

      const mockShouldReschedule = vi.fn();
      const mockScheduler = { rescheduleSession: vi.fn() };
      const mockTemplateTrigger = vi.fn();

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(result).toBe(true);
      expect(session.status).toBe('scheduled');
      // Error reschedule and normal error handling must NOT run
      expect(mockShouldReschedule).not.toHaveBeenCalled();
      expect(mockScheduler.rescheduleSession).not.toHaveBeenCalled();
      expect(sessions.update).not.toHaveBeenCalledWith('sess-1', expect.objectContaining({ status: 'error' }));
      expect(messages.create).not.toHaveBeenCalled();
      expect(broadcastToSession.mock.calls.some((c) => c[1] === WS_MESSAGE_TYPES.SESSION_ERROR)).toBe(false);
      expect(mockTemplateTrigger).not.toHaveBeenCalled();
    });

    it('still marks error on error path when session has no explicit schedule', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Unexpected failure');
      sessions.getById.mockReturnValue({
        autoRescheduleEnabled: false,
        scheduledAt: null,
        pendingPrompt: null,
      });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Unexpected failure' });
    });

    it('does not preserve schedule on error path when scheduledAt is 0', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some failure');
      sessions.getById.mockReturnValue({
        autoRescheduleEnabled: false,
        scheduledAt: 0,
        pendingPrompt: 'Some prompt',
      });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      // scheduledAt=0 is not a valid explicit schedule
      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Some failure' });
    });

    it('does not preserve schedule on error path when pendingPrompt is empty', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Some failure');
      sessions.getById.mockReturnValue({
        autoRescheduleEnabled: false,
        scheduledAt: Date.now() + 3600000,
        pendingPrompt: '',
      });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
      });

      expect(result).toBe(false);
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Some failure' });
    });

    it('catches and logs errors from handleTemplateTriggerIfNeeded without rethrowing', async () => {
      const controller = { signal: { aborted: false } };
      const error = new Error('Original error');
      sessions.getById.mockReturnValue({ autoRescheduleEnabled: false });

      const mockShouldReschedule = vi.fn().mockReturnValue(false);
      const mockScheduler = { rescheduleSession: vi.fn() };
      const mockTemplateTrigger = vi.fn().mockRejectedValue(new Error('template boom'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await handleSessionError('sess-1', error, {
        controller,
        shouldRescheduleOnError: mockShouldReschedule,
        schedulerService: mockScheduler,
        handleTemplateTriggerIfNeeded: mockTemplateTrigger,
      });

      expect(result).toBe(false);
      // sessions.update should have been called with the original error (before template trigger)
      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'Original error' });
      // console.error should have been called with the template error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[handleSessionError] Template trigger failed for session sess-1:'),
        expect.any(Error)
      );
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

    it('exports finalErrorSessionIds as a Set', () => {
      expect(finalErrorSessionIds).toBeInstanceOf(Set);
    });
  });

  // ── handleStreamEvent ─────────────────────────────────────────────────────

  describe('handleStreamEvent', () => {
    beforeEach(() => {
      // Add session to activeSessions so events are processed
      activeSessions.set('sess-1', { controller: { signal: { aborted: false } } });
    });

    it('calls sessions.touch when assistant event with text content is processed', async () => {
      const mockMessage = { id: 'msg-1', content: 'Response' };
      messages.create.mockReturnValue(mockMessage);
      conversations.getActiveBySessionId.mockReturnValue({ id: 'conv-1', name: 'Test Conv' });
      workLogs.associatePendingLogs.mockReturnValue(0);

      const assistantEvent = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello, this is assistant text' },
          ],
        },
      };

      await handleStreamEvent('sess-1', assistantEvent);

      expect(sessions.touch).toHaveBeenCalledWith('sess-1');
    });

    it('does not call sessions.touch when assistant event has no text content', async () => {
      const assistantEvent = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
          ],
        },
      };

      await handleStreamEvent('sess-1', assistantEvent);

      expect(sessions.touch).not.toHaveBeenCalled();
    });

    it('does not process events when session is not in activeSessions', async () => {
      activeSessions.delete('sess-1');

      const assistantEvent = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Should not be processed' },
          ],
        },
      };

      await handleStreamEvent('sess-1', assistantEvent);

      expect(messages.create).not.toHaveBeenCalled();
      expect(sessions.touch).not.toHaveBeenCalled();
    });

    it('renders system permission_denied events as safe, reconstructable work logs', async () => {
      await handleStreamEvent('sess-1', {
        type: 'system', subtype: 'permission_denied', tool_name: 'Bash',
        message: 'Denied `curl -H "Authorization: Bearer sk-live-token" https://example.test`',
        decision_reason: 'The command embeds a secret', decision_reason_type: 'rule', agent_id: 'worker-7',
      });

      const [, , content, metadata] = workLogs.create.mock.calls.at(-1);
      expect(content).toContain('Permission denied for Bash');
      expect(content).toContain('Reason type: rule');
      expect(content).toContain('Agent: worker-7');
      expect(content).not.toContain('sk-live-token');
      expect(content).not.toContain('curl');
      expect(content).not.toContain('embeds a secret');
      expect(metadata).toEqual({ messageId: null, toolName: 'Bash' });
    });

    it('creates and broadcasts visible assistant messages for final result errors', async () => {
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
      ]);

      await handleStreamEvent('sess-1', {
        type: 'result',
        subtype: 'error',
        error: 'usage limit reached',
      });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'usage limit reached' });
      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('Codex failed before completing this turn'),
        { conversationId: 'conv-1' }
      );
      expect(messages.create.mock.calls[0][2]).toContain('usage limit reached');

      const sessionMessageCallIndex = broadcastToSession.mock.calls.findIndex(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_MESSAGE
      );
      const sessionErrorCallIndex = broadcastToSession.mock.calls.findIndex(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_ERROR
      );
      expect(sessionMessageCallIndex).toBeGreaterThanOrEqual(0);
      expect(sessionErrorCallIndex).toBeGreaterThanOrEqual(0);
      expect(sessionMessageCallIndex).toBeLessThan(sessionErrorCallIndex);
      expect(finalErrorSessionIds.has('sess-1')).toBe(true);
    });

    it('uses an ensured conversation for final result errors when none is active', async () => {
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });
      conversations.ensureActiveConversation.mockReturnValue({ id: 'conv-created' });

      await handleStreamEvent('sess-1', {
        type: 'result',
        subtype: 'error',
        error: 'adapter failed',
      });

      expect(conversations.ensureActiveConversation).toHaveBeenCalledWith('sess-1');
      expect(messages.create).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        expect.stringContaining('adapter failed'),
        { conversationId: 'conv-created' }
      );
      expect(activeConversationIds.get('sess-1')).toBe('conv-created');
    });

    it('normalizes object-shaped final result errors', async () => {
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });
      activeConversationIds.set('sess-1', 'conv-1');

      await handleStreamEvent('sess-1', {
        type: 'result',
        subtype: 'error',
        error: { message: 'object shaped failure' },
      });

      expect(sessions.update).toHaveBeenCalledWith('sess-1', { status: 'error', error: 'object shaped failure' });
      expect(messages.create.mock.calls[0][2]).toContain('object shaped failure');
      expect(messages.create.mock.calls[0][2]).not.toContain('[object Object]');
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: 'object shaped failure' }
      );
    });

    it('does not duplicate final result error messages containing the raw error after the latest user', async () => {
      sessions.getById.mockReturnValue({ agentType: 'codex', projectId: 'proj-1' });
      activeConversationIds.set('sess-1', 'conv-1');
      messages.getByConversationId.mockReturnValue([
        { id: 'msg-user', sessionId: 'sess-1', conversationId: 'conv-1', role: 'user', content: 'continue' },
        { id: 'msg-assistant', sessionId: 'sess-1', conversationId: 'conv-1', role: 'assistant', content: 'Run failed: usage limit reached' },
      ]);

      await handleStreamEvent('sess-1', {
        type: 'result',
        subtype: 'error',
        error: 'usage limit reached',
      });

      expect(messages.create).not.toHaveBeenCalled();
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        WS_MESSAGE_TYPES.SESSION_ERROR,
        { sessionId: 'sess-1', error: 'usage limit reached' }
      );
    });
  });
});
