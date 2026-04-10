import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionInitializer } from './useSessionInitializer.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useTemplatesStore } from '../stores/templates.js';

// Mock useApi
vi.mock('./useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
  },
}));

// Mock useWebSocket
const mockHandlerFactory = () => vi.fn(() => () => {});
let mockSubscription;

vi.mock('./useWebSocket.js', () => ({
    ensureSubscribed: vi.fn(() => Promise.resolve()),
    useWebSocket: vi.fn(() => ({
      isConnected: { value: true },
      onReconnect: vi.fn(() => () => {}),
    })),
    useSessionSubscription: vi.fn((sessionId) => {
      mockSubscription = {
        sessionId,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        onStatus: mockHandlerFactory(),
        onMessage: mockHandlerFactory(),
        onPartial: mockHandlerFactory(),
        onError: mockHandlerFactory(),
        onCanvasAdd: mockHandlerFactory(),
        onCanvasRemove: mockHandlerFactory(),
        onCanvasUpdate: mockHandlerFactory(),
        onTodosUpdate: mockHandlerFactory(),
        onSessionUpdate: mockHandlerFactory(),
        onSummaryUpdate: mockHandlerFactory(),
        onConversationCreated: mockHandlerFactory(),
        onConversationUpdated: mockHandlerFactory(),
        onConversationDeleted: mockHandlerFactory(),
        onUsageUpdate: mockHandlerFactory(),
        onChangesUpdate: mockHandlerFactory(),
        onWorkLog: mockHandlerFactory(),
        onWorkLogsAssociated: mockHandlerFactory(),
        onThinkingPartial: mockHandlerFactory(),
        onCommandOutput: mockHandlerFactory(),
        onCommandComplete: mockHandlerFactory(),
        onCommandError: mockHandlerFactory(),
        onCommandRunDeleted: mockHandlerFactory(),
      };
      return mockSubscription;
    }),
  }));

import { useSessionSubscription, ensureSubscribed } from './useWebSocket.js';

describe('useSessionInitializer', () => {
  let pinia;
  let sessionsStore;
  let canvasStore;
  let todosStore;
  let summary;
  let hasChanges;
  let changesFileCount;
  let checkForChanges;
  let startPolling;
  let stopPolling;
  let resetPolling;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    sessionsStore = useSessionsStore();
    canvasStore = useCanvasStore();
    todosStore = useTodosStore();

    // Mock store methods
    vi.spyOn(sessionsStore, 'fetchSession').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchMessages').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchConversations').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchWorkLogs').mockResolvedValue(undefined);
    vi.spyOn(canvasStore, 'fetchItems').mockResolvedValue(undefined);
    vi.spyOn(todosStore, 'fetchTodos').mockResolvedValue(undefined);

    // Reactive state for the composable
    summary = ref(null);
    hasChanges = ref(false);
    changesFileCount = ref(0);
    checkForChanges = vi.fn();
    startPolling = vi.fn();
    stopPolling = vi.fn();
    resetPolling = vi.fn();

    vi.clearAllMocks();
  });

  function createInitializer() {
    return useSessionInitializer({
      summary,
      hasChanges,
      changesFileCount,
      checkForChanges,
      startPolling,
      stopPolling,
      resetPolling,
    });
  }

  describe('initializeSession', () => {
    it('creates a WebSocket subscription for the session', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      expect(useSessionSubscription).toHaveBeenCalledWith('session-1');
      expect(mockSubscription.subscribe).toHaveBeenCalled();
      expect(ensureSubscribed).toHaveBeenCalledWith('session-1');
    });

    it('fetches session, conversations, messages, work logs, and canvas items', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      expect(sessionsStore.fetchSession).toHaveBeenCalledWith('session-1');
      expect(sessionsStore.fetchConversations).toHaveBeenCalledWith('session-1');
      expect(sessionsStore.fetchMessages).toHaveBeenCalledWith('session-1');
      expect(sessionsStore.fetchWorkLogs).toHaveBeenCalledWith('session-1');
      expect(canvasStore.fetchItems).toHaveBeenCalledWith('session-1');
    });

    it('fetches todos', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      expect(todosStore.fetchTodos).toHaveBeenCalled();
    });

    it('checks for file changes', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      expect(checkForChanges).toHaveBeenCalled();
    });

    it('starts polling when session is running', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'running' };

      await initializeSession('session-1');

      expect(startPolling).toHaveBeenCalled();
    });

    it('starts polling when session is starting', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'starting' };

      await initializeSession('session-1');

      expect(startPolling).toHaveBeenCalled();
    });

    it('does not start polling when session is waiting', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      expect(startPolling).not.toHaveBeenCalled();
    });

    it('does not start polling when session is completed', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'completed' };

      await initializeSession('session-1');

      expect(startPolling).not.toHaveBeenCalled();
    });

    it('registers all 22 WebSocket handlers', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      // Verify all 22 handler registration functions were called
      expect(mockSubscription.onStatus).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onMessage).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onPartial).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onError).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCanvasAdd).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCanvasRemove).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCanvasUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onTodosUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onSessionUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onSummaryUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onConversationCreated).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onConversationUpdated).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onConversationDeleted).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onUsageUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onChangesUpdate).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onWorkLog).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onWorkLogsAssociated).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onThinkingPartial).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCommandOutput).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCommandComplete).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onCommandError).toHaveBeenCalledTimes(1);
    });

    it('fetches command buttons when session has projectId', async () => {
      const commandButtonsStore = useCommandButtonsStore();
      vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue(undefined);

      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting', projectId: 'proj-1' };

      await initializeSession('session-1');

      expect(commandButtonsStore.fetchButtons).toHaveBeenCalledWith('proj-1');
    });

    it('fetches templates when session has projectId', async () => {
      const templatesStore = useTemplatesStore();
      vi.spyOn(templatesStore, 'fetchProjectTemplates').mockResolvedValue(undefined);

      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting', projectId: 'proj-1' };

      await initializeSession('session-1');

      expect(templatesStore.fetchProjectTemplates).toHaveBeenCalledWith('proj-1');
    });

    it('handles ensureSubscribed failure gracefully', async () => {
      ensureSubscribed.mockRejectedValueOnce(new Error('Connection failed'));

      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      // Should not throw
      await initializeSession('session-1');

      // Should still fetch data
      expect(sessionsStore.fetchSession).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('unsubscribes from WebSocket', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');
      cleanup();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    });

    it('resets polling', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');
      cleanup();

      expect(resetPolling).toHaveBeenCalled();
    });

    it('clears store state', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      // Pre-populate store state
      sessionsStore.messages = [{ id: 'msg-1' }];
      sessionsStore.conversations = [{ id: 'conv-1' }];
      sessionsStore.activeConversationId = 'conv-1';
      sessionsStore.workLogs = { 'log-1': {} };

      await initializeSession('session-1');
      cleanup();

      expect(sessionsStore.messages).toEqual([]);
      expect(sessionsStore.conversations).toEqual([]);
      expect(sessionsStore.activeConversationId).toBeNull();
      expect(sessionsStore.workLogs).toEqual({});
    });

    it('clears canvas items', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      canvasStore.items = [{ id: 'item-1' }];

      await initializeSession('session-1');
      cleanup();

      expect(canvasStore.items).toEqual([]);
    });

    it('clears todos', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');
      cleanup();

      // todosStore.clearTodos should have been called
      // We can verify the items are empty
      expect(todosStore.items).toEqual([]);
    });

    it('clears summary', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      summary.value = { title: 'test' };

      await initializeSession('session-1');
      cleanup();

      expect(summary.value).toBeNull();
    });

    it('can be called before initializeSession without error', () => {
      const { cleanup } = createInitializer();
      expect(() => cleanup()).not.toThrow();
    });
  });

  describe('re-initialization', () => {
    it('cleans up old session before initializing new one', async () => {
      const { initializeSession, cleanup } = createInitializer();

      // Initialize first session
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };
      await initializeSession('session-1');

      const firstSubscription = mockSubscription;

      // Cleanup and initialize second session
      cleanup();
      sessionsStore.currentSession = { id: 'session-2', status: 'running' };
      await initializeSession('session-2');

      // First subscription should have been unsubscribed
      expect(firstSubscription.unsubscribe).toHaveBeenCalled();
      // Second subscription should be created
      expect(useSessionSubscription).toHaveBeenCalledWith('session-2');
    });
  });
});
