import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionPolling } from './useSessionPolling.js';

// Mock the api
vi.mock('./useApi.js', () => ({
  api: {
    getSessionChanges: vi.fn(),
  },
}));

// Mock the diff parser
vi.mock('../utils/diffParser.js', () => ({
  parseDiff: vi.fn((diff) => {
    if (!diff) return [];
    // Simple mock: return array with length based on diff content
    return diff.split('\n').filter(Boolean);
  }),
}));

import { api } from './useApi.js';

describe('useSessionPolling', () => {
  let sessionsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Mock sessions store
    sessionsStore = {
      fetchSession: vi.fn().mockResolvedValue({}),
      fetchMessages: vi.fn().mockResolvedValue([]),
      fetchWorkLogs: vi.fn().mockResolvedValue({}),
      activeConversationId: 'conv-1',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns expected initial state', () => {
      const { hasChanges, changesFileCount, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      expect(hasChanges.value).toBe(false);
      expect(changesFileCount.value).toBe(0);
      expect(pollIntervalId.value).toBe(null);
    });
  });

  describe('checkForChanges', () => {
    it('fetches changes and updates state', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'file1.js\nfile2.js',
        unstaged: 'file3.js',
        untracked: '',
      });

      const { hasChanges, changesFileCount, checkForChanges } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      await checkForChanges();

      expect(api.getSessionChanges).toHaveBeenCalledWith('sess-1');
      expect(hasChanges.value).toBe(true);
      expect(changesFileCount.value).toBe(3);
    });

    it('sets hasChanges to false when no changes', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const { hasChanges, changesFileCount, checkForChanges } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      await checkForChanges();

      expect(hasChanges.value).toBe(false);
      expect(changesFileCount.value).toBe(0);
    });

    it('handles errors gracefully', async () => {
      api.getSessionChanges.mockRejectedValue(new Error('Network error'));

      const { hasChanges, checkForChanges } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      await checkForChanges();

      // Should not throw, hasChanges remains false
      expect(hasChanges.value).toBe(false);
    });

    it('does nothing when session ID is null', async () => {
      const { checkForChanges } = useSessionPolling({
        getSessionId: () => null,
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      await checkForChanges();

      expect(api.getSessionChanges).not.toHaveBeenCalled();
    });
  });

  describe('startPolling', () => {
    it('starts interval when called', () => {
      const { startPolling, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'running',
        sessionsStore,
      });

      startPolling();

      expect(pollIntervalId.value).not.toBe(null);
    });

    it('does not start multiple intervals', () => {
      const { startPolling, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'running',
        sessionsStore,
      });

      startPolling();
      const firstIntervalId = pollIntervalId.value;

      startPolling();

      expect(pollIntervalId.value).toBe(firstIntervalId);
    });

    it('fetches data on each interval while running', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const { startPolling } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'running',
        sessionsStore,
        pollInterval: 1000,
      });

      startPolling();

      // Advance time to trigger interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(sessionsStore.fetchSession).toHaveBeenCalled();
      expect(sessionsStore.fetchMessages).toHaveBeenCalled();
      expect(sessionsStore.fetchWorkLogs).toHaveBeenCalled();
    });

    it('stops polling when status is not running/starting', async () => {
      let status = 'running';
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const { startPolling, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => status,
        sessionsStore,
        pollInterval: 1000,
      });

      startPolling();
      expect(pollIntervalId.value).not.toBe(null);

      // Change status and advance time
      status = 'completed';
      await vi.advanceTimersByTimeAsync(1000);

      expect(pollIntervalId.value).toBe(null);
    });
  });

  describe('stopPolling', () => {
    it('clears the interval', () => {
      const { startPolling, stopPolling, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'running',
        sessionsStore,
      });

      startPolling();
      expect(pollIntervalId.value).not.toBe(null);

      stopPolling();
      expect(pollIntervalId.value).toBe(null);
    });

    it('does nothing when not polling', () => {
      const { stopPolling, pollIntervalId } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      stopPolling();
      expect(pollIntervalId.value).toBe(null);
    });
  });

  describe('reset', () => {
    it('stops polling and clears state', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'file.js',
        unstaged: '',
        untracked: '',
      });

      const { startPolling, checkForChanges, reset, pollIntervalId, hasChanges, changesFileCount } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'running',
        sessionsStore,
      });

      startPolling();
      await checkForChanges();

      expect(pollIntervalId.value).not.toBe(null);
      expect(hasChanges.value).toBe(true);

      reset();

      expect(pollIntervalId.value).toBe(null);
      expect(hasChanges.value).toBe(false);
      expect(changesFileCount.value).toBe(0);
    });
  });

  describe('watchStatusForPolling', () => {
    it('returns a stop function', () => {
      const { watchStatusForPolling } = useSessionPolling({
        getSessionId: () => 'sess-1',
        getSessionStatus: () => 'waiting',
        sessionsStore,
      });

      const stop = watchStatusForPolling(() => 'waiting');

      expect(typeof stop).toBe('function');
      stop(); // Should not throw
    });
  });
});
