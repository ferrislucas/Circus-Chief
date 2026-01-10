import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTodosStore } from './todos.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionTodos: vi.fn(),
  },
}));

describe('useTodosStore', () => {
  let store;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    store = useTodosStore();
  });

  describe('state', () => {
    it('initializes with empty items', () => {
      expect(store.items).toEqual([]);
    });

    it('initializes with loading false', () => {
      expect(store.loading).toBe(false);
    });

    it('initializes with error null', () => {
      expect(store.error).toBe(null);
    });

    it('initializes with expanded false', () => {
      expect(store.expanded).toBe(false);
    });

    it('initializes with currentConversationId null', () => {
      expect(store.currentConversationId).toBe(null);
    });
  });

  describe('getters', () => {
    it('hasTodos returns true when items exist', () => {
      store.items = [{ id: '1', status: 'pending' }];
      expect(store.hasTodos).toBe(true);
    });

    it('hasTodos returns false when no items', () => {
      expect(store.hasTodos).toBe(false);
    });

    it('pendingCount returns count of pending items', () => {
      store.items = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'completed' },
      ];
      expect(store.pendingCount).toBe(2);
    });

    it('inProgressCount returns count of in_progress items', () => {
      store.items = [
        { id: '1', status: 'in_progress' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'in_progress' },
      ];
      expect(store.inProgressCount).toBe(2);
    });

    it('completedCount returns count of completed items', () => {
      store.items = [
        { id: '1', status: 'completed' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'completed' },
      ];
      expect(store.completedCount).toBe(2);
    });
  });

  describe('actions', () => {
    describe('clearTodos', () => {
      it('clears items array', () => {
        store.items = [{ id: '1', status: 'pending' }];
        store.clearTodos();
        expect(store.items).toEqual([]);
      });

      it('clears loading state', () => {
        store.loading = true;
        store.clearTodos();
        expect(store.loading).toBe(false);
      });

      it('clears error state', () => {
        store.error = 'Some error message';
        store.clearTodos();
        expect(store.error).toBe(null);
      });

      it('clears all three state properties at once', () => {
        store.items = [{ id: '1', status: 'pending' }];
        store.loading = true;
        store.error = 'Error occurred';

        store.clearTodos();

        expect(store.items).toEqual([]);
        expect(store.loading).toBe(false);
        expect(store.error).toBe(null);
      });

      it('preserves expanded state when clearing todos', () => {
        store.expanded = true;
        store.items = [{ id: '1' }];
        store.loading = true;
        store.error = 'error';

        store.clearTodos();

        expect(store.expanded).toBe(true);
        expect(store.items).toEqual([]);
        expect(store.loading).toBe(false);
        expect(store.error).toBe(null);
      });

      it('clears currentConversationId', () => {
        store.currentConversationId = 'conv-123';
        store.clearTodos();
        expect(store.currentConversationId).toBe(null);
      });
    });

    describe('updateTodos', () => {
      it('updates items with provided todos', () => {
        const todos = [
          { id: '1', status: 'pending' },
          { id: '2', status: 'completed' },
        ];
        store.updateTodos(todos);
        expect(store.items).toEqual(todos);
      });

      it('replaces items completely', () => {
        store.items = [{ id: '1', status: 'pending' }];
        const newTodos = [{ id: '2', status: 'completed' }];
        store.updateTodos(newTodos);
        expect(store.items).toEqual(newTodos);
      });

      it('updates when conversationId matches currentConversationId', () => {
        store.currentConversationId = 'conv-123';
        const todos = [{ id: '1', status: 'pending' }];
        store.updateTodos(todos, 'conv-123');
        expect(store.items).toEqual(todos);
      });

      it('does not update when conversationId does not match currentConversationId', () => {
        store.currentConversationId = 'conv-123';
        store.items = [{ id: 'old', status: 'pending' }];
        const newTodos = [{ id: 'new', status: 'pending' }];
        store.updateTodos(newTodos, 'conv-456');
        expect(store.items).toEqual([{ id: 'old', status: 'pending' }]);
      });

      it('updates when currentConversationId is null (no tracking)', () => {
        store.currentConversationId = null;
        const todos = [{ id: '1', status: 'pending' }];
        store.updateTodos(todos, 'conv-123');
        expect(store.items).toEqual(todos);
      });

      it('updates when conversationId is null (legacy behavior)', () => {
        store.currentConversationId = 'conv-123';
        const todos = [{ id: '1', status: 'pending' }];
        store.updateTodos(todos, null);
        expect(store.items).toEqual(todos);
      });
    });

    describe('toggleExpanded', () => {
      it('toggles expanded from false to true', () => {
        expect(store.expanded).toBe(false);
        store.toggleExpanded();
        expect(store.expanded).toBe(true);
      });

      it('toggles expanded from true to false', () => {
        store.expanded = true;
        store.toggleExpanded();
        expect(store.expanded).toBe(false);
      });

      it('toggles multiple times correctly', () => {
        expect(store.expanded).toBe(false);
        store.toggleExpanded();
        expect(store.expanded).toBe(true);
        store.toggleExpanded();
        expect(store.expanded).toBe(false);
        store.toggleExpanded();
        expect(store.expanded).toBe(true);
      });
    });

    describe('setExpanded', () => {
      it('sets expanded to true', () => {
        store.setExpanded(true);
        expect(store.expanded).toBe(true);
      });

      it('sets expanded to false', () => {
        store.expanded = true;
        store.setExpanded(false);
        expect(store.expanded).toBe(false);
      });

      it('handles setting to same value', () => {
        store.expanded = true;
        store.setExpanded(true);
        expect(store.expanded).toBe(true);
      });
    });

    describe('fetchTodos', () => {
      it('sets loading to true during fetch', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve([]), 10);
            })
        );

        const promise = store.fetchTodos('session-1');
        expect(store.loading).toBe(true);
        await promise;
      });

      it('sets loading to false after successful fetch', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockResolvedValue([
          { id: '1', status: 'pending' },
        ]);

        await store.fetchTodos('session-1');
        expect(store.loading).toBe(false);
      });

      it('populates items from API response', async () => {
        const { api } = await import('../composables/useApi.js');
        const todos = [
          { id: '1', status: 'pending' },
          { id: '2', status: 'completed' },
        ];
        api.getSessionTodos.mockResolvedValue(todos);

        await store.fetchTodos('session-1');
        expect(store.items).toEqual(todos);
      });

      it('clears error on successful fetch', async () => {
        const { api } = await import('../composables/useApi.js');
        store.error = 'Previous error';
        api.getSessionTodos.mockResolvedValue([]);

        await store.fetchTodos('session-1');
        expect(store.error).toBe(null);
      });

      it('sets error when fetch fails', async () => {
        const { api } = await import('../composables/useApi.js');
        const errorMsg = 'Failed to fetch todos';
        api.getSessionTodos.mockRejectedValue(new Error(errorMsg));

        await store.fetchTodos('session-1');
        expect(store.error).toBe(errorMsg);
      });

      it('sets loading to false even when fetch fails', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockRejectedValue(new Error('API error'));

        await store.fetchTodos('session-1');
        expect(store.loading).toBe(false);
      });

      it('calls API with correct session ID', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockResolvedValue([]);

        await store.fetchTodos('my-session-id');
        expect(api.getSessionTodos).toHaveBeenCalledWith('my-session-id', null);
      });

      it('calls API with conversationId when provided', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockResolvedValue([]);

        await store.fetchTodos('my-session-id', 'conv-123');
        expect(api.getSessionTodos).toHaveBeenCalledWith('my-session-id', 'conv-123');
      });

      it('sets currentConversationId when fetching with conversationId', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockResolvedValue([]);

        await store.fetchTodos('session-1', 'conv-123');
        expect(store.currentConversationId).toBe('conv-123');
      });

      it('sets currentConversationId to null when fetching without conversationId', async () => {
        const { api } = await import('../composables/useApi.js');
        api.getSessionTodos.mockResolvedValue([]);
        store.currentConversationId = 'old-conv';

        await store.fetchTodos('session-1');
        expect(store.currentConversationId).toBe(null);
      });
    });
  });

  describe('integration scenarios', () => {
    it('handles clearing todos after failed fetch', async () => {
      const { api } = await import('../composables/useApi.js');
      api.getSessionTodos.mockRejectedValue(new Error('Network error'));

      await store.fetchTodos('session-1');
      expect(store.error).toBe('Network error');
      expect(store.loading).toBe(false);

      store.clearTodos();
      expect(store.items).toEqual([]);
      expect(store.error).toBe(null);
      expect(store.loading).toBe(false);
    });

    it('handles clearing todos between session switches', () => {
      // Simulate first session's todos
      store.items = [{ id: '1', status: 'pending' }];
      expect(store.items.length).toBe(1);

      // Clear before switching
      store.clearTodos();
      expect(store.items).toEqual([]);
      expect(store.error).toBe(null);

      // Ready for next session's todos
      store.items = [{ id: '2', status: 'completed' }];
      expect(store.items.length).toBe(1);
      expect(store.items[0].id).toBe('2');
    });

    it('handles conversation switching correctly', async () => {
      const { api } = await import('../composables/useApi.js');
      const conv1Todos = [{ id: 'conv1-todo', status: 'pending' }];
      const conv2Todos = [{ id: 'conv2-todo', status: 'completed' }];

      // Fetch todos for conversation 1
      api.getSessionTodos.mockResolvedValue(conv1Todos);
      await store.fetchTodos('session-1', 'conv-1');
      expect(store.items).toEqual(conv1Todos);
      expect(store.currentConversationId).toBe('conv-1');

      // Switch to conversation 2
      store.clearTodos();
      api.getSessionTodos.mockResolvedValue(conv2Todos);
      await store.fetchTodos('session-1', 'conv-2');
      expect(store.items).toEqual(conv2Todos);
      expect(store.currentConversationId).toBe('conv-2');
    });

    it('ignores WebSocket updates for different conversation', async () => {
      const { api } = await import('../composables/useApi.js');
      const conv1Todos = [{ id: 'conv1-todo', status: 'pending' }];

      // Fetch todos for conversation 1
      api.getSessionTodos.mockResolvedValue(conv1Todos);
      await store.fetchTodos('session-1', 'conv-1');
      expect(store.currentConversationId).toBe('conv-1');

      // Simulate WebSocket update for different conversation
      store.updateTodos([{ id: 'conv2-todo', status: 'pending' }], 'conv-2');

      // Store should still have conv1 todos
      expect(store.items).toEqual(conv1Todos);
    });
  });
});
