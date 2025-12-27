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
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    // Conversation API methods
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    generateConversationSummary: vi.fn(),
    getConversationMessages: vi.fn(),
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

      store.updateSessionStatus('session-1', 'stopped');

      expect(store.currentSession.status).toBe('stopped');
      expect(store.sessions[0].status).toBe('stopped');
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

  describe('updateNextTemplate', () => {
    it('updates nextTemplateId in currentSession with new object reference for reactivity', async () => {
      const store = useSessionsStore();

      // Set up initial session
      const initialSession = {
        id: 'session-1',
        name: 'Test Session',
        nextTemplateId: null,
      };
      store.currentSession = initialSession;
      store.sessions = [{ ...initialSession }];

      // Mock the API response
      api.updateSession.mockResolvedValue({ ...initialSession, nextTemplateId: 'template-1' });

      // Get original reference
      const originalRef = store.currentSession;

      // Update nextTemplateId
      await store.updateNextTemplate('session-1', 'template-1');

      // Verify nextTemplateId was updated
      expect(store.currentSession.nextTemplateId).toBe('template-1');

      // Verify new object reference was created (important for Vue reactivity)
      expect(store.currentSession).not.toBe(originalRef);

      // Verify other properties are preserved
      expect(store.currentSession.id).toBe('session-1');
      expect(store.currentSession.name).toBe('Test Session');
    });

    it('updates nextTemplateId in sessions list', async () => {
      const store = useSessionsStore();

      // Set up initial sessions
      store.sessions = [
        { id: 'session-1', nextTemplateId: null },
        { id: 'session-2', nextTemplateId: 'template-a' },
      ];

      // Mock the API response
      api.updateSession.mockResolvedValue({ id: 'session-1', nextTemplateId: 'template-b' });

      // Update nextTemplateId for session-1
      await store.updateNextTemplate('session-1', 'template-b');

      // Verify correct session was updated
      expect(store.sessions[0].nextTemplateId).toBe('template-b');
      expect(store.sessions[1].nextTemplateId).toBe('template-a');
    });

    it('can clear nextTemplateId by setting to null', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', nextTemplateId: 'template-1' };
      store.sessions = [{ id: 'session-1', nextTemplateId: 'template-1' }];

      api.updateSession.mockResolvedValue({ id: 'session-1', nextTemplateId: null });

      await store.updateNextTemplate('session-1', null);

      expect(store.currentSession.nextTemplateId).toBeNull();
      expect(store.sessions[0].nextTemplateId).toBeNull();
    });

    it('does not update currentSession if IDs do not match', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', nextTemplateId: null };
      store.sessions = [{ id: 'session-2', nextTemplateId: null }];

      api.updateSession.mockResolvedValue({ id: 'session-2', nextTemplateId: 'template-1' });

      await store.updateNextTemplate('session-2', 'template-1');

      // currentSession should be unchanged
      expect(store.currentSession.nextTemplateId).toBeNull();
    });

    it('throws error and sets store error on API failure', async () => {
      const store = useSessionsStore();

      store.currentSession = { id: 'session-1', nextTemplateId: null };

      api.updateSession.mockRejectedValue(new Error('API Error'));

      await expect(store.updateNextTemplate('session-1', 'template-1')).rejects.toThrow('API Error');

      expect(store.error).toBe('API Error');
      expect(store.currentSession.nextTemplateId).toBeNull();
    });

    it('calls api.updateSession with correct parameters', async () => {
      const store = useSessionsStore();

      store.sessions = [{ id: 'session-1', nextTemplateId: null }];

      api.updateSession.mockResolvedValue({ id: 'session-1', nextTemplateId: 'template-1' });

      await store.updateNextTemplate('session-1', 'template-1');

      expect(api.updateSession).toHaveBeenCalledWith('session-1', { nextTemplateId: 'template-1' });
    });
  });

  describe('conversations', () => {
    describe('fetchConversations', () => {
      it('fetches conversations and sets active', async () => {
        const store = useSessionsStore();

        const mockConversations = [
          { id: 'conv-1', name: 'First', isActive: false, messageCount: 5 },
          { id: 'conv-2', name: 'Second', isActive: true, messageCount: 10 },
        ];
        api.getConversations.mockResolvedValue(mockConversations);

        await store.fetchConversations('session-1');

        expect(store.conversations).toEqual(mockConversations);
        expect(store.activeConversationId).toBe('conv-2');
      });

      it('sets first conversation as active if none marked', async () => {
        const store = useSessionsStore();

        const mockConversations = [
          { id: 'conv-1', name: 'First', isActive: false },
          { id: 'conv-2', name: 'Second', isActive: false },
        ];
        api.getConversations.mockResolvedValue(mockConversations);

        await store.fetchConversations('session-1');

        expect(store.activeConversationId).toBe('conv-1');
      });

      it('handles empty conversations list', async () => {
        const store = useSessionsStore();

        api.getConversations.mockResolvedValue([]);

        await store.fetchConversations('session-1');

        expect(store.conversations).toEqual([]);
        expect(store.activeConversationId).toBeNull();
      });

      it('handles fetch error gracefully', async () => {
        const store = useSessionsStore();

        api.getConversations.mockRejectedValue(new Error('Network error'));

        await store.fetchConversations('session-1');

        expect(store.conversations).toEqual([]);
        expect(store.activeConversationId).toBeNull();
        expect(store.error).toBe('Network error');
      });
    });

    describe('createConversation', () => {
      it('creates conversation and sets it as active', async () => {
        const store = useSessionsStore();
        store.conversations = [{ id: 'conv-1', name: 'First', isActive: true }];

        const newConv = { id: 'conv-2', name: 'New Conv', isActive: true };
        api.createConversation.mockResolvedValue(newConv);

        const result = await store.createConversation('session-1', 'New Conv');

        expect(result.id).toBe('conv-2');
        expect(store.conversations).toHaveLength(2);
        expect(store.activeConversationId).toBe('conv-2');
        // Previous conversation should be marked inactive
        expect(store.conversations.find((c) => c.id === 'conv-1').isActive).toBe(false);
      });

      it('clears messages when creating new conversation', async () => {
        const store = useSessionsStore();
        store.messages = [{ id: 'msg-1', content: 'Old message' }];

        api.createConversation.mockResolvedValue({ id: 'conv-new', name: null, isActive: true });

        await store.createConversation('session-1');

        expect(store.messages).toEqual([]);
      });

      it('handles creation error', async () => {
        const store = useSessionsStore();
        store.conversations = [{ id: 'conv-1', isActive: true }];

        api.createConversation.mockRejectedValue(new Error('Failed to create'));

        await expect(store.createConversation('session-1')).rejects.toThrow('Failed to create');
        expect(store.error).toBe('Failed to create');
      });
    });

    describe('switchConversation', () => {
      it('switches to different conversation', async () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', isActive: true },
          { id: 'conv-2', isActive: false },
        ];
        store.activeConversationId = 'conv-1';

        api.updateConversation.mockResolvedValue({ id: 'conv-2', isActive: true });
        api.getConversationMessages.mockResolvedValue([{ id: 'msg-1', content: 'Hello' }]);
        api.getSessionWorkLogs.mockResolvedValue({ 'msg-1': [] });

        await store.switchConversation('session-1', 'conv-2');

        expect(store.activeConversationId).toBe('conv-2');
        expect(store.conversations.find((c) => c.id === 'conv-2').isActive).toBe(true);
        expect(store.conversations.find((c) => c.id === 'conv-1').isActive).toBe(false);
        expect(store.messages).toEqual([{ id: 'msg-1', content: 'Hello' }]);
      });

      it('clears work logs and re-fetches them when switching conversations', async () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', isActive: true },
          { id: 'conv-2', isActive: false },
        ];
        store.activeConversationId = 'conv-1';
        store.workLogs = { 'msg-old': [{ id: 'old-log' }] };
        store.partialThinking = 'some thinking';

        api.updateConversation.mockResolvedValue({ id: 'conv-2', isActive: true });
        api.getConversationMessages.mockResolvedValue([{ id: 'msg-1', content: 'Hello' }]);
        api.getSessionWorkLogs.mockResolvedValue({
          'msg-1': [{ id: 'new-log', content: 'New work log' }],
        });

        await store.switchConversation('session-1', 'conv-2');

        // Work logs should have been re-fetched
        expect(api.getSessionWorkLogs).toHaveBeenCalledWith('session-1');
        // New work logs should be present
        expect(store.workLogs['msg-1']).toEqual([{ id: 'new-log', content: 'New work log' }]);
        // Old work logs should be gone
        expect(store.workLogs['msg-old']).toBeUndefined();
        // Partial thinking should be cleared
        expect(store.partialThinking).toBeNull();
      });

      it('does nothing if switching to same conversation', async () => {
        const store = useSessionsStore();
        store.activeConversationId = 'conv-1';

        await store.switchConversation('session-1', 'conv-1');

        expect(api.updateConversation).not.toHaveBeenCalled();
      });

      it('handles switch error', async () => {
        const store = useSessionsStore();
        store.conversations = [{ id: 'conv-1', isActive: true }];
        store.activeConversationId = 'conv-1';

        api.updateConversation.mockRejectedValue(new Error('Switch failed'));

        await expect(store.switchConversation('session-1', 'conv-2')).rejects.toThrow('Switch failed');
        expect(store.error).toBe('Switch failed');
      });
    });

    describe('deleteConversation', () => {
      it('deletes conversation and fetches updated list', async () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', isActive: true },
          { id: 'conv-2', isActive: false },
        ];
        store.activeConversationId = 'conv-1';

        api.deleteConversation.mockResolvedValue();
        api.getConversations.mockResolvedValue([{ id: 'conv-2', isActive: true }]);
        api.getConversationMessages.mockResolvedValue([]);

        await store.deleteConversation('session-1', 'conv-1');

        expect(api.deleteConversation).toHaveBeenCalledWith('session-1', 'conv-1');
        // After deletion of active, should fetch new list
        expect(api.getConversations).toHaveBeenCalled();
      });

      it('does not refetch if deleted non-active conversation', async () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', isActive: true },
          { id: 'conv-2', isActive: false },
        ];
        store.activeConversationId = 'conv-1';

        api.deleteConversation.mockResolvedValue();

        await store.deleteConversation('session-1', 'conv-2');

        expect(store.conversations).toHaveLength(1);
        expect(store.conversations[0].id).toBe('conv-1');
        expect(api.getConversations).not.toHaveBeenCalled();
      });
    });

    describe('activeConversation getter', () => {
      it('returns active conversation', () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', name: 'First' },
          { id: 'conv-2', name: 'Second' },
        ];
        store.activeConversationId = 'conv-2';

        expect(store.activeConversation).toEqual({ id: 'conv-2', name: 'Second' });
      });

      it('returns null if no active conversation', () => {
        const store = useSessionsStore();
        store.conversations = [];
        store.activeConversationId = null;

        expect(store.activeConversation).toBeNull();
      });
    });

    describe('clearConversations', () => {
      it('clears all conversation state', () => {
        const store = useSessionsStore();
        store.conversations = [{ id: 'conv-1' }];
        store.activeConversationId = 'conv-1';

        store.clearConversations();

        expect(store.conversations).toEqual([]);
        expect(store.activeConversationId).toBeNull();
      });
    });

    describe('addConversation', () => {
      it('adds conversation to list', () => {
        const store = useSessionsStore();
        store.conversations = [{ id: 'conv-1' }];

        store.addConversation({ id: 'conv-2', name: 'New' });

        expect(store.conversations).toHaveLength(2);
        expect(store.conversations[1].id).toBe('conv-2');
      });
    });

    describe('updateConversation', () => {
      it('updates conversation in list', () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1', name: 'Original', isActive: true },
          { id: 'conv-2', name: 'Second', isActive: false },
        ];

        store.updateConversation({ id: 'conv-1', name: 'Updated', isActive: true });

        expect(store.conversations.find((c) => c.id === 'conv-1').name).toBe('Updated');
        expect(store.conversations.find((c) => c.id === 'conv-2').name).toBe('Second');
      });
    });

    describe('removeConversation', () => {
      it('removes conversation from list', () => {
        const store = useSessionsStore();
        store.conversations = [
          { id: 'conv-1' },
          { id: 'conv-2' },
        ];

        store.removeConversation('conv-1');

        expect(store.conversations).toHaveLength(1);
        expect(store.conversations[0].id).toBe('conv-2');
      });
    });
  });

  describe('token usage', () => {
    describe('totalTokens getter', () => {
      it('returns 0 when no current session', () => {
        const store = useSessionsStore();
        store.currentSession = null;

        expect(store.totalTokens).toBe(0);
      });

      it('returns sum of input and output tokens', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 1000,
          outputTokens: 500,
        };

        expect(store.totalTokens).toBe(1500);
      });

      it('handles missing token values', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          // no token values set
        };

        expect(store.totalTokens).toBe(0);
      });
    });

    describe('formattedTokens getter', () => {
      it('returns zeros when no current session', () => {
        const store = useSessionsStore();
        store.currentSession = null;

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('0');
        expect(formatted.output).toBe('0');
        expect(formatted.total).toBe('0');
      });

      it('formats small numbers as-is', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 500,
          outputTokens: 250,
          cacheReadInputTokens: 100,
          cacheCreationInputTokens: 50,
        };

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('500');
        expect(formatted.output).toBe('250');
        expect(formatted.total).toBe('750');
        expect(formatted.cacheRead).toBe('100');
        expect(formatted.cacheCreation).toBe('50');
      });

      it('formats thousands with K suffix', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 5500,
          outputTokens: 2500,
        };

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('5.5K');
        expect(formatted.output).toBe('2.5K');
        expect(formatted.total).toBe('8.0K');
      });

      it('formats millions with M suffix', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 1500000,
          outputTokens: 500000,
        };

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('1.5M');
        expect(formatted.output).toBe('500.0K'); // 500K is below 1M threshold
        expect(formatted.total).toBe('2.0M');
      });

      it('handles exactly 1000 tokens', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 1000,
          outputTokens: 0,
        };

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('1.0K');
      });

      it('handles exactly 1000000 tokens', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          inputTokens: 1000000,
          outputTokens: 0,
        };

        const formatted = store.formattedTokens;
        expect(formatted.input).toBe('1.0M');
      });
    });

    describe('isUsageUpdating getter', () => {
      it('returns false when runningUsage is null', () => {
        const store = useSessionsStore();
        store.runningUsage = null;

        expect(store.isUsageUpdating).toBe(false);
      });

      it('returns true when runningUsage has value', () => {
        const store = useSessionsStore();
        store.runningUsage = { inputTokens: 100, outputTokens: 50 };

        expect(store.isUsageUpdating).toBe(true);
      });
    });

    describe('updateRunningUsage action', () => {
      it('sets runningUsage value', () => {
        const store = useSessionsStore();
        const usage = { inputTokens: 100, outputTokens: 50 };

        store.updateRunningUsage(usage);

        expect(store.runningUsage).toEqual(usage);
      });

      it('can update runningUsage multiple times', () => {
        const store = useSessionsStore();

        store.updateRunningUsage({ inputTokens: 100, outputTokens: 50 });
        expect(store.runningUsage.inputTokens).toBe(100);

        store.updateRunningUsage({ inputTokens: 200, outputTokens: 100 });
        expect(store.runningUsage.inputTokens).toBe(200);
      });
    });

    describe('finalizeUsage action', () => {
      it('updates currentSession with usage values', () => {
        const store = useSessionsStore();
        store.currentSession = {
          id: 'session-1',
          name: 'Test',
          inputTokens: 0,
          outputTokens: 0,
        };

        const usage = {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          webSearchRequests: 2,
          contextWindow: 200000,
        };

        store.finalizeUsage(usage);

        expect(store.currentSession.inputTokens).toBe(1000);
        expect(store.currentSession.outputTokens).toBe(500);
        expect(store.currentSession.cacheReadInputTokens).toBe(200);
        expect(store.currentSession.cacheCreationInputTokens).toBe(100);
        expect(store.currentSession.webSearchRequests).toBe(2);
        expect(store.currentSession.contextWindow).toBe(200000);
      });

      it('clears runningUsage', () => {
        const store = useSessionsStore();
        store.currentSession = { id: 'session-1' };
        store.runningUsage = { inputTokens: 100 };

        store.finalizeUsage({ inputTokens: 1000, outputTokens: 500 });

        expect(store.runningUsage).toBeNull();
      });

      it('creates new object reference for reactivity', () => {
        const store = useSessionsStore();
        const originalSession = { id: 'session-1', name: 'Test' };
        store.currentSession = originalSession;

        store.finalizeUsage({ inputTokens: 1000, outputTokens: 500 });

        expect(store.currentSession).not.toBe(originalSession);
        expect(store.currentSession.id).toBe('session-1');
        expect(store.currentSession.name).toBe('Test');
      });

      it('does nothing when currentSession is null', () => {
        const store = useSessionsStore();
        store.currentSession = null;
        store.runningUsage = { inputTokens: 100 };

        store.finalizeUsage({ inputTokens: 1000, outputTokens: 500 });

        expect(store.currentSession).toBeNull();
        expect(store.runningUsage).toBeNull();
      });
    });

    describe('clearRunningUsage action', () => {
      it('clears runningUsage to null', () => {
        const store = useSessionsStore();
        store.runningUsage = { inputTokens: 100, outputTokens: 50 };

        store.clearRunningUsage();

        expect(store.runningUsage).toBeNull();
      });

      it('is idempotent', () => {
        const store = useSessionsStore();
        store.runningUsage = null;

        store.clearRunningUsage();

        expect(store.runningUsage).toBeNull();
      });
    });
  });

  describe('session archiving', () => {
    describe('archiveSession', () => {
      it('archives a session and moves it to archivedSessions', async () => {
        const store = useSessionsStore();

        store.sessions = [
          { id: 'session-1', status: 'completed', archived: false },
          { id: 'session-2', status: 'running', archived: false },
        ];
        store.archivedSessions = [];

        api.archiveSession.mockResolvedValue({ id: 'session-1', status: 'completed', archived: true });

        await store.archiveSession('session-1');

        // Session should be removed from sessions
        expect(store.sessions.find((s) => s.id === 'session-1')).toBeUndefined();
        // Session should be added to archivedSessions
        expect(store.archivedSessions).toHaveLength(1);
        expect(store.archivedSessions[0].id).toBe('session-1');
        expect(store.archivedSessions[0].archived).toBe(true);
      });

      it('removes session from activeSessions when archiving', async () => {
        const store = useSessionsStore();

        store.activeSessions = [{ id: 'session-1', status: 'waiting', archived: false }];

        api.archiveSession.mockResolvedValue({ id: 'session-1', status: 'waiting', archived: true });

        await store.archiveSession('session-1');

        expect(store.activeSessions).toHaveLength(0);
      });

      it('updates currentSession archived flag when archiving current session', async () => {
        const store = useSessionsStore();

        store.currentSession = { id: 'session-1', status: 'completed', archived: false };
        store.sessions = [];

        api.archiveSession.mockResolvedValue({ id: 'session-1', status: 'completed', archived: true });

        await store.archiveSession('session-1');

        expect(store.currentSession.archived).toBe(true);
      });

      it('throws error and sets store error on API failure', async () => {
        const store = useSessionsStore();

        store.sessions = [{ id: 'session-1', archived: false }];

        api.archiveSession.mockRejectedValue(new Error('Archive failed'));

        await expect(store.archiveSession('session-1')).rejects.toThrow('Archive failed');
        expect(store.error).toBe('Archive failed');
      });
    });

    describe('unarchiveSession', () => {
      it('unarchives a session and moves it to sessions', async () => {
        const store = useSessionsStore();

        store.sessions = [];
        store.archivedSessions = [
          { id: 'session-1', status: 'completed', archived: true },
        ];

        api.unarchiveSession.mockResolvedValue({ id: 'session-1', status: 'completed', archived: false });

        await store.unarchiveSession('session-1');

        // Session should be removed from archivedSessions
        expect(store.archivedSessions).toHaveLength(0);
        // Session should be added to sessions
        expect(store.sessions).toHaveLength(1);
        expect(store.sessions[0].id).toBe('session-1');
        expect(store.sessions[0].archived).toBe(false);
      });

      it('updates currentSession archived flag when unarchiving current session', async () => {
        const store = useSessionsStore();

        store.currentSession = { id: 'session-1', status: 'completed', archived: true };
        store.archivedSessions = [];

        api.unarchiveSession.mockResolvedValue({ id: 'session-1', status: 'completed', archived: false });

        await store.unarchiveSession('session-1');

        expect(store.currentSession.archived).toBe(false);
      });

      it('throws error and sets store error on API failure', async () => {
        const store = useSessionsStore();

        store.archivedSessions = [{ id: 'session-1', archived: true }];

        api.unarchiveSession.mockRejectedValue(new Error('Unarchive failed'));

        await expect(store.unarchiveSession('session-1')).rejects.toThrow('Unarchive failed');
        expect(store.error).toBe('Unarchive failed');
      });
    });

    describe('fetchArchivedSessions', () => {
      it('fetches archived sessions for a project', async () => {
        const store = useSessionsStore();

        const mockSessions = [
          { id: 'session-1', archived: true },
          { id: 'session-2', archived: true },
        ];
        api.getProjectSessions.mockResolvedValue(mockSessions);

        await store.fetchArchivedSessions('project-1');

        expect(api.getProjectSessions).toHaveBeenCalledWith('project-1', true);
        expect(store.archivedSessions).toEqual(mockSessions);
      });

      it('handles fetch error', async () => {
        const store = useSessionsStore();

        api.getProjectSessions.mockRejectedValue(new Error('Fetch failed'));

        await store.fetchArchivedSessions('project-1');

        expect(store.error).toBe('Fetch failed');
      });
    });

    describe('updateSession with archive changes', () => {
      it('moves session to archivedSessions when archived is set to true', () => {
        const store = useSessionsStore();

        store.sessions = [{ id: 'session-1', archived: false }];
        store.archivedSessions = [];

        store.updateSession({ id: 'session-1', archived: true });

        expect(store.sessions).toHaveLength(0);
        expect(store.archivedSessions).toHaveLength(1);
        expect(store.archivedSessions[0].id).toBe('session-1');
      });

      it('moves session to sessions when archived is set to false', () => {
        const store = useSessionsStore();

        store.sessions = [];
        store.archivedSessions = [{ id: 'session-1', archived: true }];

        store.updateSession({ id: 'session-1', archived: false });

        expect(store.archivedSessions).toHaveLength(0);
        expect(store.sessions).toHaveLength(1);
        expect(store.sessions[0].id).toBe('session-1');
      });

      it('removes from activeSessions when archived', () => {
        const store = useSessionsStore();

        store.activeSessions = [{ id: 'session-1', status: 'waiting' }];
        store.sessions = [{ id: 'session-1', status: 'waiting' }];
        store.archivedSessions = [];

        store.updateSession({ id: 'session-1', archived: true });

        expect(store.activeSessions).toHaveLength(0);
      });

      it('preserves gitBranch when archiving a new session', () => {
        const store = useSessionsStore();

        // Create a session with gitBranch in the active list
        const sessionWithBranch = {
          id: 'session-1',
          name: 'Feature Branch',
          gitBranch: 'feature/user-auth',
          gitWorktree: null,
          archived: false,
        };

        store.sessions = [sessionWithBranch];
        store.archivedSessions = [];

        // Archive the session
        store.updateSession({ id: 'session-1', archived: true });

        // Verify gitBranch is preserved
        expect(store.archivedSessions).toHaveLength(1);
        expect(store.archivedSessions[0].gitBranch).toBe('feature/user-auth');
        expect(store.archivedSessions[0].name).toBe('Feature Branch');
        expect(store.archivedSessions[0].gitWorktree).toBeNull();
      });

      it('preserves gitBranch when unarchiving a session', () => {
        const store = useSessionsStore();

        // Create a session with gitBranch in the archived list
        const archivedSessionWithBranch = {
          id: 'session-1',
          name: 'Feature Branch',
          gitBranch: 'feature/user-auth',
          gitWorktree: null,
          archived: true,
        };

        store.sessions = [];
        store.archivedSessions = [archivedSessionWithBranch];

        // Unarchive the session
        store.updateSession({ id: 'session-1', archived: false });

        // Verify gitBranch is preserved
        expect(store.sessions).toHaveLength(1);
        expect(store.sessions[0].gitBranch).toBe('feature/user-auth');
        expect(store.sessions[0].name).toBe('Feature Branch');
        expect(store.sessions[0].gitWorktree).toBeNull();
      });

      it('preserves multiple properties when archiving a session', () => {
        const store = useSessionsStore();

        // Session with multiple git and custom properties
        const sessionWithMultipleProps = {
          id: 'session-1',
          name: 'Complex Session',
          gitBranch: 'develop',
          gitWorktree: '.worktrees/session-1',
          prUrl: 'https://github.com/repo/pull/123',
          error: null,
          status: 'completed',
          archived: false,
        };

        store.sessions = [sessionWithMultipleProps];
        store.archivedSessions = [];

        // Archive the session (only archived flag changes)
        store.updateSession({ id: 'session-1', archived: true });

        // Verify all properties are preserved
        const archivedSession = store.archivedSessions[0];
        expect(archivedSession.gitBranch).toBe('develop');
        expect(archivedSession.gitWorktree).toBe('.worktrees/session-1');
        expect(archivedSession.prUrl).toBe('https://github.com/repo/pull/123');
        expect(archivedSession.status).toBe('completed');
        expect(archivedSession.name).toBe('Complex Session');
      });

      it('preserves multiple properties when unarchiving a session', () => {
        const store = useSessionsStore();

        // Session with multiple git and custom properties
        const archivedSessionWithMultipleProps = {
          id: 'session-1',
          name: 'Complex Session',
          gitBranch: 'develop',
          gitWorktree: '.worktrees/session-1',
          prUrl: 'https://github.com/repo/pull/123',
          error: null,
          status: 'completed',
          archived: true,
        };

        store.sessions = [];
        store.archivedSessions = [archivedSessionWithMultipleProps];

        // Unarchive the session
        store.updateSession({ id: 'session-1', archived: false });

        // Verify all properties are preserved
        const unarchivedSession = store.sessions[0];
        expect(unarchivedSession.gitBranch).toBe('develop');
        expect(unarchivedSession.gitWorktree).toBe('.worktrees/session-1');
        expect(unarchivedSession.prUrl).toBe('https://github.com/repo/pull/123');
        expect(unarchivedSession.status).toBe('completed');
        expect(unarchivedSession.name).toBe('Complex Session');
      });

      it('handles archiving when session does not exist in source list', () => {
        const store = useSessionsStore();

        // Session data without existing source session
        store.sessions = [];
        store.archivedSessions = [];

        // Archive a session that doesn't exist in sessions list
        store.updateSession({ id: 'new-session', archived: true, gitBranch: 'main' });

        // Should still be added to archivedSessions
        expect(store.archivedSessions).toHaveLength(1);
        expect(store.archivedSessions[0].id).toBe('new-session');
        expect(store.archivedSessions[0].gitBranch).toBe('main');
      });

      it('handles unarchiving when session does not exist in source list', () => {
        const store = useSessionsStore();

        // Session data without existing source session
        store.sessions = [];
        store.archivedSessions = [];

        // Unarchive a session that doesn't exist in archivedSessions list
        store.updateSession({ id: 'new-session', archived: false, gitBranch: 'feature' });

        // Should still be added to sessions
        expect(store.sessions).toHaveLength(1);
        expect(store.sessions[0].id).toBe('new-session');
        expect(store.sessions[0].gitBranch).toBe('feature');
      });

      it('updates session properties while preserving gitBranch when archiving', () => {
        const store = useSessionsStore();

        const originalSession = {
          id: 'session-1',
          name: 'Original Name',
          gitBranch: 'feature/fix',
          status: 'running',
          archived: false,
        };

        store.sessions = [originalSession];
        store.archivedSessions = [];

        // Archive and update status in same call
        store.updateSession({ id: 'session-1', archived: true, status: 'completed' });

        // Verify gitBranch and new status are both present
        expect(store.archivedSessions[0].gitBranch).toBe('feature/fix');
        expect(store.archivedSessions[0].status).toBe('completed');
        expect(store.archivedSessions[0].name).toBe('Original Name');
      });
    });

    describe('deleteSession with archived sessions', () => {
      it('removes session from archivedSessions list', async () => {
        const store = useSessionsStore();

        store.archivedSessions = [{ id: 'session-1', archived: true }];

        api.deleteSession.mockResolvedValue();

        await store.deleteSession('session-1');

        expect(store.archivedSessions).toHaveLength(0);
      });
    });
  });
});
