import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from './sessions.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getActiveSessions: vi.fn(),
    getProjectSessions: vi.fn(),
    getSession: vi.fn(),
    getSessionMessages: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    stopSession: vi.fn(),
    restartSession: vi.fn(),
    deleteSession: vi.fn(),
    getSessionWorkLogs: vi.fn(),
    updateSession: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('Sessions Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('updateSessionMode', () => {
    it('updates mode in currentSession with new object reference for reactivity', async () => {
      const store = useSessionsStore();

      // Set up initial session
      const initialSession = {
        id: 'session-1',
        name: 'Test Session',
        mode: 'standard',
        status: 'waiting',
      };
      store.currentSession = initialSession;
      store.sessions = [{ ...initialSession }];

      // Mock the API response
      api.updateSession.mockResolvedValue({ ...initialSession, mode: 'yolo' });

      // Get original reference
      const originalRef = store.currentSession;

      // Update mode
      await store.updateSessionMode('session-1', 'yolo');

      // Verify mode was updated
      expect(store.currentSession.mode).toBe('yolo');

      // Verify new object reference was created (important for Vue reactivity)
      expect(store.currentSession).not.toBe(originalRef);

      // Verify other properties are preserved
      expect(store.currentSession.id).toBe('session-1');
      expect(store.currentSession.name).toBe('Test Session');
      expect(store.currentSession.status).toBe('waiting');
    });

    it('updates mode in sessions list', async () => {
      const store = useSessionsStore();

      // Set up initial sessions
      store.sessions = [
        { id: 'session-1', mode: 'standard' },
        { id: 'session-2', mode: 'plan' },
      ];

      // Mock the API response
      api.updateSession.mockResolvedValue({ id: 'session-1', mode: 'yolo' });

      // Update mode for session-1
      await store.updateSessionMode('session-1', 'yolo');

      // Verify correct session was updated
      expect(store.sessions[0].mode).toBe('yolo');
      expect(store.sessions[1].mode).toBe('plan');
    });

    it('does not update currentSession if IDs do not match', async () => {
      const store = useSessionsStore();

      // Set up initial session
      store.currentSession = { id: 'session-1', mode: 'standard' };
      store.sessions = [{ id: 'session-2', mode: 'plan' }];

      // Mock the API response
      api.updateSession.mockResolvedValue({ id: 'session-2', mode: 'yolo' });

      // Update mode for different session
      await store.updateSessionMode('session-2', 'yolo');

      // currentSession should be unchanged
      expect(store.currentSession.mode).toBe('standard');
    });

    it('throws error and sets store error on API failure', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', mode: 'standard' };

      // Mock API error
      api.updateSession.mockRejectedValue(new Error('API Error'));

      // Should throw
      await expect(store.updateSessionMode('session-1', 'yolo')).rejects.toThrow('API Error');

      // Store error should be set
      expect(store.error).toBe('API Error');

      // Mode should not have changed
      expect(store.currentSession.mode).toBe('standard');
    });
  });

  describe('updateSessionThinking', () => {
    it('updates thinkingEnabled in currentSession', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', thinkingEnabled: false };
      store.sessions = [{ id: 'session-1', thinkingEnabled: false }];

      api.updateSession.mockResolvedValue({ id: 'session-1', thinkingEnabled: true });

      await store.updateSessionThinking('session-1', true);

      expect(store.currentSession.thinkingEnabled).toBe(true);
      expect(store.sessions[0].thinkingEnabled).toBe(true);
    });
  });

  describe('updateSessionModel', () => {
    it('updates model in currentSession', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', model: 'claude-sonnet-4-5-20250929' };
      store.sessions = [{ id: 'session-1', model: 'claude-sonnet-4-5-20250929' }];

      api.updateSession.mockResolvedValue({ id: 'session-1', model: 'claude-opus-4-5-20251101' });

      await store.updateSessionModel('session-1', 'claude-opus-4-5-20251101');

      expect(store.currentSession.model).toBe('claude-opus-4-5-20251101');
      expect(store.sessions[0].model).toBe('claude-opus-4-5-20251101');
    });

    it('updates model in sessions list when currentSession is different', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-2', model: 'claude-haiku-4-5-20251001' };
      store.sessions = [
        { id: 'session-1', model: 'claude-sonnet-4-5-20250929' },
        { id: 'session-2', model: 'claude-haiku-4-5-20251001' },
      ];

      api.updateSession.mockResolvedValue({ id: 'session-1', model: 'claude-opus-4-5-20251101' });

      await store.updateSessionModel('session-1', 'claude-opus-4-5-20251101');

      // Session 1 should be updated
      expect(store.sessions[0].model).toBe('claude-opus-4-5-20251101');
      // Session 2 (currentSession) should be unchanged
      expect(store.currentSession.model).toBe('claude-haiku-4-5-20251001');
    });

    it('throws error and sets store error on API failure', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', model: 'claude-sonnet-4-5-20250929' };

      api.updateSession.mockRejectedValue(new Error('API Error'));

      await expect(store.updateSessionModel('session-1', 'claude-opus-4-5-20251101')).rejects.toThrow('API Error');

      expect(store.error).toBe('API Error');
      expect(store.currentSession.model).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('updateSessionStatus', () => {
    it('updates status in both sessions list and currentSession', () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', status: 'running' };
      store.sessions = [{ id: 'session-1', status: 'running' }];

      store.updateSessionStatus('session-1', 'completed');

      expect(store.currentSession.status).toBe('completed');
      expect(store.sessions[0].status).toBe('completed');
    });
  });

  describe('work logs', () => {
    it('adds work log with proper reactivity', () => {
      const store = useSessionsStore();

      const log1 = { id: 'log-1', messageId: 'msg-1', content: 'test' };
      store.addWorkLog(log1);

      expect(store.workLogs['msg-1']).toEqual([log1]);

      // Adding second log should create new array reference
      const log2 = { id: 'log-2', messageId: 'msg-1', content: 'test2' };
      store.addWorkLog(log2);

      expect(store.workLogs['msg-1']).toEqual([log1, log2]);
    });

    it('adds unassociated work log when messageId is missing', () => {
      const store = useSessionsStore();

      const log = { id: 'log-1', content: 'test' };
      store.addWorkLog(log);

      expect(store.workLogs['_unassociated']).toEqual([log]);
    });

    it('associates work logs with message ID', () => {
      const store = useSessionsStore();

      // Add unassociated logs
      const log1 = { id: 'log-1', content: 'test1' };
      const log2 = { id: 'log-2', content: 'test2' };
      store.addWorkLog(log1);
      store.addWorkLog(log2);

      expect(store.workLogs['_unassociated']).toHaveLength(2);

      // Associate with message
      store.associateWorkLogs('msg-1');

      expect(store.workLogs['_unassociated']).toEqual([]);
      expect(store.workLogs['msg-1']).toEqual([log1, log2]);
    });

    describe('fetchWorkLogs merge behavior', () => {
      it('merges fetched work logs with existing unassociated logs', async () => {
        const store = useSessionsStore();

        // Simulate logs that arrived via WebSocket (before fetch)
        const wsLog = { id: 'ws-log-1', content: 'arrived via websocket' };
        store.addWorkLog(wsLog);

        expect(store.workLogs['_unassociated']).toEqual([wsLog]);

        // Mock API returning different logs (already associated in DB)
        const fetchedLog = { id: 'db-log-1', content: 'from database' };
        api.getSessionWorkLogs.mockResolvedValue({
          'msg-1': [fetchedLog],
          '_unassociated': [],
        });

        await store.fetchWorkLogs('session-1');

        // WebSocket log should be preserved since it's not in fetched data
        expect(store.workLogs['_unassociated']).toEqual([wsLog]);
        // Fetched associated logs should be present
        expect(store.workLogs['msg-1']).toEqual([fetchedLog]);
      });

      it('removes unassociated logs that are now associated in fetched data', async () => {
        const store = useSessionsStore();

        // Simulate log that arrived via WebSocket as unassociated
        const log = { id: 'log-1', content: 'test log' };
        store.addWorkLog(log);

        expect(store.workLogs['_unassociated']).toEqual([log]);

        // Mock API returning the same log but now associated with a message
        api.getSessionWorkLogs.mockResolvedValue({
          'msg-1': [log],
          '_unassociated': [],
        });

        await store.fetchWorkLogs('session-1');

        // Log should be removed from _unassociated since it's in fetched data
        expect(store.workLogs['_unassociated']).toEqual([]);
        // Log should be under the message ID
        expect(store.workLogs['msg-1']).toEqual([log]);
      });

      it('preserves new WebSocket logs that arrived during fetch', async () => {
        const store = useSessionsStore();

        // Simulate logs in the store (some old, one new)
        const oldLog = { id: 'old-log', content: 'old log' };
        const newLog = { id: 'new-log', content: 'arrived during fetch' };
        store.workLogs = { '_unassociated': [oldLog, newLog] };

        // Mock API returning the old log as associated (but not the new one)
        api.getSessionWorkLogs.mockResolvedValue({
          'msg-1': [oldLog],
          '_unassociated': [],
        });

        await store.fetchWorkLogs('session-1');

        // New log should be preserved in _unassociated
        expect(store.workLogs['_unassociated']).toEqual([newLog]);
        // Old log should be under the message ID
        expect(store.workLogs['msg-1']).toEqual([oldLog]);
      });

      it('combines fetched unassociated with new WebSocket unassociated', async () => {
        const store = useSessionsStore();

        // Simulate WebSocket log
        const wsLog = { id: 'ws-log', content: 'from websocket' };
        store.addWorkLog(wsLog);

        // Mock API returning some unassociated logs from DB
        const dbLog = { id: 'db-log', content: 'from database' };
        api.getSessionWorkLogs.mockResolvedValue({
          '_unassociated': [dbLog],
        });

        await store.fetchWorkLogs('session-1');

        // Both logs should be in _unassociated
        expect(store.workLogs['_unassociated']).toHaveLength(2);
        expect(store.workLogs['_unassociated']).toContainEqual(dbLog);
        expect(store.workLogs['_unassociated']).toContainEqual(wsLog);
      });
    });
  });
});
