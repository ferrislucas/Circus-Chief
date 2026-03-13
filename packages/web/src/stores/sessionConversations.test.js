import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionConversationsStore } from './sessionConversations.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    getConversationMessages: vi.fn(),
    getSessionMessages: vi.fn(),
    branchConversation: vi.fn(),
    getSessionWorkLogs: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('SessionConversations Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has empty defaults', () => {
      const store = useSessionConversationsStore();
      expect(store.conversations).toEqual([]);
      expect(store.activeConversationId).toBeNull();
      expect(store.messages).toEqual([]);
      expect(store.workLogs).toEqual({});
    });
  });

  describe('activeConversation getter', () => {
    it('returns null when no active conversation', () => {
      const store = useSessionConversationsStore();
      expect(store.activeConversation).toBeNull();
    });

    it('returns the active conversation', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1', name: 'First' },
        { id: 'conv-2', name: 'Second' },
      ];
      store.activeConversationId = 'conv-2';
      expect(store.activeConversation).toEqual({ id: 'conv-2', name: 'Second' });
    });
  });

  describe('getConversationById getter', () => {
    it('finds conversation by id', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1', name: 'Test' }];
      expect(store.getConversationById('conv-1')).toEqual({ id: 'conv-1', name: 'Test' });
    });

    it('returns undefined for missing id', () => {
      const store = useSessionConversationsStore();
      expect(store.getConversationById('unknown')).toBeUndefined();
    });
  });

  describe('rootConversations getter', () => {
    it('returns only root conversations', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1', parentConversationId: null },
        { id: 'conv-2', parentConversationId: 'conv-1' },
        { id: 'conv-3', parentConversationId: null },
      ];
      expect(store.rootConversations).toHaveLength(2);
      expect(store.rootConversations.map(c => c.id)).toEqual(['conv-1', 'conv-3']);
    });
  });

  describe('conversationTree getter', () => {
    it('builds tree from flat list', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'root', parentConversationId: null },
        { id: 'child-1', parentConversationId: 'root' },
        { id: 'child-2', parentConversationId: 'root' },
        { id: 'grandchild', parentConversationId: 'child-1' },
      ];
      const tree = store.conversationTree;
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('root');
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe('grandchild');
    });
  });

  describe('getConversationChildren getter', () => {
    it('returns direct children', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'parent', parentConversationId: null },
        { id: 'child-1', parentConversationId: 'parent' },
        { id: 'child-2', parentConversationId: 'parent' },
        { id: 'other', parentConversationId: 'other-parent' },
      ];
      const children = store.getConversationChildren('parent');
      expect(children).toHaveLength(2);
    });
  });

  describe('getConversationParent getter', () => {
    it('returns parent conversation', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'parent', parentConversationId: null },
        { id: 'child', parentConversationId: 'parent' },
      ];
      expect(store.getConversationParent('child')).toEqual({ id: 'parent', parentConversationId: null });
    });

    it('returns null for root conversation', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'root', parentConversationId: null }];
      expect(store.getConversationParent('root')).toBeNull();
    });
  });

  describe('fetchConversations', () => {
    it('fetches and sets conversations with active', async () => {
      const conversations = [
        { id: 'conv-1', isActive: false },
        { id: 'conv-2', isActive: true },
      ];
      api.getConversations.mockResolvedValue(conversations);

      const store = useSessionConversationsStore();
      await store.fetchConversations('session-1');

      expect(store.conversations).toEqual(conversations);
      expect(store.activeConversationId).toBe('conv-2');
    });

    it('falls back to first conversation when none is active', async () => {
      api.getConversations.mockResolvedValue([{ id: 'conv-1', isActive: false }]);

      const store = useSessionConversationsStore();
      await store.fetchConversations('session-1');

      expect(store.activeConversationId).toBe('conv-1');
    });

    it('handles error by clearing state', async () => {
      api.getConversations.mockRejectedValue(new Error('Network error'));

      const store = useSessionConversationsStore();
      await expect(store.fetchConversations('session-1')).rejects.toThrow('Network error');
      expect(store.conversations).toEqual([]);
      expect(store.activeConversationId).toBeNull();
    });
  });

  describe('createConversation', () => {
    it('creates and adds conversation', async () => {
      const newConv = { id: 'new-conv', name: 'New', isActive: true };
      api.createConversation.mockResolvedValue(newConv);

      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'existing', isActive: true }];

      const result = await store.createConversation('session-1', 'New');

      expect(result.id).toBe('new-conv');
      expect(store.activeConversationId).toBe('new-conv');
      expect(store.messages).toEqual([]);
      // existing should now be inactive
      expect(store.conversations.find(c => c.id === 'existing').isActive).toBe(false);
    });
  });

  describe('switchConversation', () => {
    it('switches to a different conversation', async () => {
      const messages = [{ id: 'msg-1', content: 'Hello' }];
      api.updateConversation.mockResolvedValue({});
      api.getConversationMessages.mockResolvedValue(messages);
      api.getSessionWorkLogs.mockResolvedValue({});

      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1', isActive: true },
        { id: 'conv-2', isActive: false },
      ];
      store.activeConversationId = 'conv-1';
      store.messages = [{ id: 'old-msg' }];

      await store.switchConversation('session-1', 'conv-2');

      expect(store.activeConversationId).toBe('conv-2');
      expect(store.messages).toEqual(messages);
    });

    it('does nothing when switching to same conversation', async () => {
      const store = useSessionConversationsStore();
      store.activeConversationId = 'conv-1';

      await store.switchConversation('session-1', 'conv-1');

      expect(api.updateConversation).not.toHaveBeenCalled();
    });
  });

  describe('renameConversation', () => {
    it('renames conversation and updates local state', async () => {
      api.updateConversation.mockResolvedValue({ id: 'conv-1', name: 'Renamed' });

      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1', name: 'Original' }];

      const result = await store.renameConversation('session-1', 'conv-1', 'Renamed');

      expect(result.name).toBe('Renamed');
      expect(store.conversations[0].name).toBe('Renamed');
    });
  });

  describe('addMessage', () => {
    it('adds a message to the store', () => {
      const store = useSessionConversationsStore();
      store.addMessage({ id: 'msg-1', content: 'Hello' });
      expect(store.messages).toHaveLength(1);
    });

    it('does not add duplicate messages', () => {
      const store = useSessionConversationsStore();
      store.addMessage({ id: 'msg-1', content: 'Hello' });
      store.addMessage({ id: 'msg-1', content: 'Hello' });
      expect(store.messages).toHaveLength(1);
    });

    it('filters by session when provided', () => {
      const store = useSessionConversationsStore();
      store.addMessage({ id: 'msg-1', sessionId: 'other-session' }, 'session-1');
      expect(store.messages).toHaveLength(0);
    });
  });

  describe('updateConversation (WebSocket)', () => {
    it('updates existing conversation', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1', name: 'Old' }];

      store.updateConversation({ id: 'conv-1', name: 'Updated' });

      expect(store.conversations[0].name).toBe('Updated');
    });

    it('ignores null conversation', () => {
      const store = useSessionConversationsStore();
      store.updateConversation(null);
      expect(store.conversations).toEqual([]);
    });

    it('updates active state when isActive is true', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1', isActive: true },
        { id: 'conv-2', isActive: false },
      ];
      store.activeConversationId = 'conv-1';

      store.updateConversation({ id: 'conv-2', isActive: true });

      expect(store.activeConversationId).toBe('conv-2');
      expect(store.conversations.find(c => c.id === 'conv-1').isActive).toBe(false);
    });

    it('ignores conversations from different sessions', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1', name: 'Old' }];

      store.updateConversation({ id: 'conv-1', name: 'Updated', sessionId: 'other' }, 'session-1');

      expect(store.conversations[0].name).toBe('Old');
    });
  });

  describe('addConversation (WebSocket)', () => {
    it('adds new conversation', () => {
      const store = useSessionConversationsStore();
      store.addConversation({ id: 'conv-1', name: 'New' });
      expect(store.conversations).toHaveLength(1);
    });

    it('does not add duplicate', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1' }];
      store.addConversation({ id: 'conv-1', name: 'Dup' });
      expect(store.conversations).toHaveLength(1);
    });

    it('sets active when isActive is true', () => {
      const store = useSessionConversationsStore();
      store.addConversation({ id: 'conv-1', isActive: true });
      expect(store.activeConversationId).toBe('conv-1');
    });
  });

  describe('removeConversation', () => {
    it('removes conversation from list', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1' },
        { id: 'conv-2' },
      ];
      store.removeConversation('conv-1');
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe('conv-2');
    });

    it('sets new active conversation when provided', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1' }];
      store.activeConversationId = 'conv-1';

      store.removeConversation('conv-1', { id: 'conv-2', name: 'New Active' });

      expect(store.activeConversationId).toBe('conv-2');
      expect(store.conversations).toHaveLength(1);
      expect(store.conversations[0].id).toBe('conv-2');
    });

    it('picks first available when active is removed', () => {
      const store = useSessionConversationsStore();
      store.conversations = [
        { id: 'conv-1' },
        { id: 'conv-2' },
      ];
      store.activeConversationId = 'conv-1';

      store.removeConversation('conv-1');

      expect(store.activeConversationId).toBe('conv-2');
    });
  });

  describe('clearConversations', () => {
    it('resets all conversation state', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1' }];
      store.activeConversationId = 'conv-1';

      store.clearConversations();

      expect(store.conversations).toEqual([]);
      expect(store.activeConversationId).toBeNull();
    });
  });

  describe('workLog actions', () => {
    it('addWorkLog adds to correct message bucket', () => {
      const store = useSessionConversationsStore();
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1' });
      expect(store.workLogs['msg-1']).toHaveLength(1);
    });

    it('addWorkLog uses _unassociated for no messageId', () => {
      const store = useSessionConversationsStore();
      store.addWorkLog({ id: 'log-1' });
      expect(store.workLogs['_unassociated']).toHaveLength(1);
    });

    it('addWorkLog prevents duplicates', () => {
      const store = useSessionConversationsStore();
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1' });
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1' });
      expect(store.workLogs['msg-1']).toHaveLength(1);
    });

    it('getWorkLogsForMessage returns logs for message', () => {
      const store = useSessionConversationsStore();
      store.workLogs = { 'msg-1': [{ id: 'log-1' }] };
      expect(store.getWorkLogsForMessage('msg-1')).toHaveLength(1);
    });

    it('getWorkLogsForMessage returns empty array for unknown message', () => {
      const store = useSessionConversationsStore();
      expect(store.getWorkLogsForMessage('unknown')).toEqual([]);
    });

    it('getUnassociatedWorkLogs returns unassociated logs', () => {
      const store = useSessionConversationsStore();
      store.workLogs = { '_unassociated': [{ id: 'log-1' }] };
      expect(store.getUnassociatedWorkLogs).toHaveLength(1);
    });

    it('associateWorkLogs moves unassociated to message', () => {
      const store = useSessionConversationsStore();
      store.workLogs = { '_unassociated': [{ id: 'log-1' }, { id: 'log-2' }] };
      store.associateWorkLogs('msg-1');
      expect(store.workLogs['msg-1']).toHaveLength(2);
      expect(store.workLogs['_unassociated']).toHaveLength(0);
    });

    it('clearWorkLogs resets to empty', () => {
      const store = useSessionConversationsStore();
      store.workLogs = { 'msg-1': [{ id: 'log-1' }] };
      store.clearWorkLogs();
      expect(store.workLogs).toEqual({});
    });
  });

  describe('updateConversationUsage', () => {
    it('updates conversation usage data', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{
        id: 'conv-1',
        inputTokens: 0,
        outputTokens: 0,
      }];

      store.updateConversationUsage('conv-1', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 1,
        contextWindow: 200000,
        model: 'claude-3-sonnet',
      });

      expect(store.conversations[0].inputTokens).toBe(1000);
      expect(store.conversations[0].outputTokens).toBe(500);
      expect(store.conversations[0].model).toBe('claude-3-sonnet');
    });

    it('does nothing for unknown conversation', () => {
      const store = useSessionConversationsStore();
      store.conversations = [{ id: 'conv-1', inputTokens: 0 }];

      store.updateConversationUsage('unknown', { inputTokens: 1000 });

      expect(store.conversations[0].inputTokens).toBe(0);
    });
  });
});
