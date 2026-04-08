import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia, getActivePinia } from 'pinia';

vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionTodos: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';
import { createOverlayTodosStore } from './createOverlayTodosStore.js';

describe('createOverlayTodosStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('factory creates unique stores', () => {
    const store1 = createOverlayTodosStore();
    const store2 = createOverlayTodosStore();

    expect(store1.$id).not.toBe(store2.$id);
    expect(store1.$id).toMatch(/^overlay-todos-\d+$/);
    expect(store2.$id).toMatch(/^overlay-todos-\d+$/);
  });

  it('isolated state: items don\'t leak', () => {
    const store1 = createOverlayTodosStore();
    const store2 = createOverlayTodosStore();

    store1.items = [{ id: 'todo1', status: 'pending' }];

    expect(store1.items).toHaveLength(1);
    expect(store2.items).toHaveLength(0);
    expect(store2.items).toEqual([]);
  });

  it('fetchTodos populates items', async () => {
    const mockTodos = [{ id: 't1', status: 'pending' }];
    api.getSessionTodos.mockResolvedValue(mockTodos);

    const store = createOverlayTodosStore();
    await store.fetchTodos('session-1');

    expect(store.items).toHaveLength(1);
    expect(store.items[0].id).toBe('t1');
    expect(store.loading).toBe(false);
    expect(store.error).toBe(null);
    expect(api.getSessionTodos).toHaveBeenCalledWith('session-1', null);
  });

  it('fetchTodos sets error on failure', async () => {
    api.getSessionTodos.mockRejectedValue(new Error('fail'));

    const store = createOverlayTodosStore();
    await store.fetchTodos('session-1');

    expect(store.error).toBe('fail');
    expect(store.items).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('updateTodos filters by conversationId', () => {
    const store = createOverlayTodosStore();
    store.currentConversationId = 'conv-1';

    // Update with different conversationId should be ignored
    store.updateTodos([{ id: 't1' }], 'conv-2');
    expect(store.items).toEqual([]);

    // Update with matching conversationId should work
    store.updateTodos([{ id: 't2' }], 'conv-1');
    expect(store.items).toHaveLength(1);
    expect(store.items[0].id).toBe('t2');
  });

  it('clearTodos resets all state', () => {
    const store = createOverlayTodosStore();

    // Set up some state
    store.items = [{ id: 't1', status: 'pending' }];
    store.expanded = true;
    store.currentConversationId = 'conv-1';
    store.error = 'some error';
    store.loading = true;

    // Clear all state
    store.clearTodos();

    expect(store.items).toEqual([]);
    expect(store.expanded).toBe(false);
    expect(store.currentConversationId).toBe(null);
    expect(store.error).toBe(null);
    expect(store.loading).toBe(false);
  });

  it('getters work correctly', () => {
    const store = createOverlayTodosStore();

    // Initially no todos
    expect(store.hasTodos).toBe(false);
    expect(store.pendingCount).toBe(0);
    expect(store.inProgressCount).toBe(0);
    expect(store.completedCount).toBe(0);

    // Add mixed status todos
    store.items = [
      { id: 't1', status: 'pending' },
      { id: 't2', status: 'pending' },
      { id: 't3', status: 'in_progress' },
      { id: 't4', status: 'completed' },
      { id: 't5', status: 'completed' },
      { id: 't6', status: 'completed' },
    ];

    expect(store.hasTodos).toBe(true);
    expect(store.pendingCount).toBe(2);
    expect(store.inProgressCount).toBe(1);
    expect(store.completedCount).toBe(3);
  });

  it('toggleExpanded flips value', () => {
    const store = createOverlayTodosStore();

    expect(store.expanded).toBe(false);

    store.toggleExpanded();
    expect(store.expanded).toBe(true);

    store.toggleExpanded();
    expect(store.expanded).toBe(false);
  });

  it('setExpanded sets value', () => {
    const store = createOverlayTodosStore();

    expect(store.expanded).toBe(false);

    store.setExpanded(true);
    expect(store.expanded).toBe(true);

    store.setExpanded(false);
    expect(store.expanded).toBe(false);

    store.setExpanded(true);
    expect(store.expanded).toBe(true);
  });

  it('$cleanup disposes and removes from Pinia registry', () => {
    const store = createOverlayTodosStore();
    const storeId = store.$id;
    const pinia = getActivePinia();

    // Verify store exists in registry
    expect(pinia.state.value[storeId]).toBeDefined();

    // Cleanup the store
    store.$cleanup();

    // Verify store is removed from registry
    expect(pinia.state.value[storeId]).toBeUndefined();
  });
});
