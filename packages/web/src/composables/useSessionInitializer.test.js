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
import { useSessionPromptsStore } from '../stores/sessionPrompts.js';

// Mock useApi
vi.mock('./useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
    getSessionPrompt: vi.fn().mockResolvedValue(null),
  },
}));

// Mock useWebSocket
// Each handler factory returns a tracked unsubscribe function so tests can
// verify the cleanup contract for handlers registered before subscription.
const mockHandlerUnsubscribes = [];
const mockHandlerFactory = () => vi.fn(() => {
  const unsubscribe = vi.fn();
  mockHandlerUnsubscribes.push(unsubscribe);
  return unsubscribe;
});
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
        onPrompt: mockHandlerFactory(),
        onPromptResolved: mockHandlerFactory(),
        onCommandOutput: mockHandlerFactory(),
        onCommandComplete: mockHandlerFactory(),
        onCommandError: mockHandlerFactory(),
        onCommandRunDeleted: mockHandlerFactory(),
      };
      return mockSubscription;
    }),
  }));

import { useSessionSubscription, ensureSubscribed, useWebSocket } from './useWebSocket.js';

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

    it('registers all 24 WebSocket handlers', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      // Verify all 24 handler registration functions were called
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
      expect(mockSubscription.onPrompt).toHaveBeenCalledTimes(1);
      expect(mockSubscription.onPromptResolved).toHaveBeenCalledTimes(1);
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

    it('clears the active agent prompt', async () => {
      const promptsStore = useSessionPromptsStore();
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };
      promptsStore.show({ id: 'prompt-1', sessionId: 'session-1' });

      await initializeSession('session-1');
      cleanup();

      expect(promptsStore.promptFor('session-1')).toBeNull();
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

  describe('WebSocket CANVAS_ADD dispatch', () => {
    it('dispatches incoming CANVAS_ADD payloads through canvasStore.addItem', async () => {
      // Arrange: spy on addItem so we can observe what the handler passes in.
      const addItemSpy = vi.spyOn(canvasStore, 'addItem');
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      // The handler registered with onCanvasAdd is the first argument to
      // the mock. Invoke it directly, simulating a WS broadcast.
      const canvasAddHandler = mockSubscription.onCanvasAdd.mock.calls[0][0];
      const item = { id: 'ws-1', filename: 'note.md', type: 'markdown', createdAt: 1000, content: 'hi' };

      // Act
      canvasAddHandler(item);

      // Assert
      expect(addItemSpy).toHaveBeenCalledWith(item);
    });

    it('duplicate CANVAS_ADD payloads (self-echo) do not duplicate the store item', async () => {
      // Arrange
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      const canvasAddHandler = mockSubscription.onCanvasAdd.mock.calls[0][0];
      const item = { id: 'echo-1', filename: 'e.md', type: 'markdown', createdAt: 1000, content: 'one' };

      // Act: first dispatch inserts.
      canvasAddHandler(item);
      // Second dispatch is the WS echo of the same id — must not duplicate.
      canvasAddHandler({ ...item, content: 'two' });

      // Assert: exactly one entry, and the merged content is the latest value.
      const matches = canvasStore.items.filter((i) => i.id === 'echo-1');
      expect(matches).toHaveLength(1);
      expect(matches[0].content).toBe('two');
    });
  });

  describe('WebSocket agent prompt dispatch', () => {
    it('shows and resolves prompts from session events', async () => {
      const promptsStore = useSessionPromptsStore();
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      const prompt = { id: 'prompt-1', sessionId: 'session-1', question: 'Continue?' };
      mockSubscription.onPrompt.mock.calls[0][0](prompt);
      expect(promptsStore.promptFor('session-1')).toEqual(prompt);

      mockSubscription.onPromptResolved.mock.calls[0][0]('prompt-1', 'session-1');
      expect(promptsStore.promptFor('session-1')).toBeNull();
    });
  });

  it('rehydrates prompts after reconnect', async () => {
    let reconnect;
    useWebSocket.mockReturnValue({ isConnected: { value: true }, onReconnect: vi.fn((callback) => { reconnect = callback; return () => {}; }) });
    const promptsStore = useSessionPromptsStore();
    vi.spyOn(promptsStore, 'hydrate').mockResolvedValue();
    const { initializeSession } = createInitializer();
    sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

    await initializeSession('session-1');
    await reconnect();

    expect(promptsStore.hydrate).toHaveBeenCalledWith('session-1');
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

  // ==================== FR-3: event delivery during initialization ====================

  describe('initialization ordering (FR-3)', () => {
    beforeEach(() => {
      mockHandlerUnsubscribes.length = 0;
      // Restore the module-mock defaults: tests below override these with
      // pending/rejected implementations that would otherwise leak.
      ensureSubscribed.mockImplementation(() => Promise.resolve());
      useWebSocket.mockImplementation(() => ({
        isConnected: { value: true },
        onReconnect: vi.fn(() => () => {}),
      }));
    });

    it('registers all scoped handlers before subscribing', async () => {
      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      await initializeSession('session-1');

      // Every lifecycle handler factory ran before subscribe() was invoked.
      const handlerFns = [
        mockSubscription.onStatus, mockSubscription.onMessage, mockSubscription.onPartial,
        mockSubscription.onUsageUpdate, mockSubscription.onSessionUpdate, mockSubscription.onWorkLog,
      ];
      const firstHandlerOrder = Math.min(...handlerFns.map((fn) => fn.mock.invocationCallOrder[0]));
      const subscribeOrder = mockSubscription.subscribe.mock.invocationCallOrder[0];
      expect(firstHandlerOrder).toBeLessThan(subscribeOrder);
    });

    it('applies a status frame delivered between subscription and the initial snapshot', async () => {
      // Hold the subscription acknowledgement and the snapshot fetch pending.
      let resolveEnsure;
      ensureSubscribed.mockImplementation(() => new Promise((resolve) => { resolveEnsure = resolve; }));
      let resolveFetch;
      sessionsStore.fetchSession.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      const initPromise = initializeSession('session-1');

      // Handlers are registered synchronously, so the captured onStatus
      // callback exists before the subscription is even confirmed.
      const statusHandler = mockSubscription.onStatus.mock.calls[0][0];
      statusHandler('running');

      // The UI goes active and polling begins without waiting for the fetch.
      expect(sessionsStore.currentSession.status).toBe('running');
      expect(startPolling).toHaveBeenCalled();

      // The subscription confirms and the snapshot resolves afterwards; the
      // ordering guard keeps the active display.
      resolveEnsure();
      await vi.waitFor(() => expect(sessionsStore.fetchSession).toHaveBeenCalledTimes(1));
      resolveFetch();
      await initPromise;

      expect(sessionsStore.currentSession.status).toBe('running');

      cleanup();
    });

    it('adds a message delivered after that status frame without a second status event', async () => {
      // Hold the subscription acknowledgement pending for the whole interval.
      ensureSubscribed.mockImplementation(() => new Promise(() => {}));

      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };
      initializeSession('session-1');

      const statusHandler = mockSubscription.onStatus.mock.calls[0][0];
      const messageHandler = mockSubscription.onMessage.mock.calls[0][0];

      statusHandler('running');
      messageHandler({ id: 'msg-1', sessionId: 'session-1', role: 'assistant', content: 'Working...' });

      // The running state is retained and the message lands with it — the
      // message never depends on a second status event.
      expect(sessionsStore.currentSession.status).toBe('running');
      expect(sessionsStore.messages).toHaveLength(1);
      expect(sessionsStore.messages[0].id).toBe('msg-1');

      cleanup();
    });

    it('removes early-registered handlers when cleanup runs before the snapshot completes', async () => {
      // Subscription never confirms (setup "fails") — handlers were still
      // registered first and must be removable.
      ensureSubscribed.mockImplementation(() => new Promise(() => {}));

      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };
      initializeSession('session-1');

      expect(mockSubscription.onStatus).toHaveBeenCalled();
      expect(mockHandlerUnsubscribes.length).toBeGreaterThan(0);

      cleanup();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      for (const unsubscribe of mockHandlerUnsubscribes) {
        expect(unsubscribe).toHaveBeenCalled();
      }
      // Polling is reset by cleanup even though initialization never finished.
      expect(resetPolling).toHaveBeenCalled();
    });

    it('reconciles the authoritative snapshot after reconnect and restores polling', async () => {
      let reconnectCallback;
      useWebSocket.mockReturnValue({
        isConnected: { value: true },
        onReconnect: vi.fn((callback) => { reconnectCallback = callback; return () => {}; }),
      });
      const promptsStore = useSessionPromptsStore();
      vi.spyOn(promptsStore, 'hydrate').mockResolvedValue();

      const { initializeSession } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      // While disconnected the session started running; the reconnect
      // snapshot is the first thing that reports it.
      sessionsStore.fetchSession.mockImplementation(async () => {
        sessionsStore.currentSession = { id: 'session-1', status: 'running' };
      });

      await initializeSession('session-1');
      startPolling.mockClear();

      await reconnectCallback();

      // The reconnect handler reconciles via fetchSession first...
      expect(sessionsStore.fetchSession).toHaveBeenCalledWith('session-1');
      // ...and polling is restored for the now-active session.
      expect(startPolling).toHaveBeenCalled();
    });

    it('ignores a late snapshot for a session that is no longer selected', async () => {
      const { initializeSession, cleanup } = createInitializer();
      sessionsStore.currentSession = { id: 'session-1', status: 'waiting' };

      let resolveFetch;
      sessionsStore.fetchSession.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

      const initPromise = initializeSession('session-1');

      // Wait until initialization has reached the snapshot fetch, then
      // simulate the user navigating to another session.
      await vi.waitFor(() => expect(sessionsStore.fetchSession).toHaveBeenCalledTimes(1));
      cleanup();

      // The stale snapshot resolves afterwards — it must not touch the
      // newly selected session's state.
      sessionsStore.currentSession = { id: 'session-2', status: 'waiting' };
      resolveFetch();
      await initPromise;

      expect(sessionsStore.currentSession.id).toBe('session-2');
      expect(sessionsStore.currentSession.status).toBe('waiting');
    });
  });
});
