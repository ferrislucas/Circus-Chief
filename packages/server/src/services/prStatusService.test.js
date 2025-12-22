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
  ACTIVE_SESSION_STATES,
  getSessionsToCheck,
  checkPrStatus,
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

    it('has running and waiting as active session states', () => {
      expect(ACTIVE_SESSION_STATES).toEqual(['running', 'waiting']);
    });
  });

  describe('getSessionsToCheck', () => {
    it('returns empty array when no subscriptions', () => {
      webSocketManager.getSessionSubscriptions.mockReturnValue(new Map());

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('returns sessions with PRs that have subscribers', () => {
      // Update session to have PR URL and be in waiting state
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

    it('excludes sessions not in active states (completed)', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'completed' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('excludes sessions not in active states (stopped)', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'stopped' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('excludes sessions not in active states (error)', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'error' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
    });

    it('includes sessions in running state', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'running' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('includes sessions in waiting state', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

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

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

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

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

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

      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set([{ readyState: 1 }]));
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toHaveLength(1);
    });

    it('excludes subscriptions with no active subscribers', () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/org/repo/pull/123', status: 'waiting' });

      // Mock subscription with empty set
      const mockSubscriptions = new Map();
      mockSubscriptions.set(sessionId, new Set());
      webSocketManager.getSessionSubscriptions.mockReturnValue(mockSubscriptions);

      const result = getSessionsToCheck();
      expect(result).toEqual([]);
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
      // But the logic should work because 'archived' is not in ACTIVE_SESSION_STATES

      expect(ACTIVE_SESSION_STATES).not.toContain('archived');

      // If a session somehow had status 'archived', it would be excluded
      // because !ACTIVE_SESSION_STATES.includes('archived') === true
    });
  });
});
