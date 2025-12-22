import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, sessionSummaries } from '../database.js';

// Mock the websocket module
vi.mock('../websocket.js', () => ({
  webSocketManager: {
    getSessionSubscriptions: vi.fn(() => new Map()),
  },
  broadcastToSession: vi.fn(),
}));

// Mock ghService
vi.mock('./ghService.js', () => ({
  getPrInfo: vi.fn(),
}));

// Import after mock setup
import * as prStatusService from './prStatusService.js';
import { webSocketManager, broadcastToSession } from '../websocket.js';
import * as ghService from './ghService.js';
import {
  DEFAULT_POLL_INTERVAL_MS,
  FINAL_PR_STATES,
  POLLABLE_SESSION_STATES,
  RECENT_ACTIVITY_MS,
  MAX_POLL_AGE_MS,
  getSessionsToCheck,
  checkPrStatus,
  checkSessionCiStatusNow,
} from './prStatusService.js';

describe('prStatusService', () => {
  let projectId;
  let sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test project and session with PR URL
    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const session = sessions.create(projectId, 'Test Session', 'Initial prompt', 'standard');
    sessionId = session.id;
  });

  afterEach(() => {
    prStatusService.stop();
  });

  describe('constants', () => {
    it('has a 60 second default poll interval', () => {
      expect(DEFAULT_POLL_INTERVAL_MS).toBe(60000);
    });

    it('has merged and closed as final PR states', () => {
      expect(FINAL_PR_STATES).toEqual(['merged', 'closed']);
    });

    it('has running, waiting, completed, and stopped as pollable session states', () => {
      expect(POLLABLE_SESSION_STATES).toEqual(['running', 'waiting', 'completed', 'stopped']);
    });

    it('has 2 hour recent activity window', () => {
      expect(RECENT_ACTIVITY_MS).toBe(2 * 60 * 60 * 1000);
    });

    it('has 24 hour max poll age', () => {
      expect(MAX_POLL_AGE_MS).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('getSessionsToCheck', () => {
    it('returns empty array when no sessions have PR URLs', () => {
      // Session has no PR URL
      sessions.update(sessionId, { status: 'waiting' });
      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('returns recently active sessions with PRs (no subscribers needed)', () => {
      // Update session to have PR URL and be in waiting state
      // Session is recently updated so should be polled without subscribers
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // No subscribers
      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toEqual([{ sessionId, prUrl: 'https://github.com/org/repo/pull/123' }]);
    });

    it('returns sessions with PRs that have subscribers', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // Mock subscription with active subscriber
      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([{ sessionId, prUrl: 'https://github.com/org/repo/pull/123' }]);
    });

    it('excludes sessions without PR URLs', () => {
      // Session has no PR URL
      sessions.update(sessionId, { status: 'waiting' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('includes sessions in completed state (recently updated)', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'completed' });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('includes sessions in stopped state (recently updated)', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'stopped' });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('excludes sessions in error state', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'error' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('includes sessions in running state', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'running' });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('includes sessions in waiting state', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('excludes sessions with merged PRs', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // Create summary with merged PR
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'merged',
      });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('excludes sessions with closed PRs', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // Create summary with closed PR
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'closed',
      });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('includes sessions with open PRs', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // Create summary with open PR
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
      });

      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
    });

    it('always includes subscribed sessions regardless of age', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'completed' });

      // Mock subscription with active subscriber
      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });
  });

  describe('checkSessionCiStatusNow', () => {
    const prUrl = 'https://github.com/org/repo/pull/123';

    it('returns false when session has no PR URL', async () => {
      // Session has no PR URL
      sessions.update(sessionId, { status: 'waiting' });

      const result = await checkSessionCiStatusNow(sessionId);
      expect(result).toBe(false);
    });

    it('checks and updates CI status for session with PR URL', async () => {
      sessions.update(sessionId, { prUrl, status: 'completed' });

      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
      });

      const result = await checkSessionCiStatusNow(sessionId);
      expect(result).toBe(true);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.ciStatus).toBe('success');
    });

    it('returns false when session does not exist', async () => {
      const result = await checkSessionCiStatusNow('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('checkPrStatus', () => {
    const prUrl = 'https://github.com/org/repo/pull/123';

    beforeEach(() => {
      sessions.update(sessionId, { prUrl, status: 'waiting' });
    });

    it('returns false when ghService returns null', async () => {
      ghService.getPrInfo.mockResolvedValue(null);

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(false);
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('returns false when status unchanged', async () => {
      // Create existing summary
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
        prMerged: false,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
      });

      // Mock same status from GitHub
      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(false);
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('updates DB and broadcasts when PR state changes', async () => {
      // Create existing summary with open PR
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
        prMerged: false,
      });

      // Mock merged status from GitHub
      ghService.getPrInfo.mockResolvedValue({
        state: 'merged',
        merged: true,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(true);

      // Check DB was updated
      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.prState).toBe('merged');
      expect(summary.prMerged).toBe(true);

      // Check broadcast was called
      expect(broadcastToSession).toHaveBeenCalledWith(
        sessionId,
        'session:summary_updated',
        expect.objectContaining({
          sessionId,
          summary: expect.objectContaining({
            prState: 'merged',
          }),
        })
      );
    });

    it('updates when CI status changes', async () => {
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
        ciStatus: 'pending',
      });

      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(true);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.ciStatus).toBe('success');
    });

    it('updates when merge conflicts appear', async () => {
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
        hasMergeConflicts: false,
      });

      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: true,
        ciStatus: 'success',
        ciFailures: [],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(true);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.hasMergeConflicts).toBe(true);
    });

    it('updates when CI failures change', async () => {
      sessionSummaries.upsert(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test summary',
        prState: 'open',
        ciStatus: 'failure',
        ciFailures: ['test-1'],
      });

      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'failure',
        ciFailures: ['test-1', 'test-2'],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(true);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.ciFailures).toEqual(['test-1', 'test-2']);
    });

    it('handles errors gracefully', async () => {
      ghService.getPrInfo.mockRejectedValue(new Error('API error'));

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(false);
      expect(broadcastToSession).not.toHaveBeenCalled();
    });

    it('creates summary if none exists and status changes', async () => {
      // No existing summary
      ghService.getPrInfo.mockResolvedValue({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'pending',
        ciFailures: [],
      });

      const result = await checkPrStatus(sessionId, prUrl);
      expect(result).toBe(true);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary.prState).toBe('open');
    });
  });

  describe('polling lifecycle', () => {
    it('start() begins polling', () => {
      vi.useFakeTimers();

      prStatusService.start();

      // Verify interval is set (by advancing time and checking if pollLoop would be called)
      expect(() => vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS)).not.toThrow();

      vi.useRealTimers();
    });

    it('stop() clears interval', () => {
      vi.useFakeTimers();

      prStatusService.start();
      prStatusService.stop();

      // Should not throw or cause issues when advancing time
      expect(() => vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS * 5)).not.toThrow();

      vi.useRealTimers();
    });

    it('start() is idempotent', () => {
      prStatusService.start();
      prStatusService.start(); // Should not throw or create multiple intervals
      prStatusService.stop();
    });
  });

  describe('future-proofing for archived state', () => {
    it('would exclude archived sessions (if state existed)', () => {
      // This test documents the intended behavior when 'archived' is added
      // Currently we can't actually set status to 'archived' due to CHECK constraint
      // But the logic should work because 'archived' is not in POLLABLE_SESSION_STATES

      expect(POLLABLE_SESSION_STATES).not.toContain('archived');

      // If a session somehow had status 'archived', it would be excluded
      // because !POLLABLE_SESSION_STATES.includes('archived') === true
    });
  });
});
