import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia, getActivePinia } from 'pinia';
import { createOverlaySessionsStore } from './createOverlaySessionsStore.js';
import { useSessionsStore } from './sessions.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSession: vi.fn(),
    getSessionMessages: vi.fn(),
    getConversationMessages: vi.fn(),
    getSessionWorkLogs: vi.fn(),
    stopSession: vi.fn(),
    restartSession: vi.fn(),
    startSession: vi.fn(),
    sendMessage: vi.fn(),
    updateSession: vi.fn(),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    branchConversation: vi.fn(),
    getSessionTodos: vi.fn(),
    getActiveSessions: vi.fn(),
    getProjectSessions: vi.fn(),
    getScheduledSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    toggleSessionStar: vi.fn(),
    duplicateSession: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('createOverlaySessionsStore', () => {
  beforeEach(() => {
    // Create a fresh Pinia instance for each test
    setActivePinia(createPinia());
    // Reset all API mocks before each test
    vi.clearAllMocks();
  });

  it('factory creates unique stores', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Each store should have a unique ID
    expect(store1.$id).not.toBe(store2.$id);
    expect(store1.$id).toMatch(/^overlay-sessions-\d+$/);
    expect(store2.$id).toMatch(/^overlay-sessions-\d+$/);
  });

  it('isolated state: messages do not leak between instances', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set messages in store1
    store1.messages = [{ id: 'msg1', role: 'user', content: 'Hello' }];

    // Verify store2 messages are still empty
    expect(store2.messages).toEqual([]);
    expect(store1.messages).toHaveLength(1);
  });

  it('isolated state: partialText does not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set partial text in store1
    store1.setPartialText('hello');

    // Verify store2 partialText is still empty
    expect(store2.partialText).toBe('');
    expect(store1.partialText).toBe('hello');
  });

  it('isolated state: currentSession does not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set currentSession in store1
    store1.currentSession = { id: 'x', name: 'Test Session' };

    // Verify store2 currentSession is still null
    expect(store2.currentSession).toBeNull();
    expect(store1.currentSession).toEqual({ id: 'x', name: 'Test Session' });
  });

  it('proxied getters delegate to main store', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    const testSession = { id: 'sess-1', name: 'Test Session', status: 'waiting' };
    mainStore.sessions.push(testSession);

    // Verify sessions getter returns the same array reference
    expect(overlayStore.sessions).toBe(mainStore.sessions);
    expect(overlayStore.sessions).toHaveLength(1);

    // Verify getSessionById delegates correctly
    expect(overlayStore.getSessionById('sess-1')).toEqual(testSession);
  });

  it('fetchSession populates local currentSession', async () => {
    const overlayStore = createOverlaySessionsStore();
    const mainStore = useSessionsStore();

    const mockSession = { id: 'sess-1', name: 'Test', status: 'waiting' };
    api.getSession.mockResolvedValue(mockSession);

    await overlayStore.fetchSession('sess-1');

    // Verify local currentSession is set
    expect(overlayStore.currentSession).toEqual(mockSession);
    expect(overlayStore.currentSession.id).toBe('sess-1');

    // Verify main store sessions contains it
    expect(mainStore.sessions).toContainEqual(mockSession);
  });

  it('fetchSession does NOT overwrite main store currentSession', async () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    // Set main store currentSession
    mainStore.currentSession = { id: 'main-session', name: 'Main' };

    // Mock API for overlay session
    const overlaySession = { id: 'overlay-session', name: 'Overlay' };
    api.getSession.mockResolvedValue(overlaySession);

    // Fetch session in overlay
    await overlayStore.fetchSession('overlay-session');

    // Verify main store currentSession is unchanged
    expect(mainStore.currentSession.id).toBe('main-session');

    // Verify overlay store currentSession is set
    expect(overlayStore.currentSession.id).toBe('overlay-session');
  });

  it('fetchMessages populates local messages only', async () => {
    const overlayStore = createOverlaySessionsStore();
    const mainStore = useSessionsStore();

    const mockMessages = [
      { id: 'msg1', role: 'user', content: 'Hello', sessionId: 'sess-1' },
    ];
    api.getSessionMessages.mockResolvedValue(mockMessages);

    await overlayStore.fetchMessages('sess-1');

    // Verify overlay messages are populated
    expect(overlayStore.messages).toHaveLength(1);
    expect(overlayStore.messages[0].id).toBe('msg1');

    // Verify main store messages are empty
    expect(mainStore.messages).toEqual([]);
  });

  it('delegated actions call main store', async () => {
    const overlayStore = createOverlaySessionsStore();

    api.stopSession.mockResolvedValue({ id: 'sess-1', status: 'completed' });

    await overlayStore.stopSession('sess-1');

    // Verify API was called
    expect(api.stopSession).toHaveBeenCalledWith('sess-1');
  });

  it('updateSessionStatus updates both local and main', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    // Set up session in both stores
    const session = { id: 'x', status: 'running', name: 'Test' };
    overlayStore.currentSession = { ...session };
    mainStore.sessions.push({ ...session });

    // Update status
    overlayStore.updateSessionStatus('x', 'completed');

    // Verify overlay currentSession updated
    expect(overlayStore.currentSession.status).toBe('completed');
    expect(overlayStore.currentSession.hasResponses).toBe(true);

    // Verify main store sessions updated
    expect(mainStore.sessions[0].status).toBe('completed');
    expect(mainStore.sessions[0].hasResponses).toBe(true);
  });

  it('updateSession updates both local and main', async () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    // Set up session in both stores
    const session = { id: 'x', name: 'old', status: 'waiting' };
    overlayStore.currentSession = { ...session };
    mainStore.sessions.push({ ...session });

    // Mock API
    api.updateSession.mockResolvedValue({ id: 'x', name: 'new' });

    // Update session
    await overlayStore.updateSession({ id: 'x', name: 'new' });

    // Verify overlay currentSession updated
    expect(overlayStore.currentSession.name).toBe('new');

    // Verify main store sessions updated
    expect(mainStore.sessions[0].name).toBe('new');
  });

  it('streaming: setPartialThinking / clearPartialThinking', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set up currentSession
    overlayStore.currentSession = { id: 'sess-1', name: 'Test' };

    // Set partial thinking
    overlayStore.setPartialThinking('thinking text');

    // Verify partial thinking is set for the session
    expect(overlayStore.partialThinkingBySession['sess-1']).toBe('thinking text');

    // Clear partial thinking
    overlayStore.clearPartialThinking();

    // Verify partial thinking is cleared
    expect(overlayStore.partialThinkingBySession['sess-1']).toBeNull();
  });

  it('usage: finalizeUsage updates currentSession and conversations', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set up state
    overlayStore.currentSession = { id: 's1', name: 'Test' };
    overlayStore.conversations = [
      { id: 'c1', name: 'Conv 1', inputTokens: 0, outputTokens: 0 },
    ];

    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
      webSearchRequests: 0,
      contextWindow: 200000,
      model: 'claude',
    };

    // Finalize usage
    overlayStore.finalizeUsage(usage, 'c1');

    // Verify currentSession updated
    expect(overlayStore.currentSession.inputTokens).toBe(100);
    expect(overlayStore.currentSession.outputTokens).toBe(50);
    expect(overlayStore.currentSession.cacheReadInputTokens).toBe(10);
    expect(overlayStore.currentSession.cacheCreationInputTokens).toBe(5);

    // Verify conversation updated
    expect(overlayStore.conversations[0].inputTokens).toBe(100);
    expect(overlayStore.conversations[0].outputTokens).toBe(50);

    // Verify runningUsage cleared
    expect(overlayStore.runningUsage).toBeNull();
  });

  it('conversationActions operate on local state', async () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    const mockConversations = [
      { id: 'conv-1', name: 'Main', isActive: true, inputTokens: 0 },
    ];
    api.getConversations.mockResolvedValue(mockConversations);

    await overlayStore.fetchConversations('sess-1');

    // Verify overlay conversations are populated
    expect(overlayStore.conversations).toHaveLength(1);
    expect(overlayStore.conversations[0].id).toBe('conv-1');
    expect(overlayStore.activeConversationId).toBe('conv-1');

    // Verify main store conversations are still empty
    expect(mainStore.conversations).toEqual([]);
  });

  it('$cleanup disposes and removes from Pinia registry', () => {
    const overlayStore = createOverlaySessionsStore();
    const storeId = overlayStore.$id;

    // Verify store is in Pinia registry
    const pinia = getActivePinia();
    expect(pinia.state.value[storeId]).toBeDefined();

    // Cleanup
    overlayStore.$cleanup();

    // Verify store is removed from registry
    expect(pinia.state.value[storeId]).toBeUndefined();
  });

  it('fetchSession guards against navigation during fetch', async () => {
    const overlayStore = createOverlaySessionsStore();

    // Set viewedSessionId to guard against navigation
    overlayStore.viewedSessionId = 'sess-1';

    const mockSession = { id: 'sess-1', name: 'Test' };
    api.getSession.mockResolvedValue(mockSession);

    // Start fetch
    const fetchPromise = overlayStore.fetchSession('sess-1');

    // Simulate navigation to different session before API returns
    overlayStore.viewedSessionId = 'sess-2';

    await fetchPromise;

    // Verify currentSession was NOT set (navigation guard prevented it)
    expect(overlayStore.currentSession).toBeNull();
  });

  it('fetchMessages guards against navigation during fetch', async () => {
    const overlayStore = createOverlaySessionsStore();

    // Set viewedSessionId to guard against navigation
    overlayStore.viewedSessionId = 'sess-1';

    const mockMessages = [{ id: 'msg1', role: 'user', content: 'Hello' }];
    api.getSessionMessages.mockResolvedValue(mockMessages);

    // Start fetch
    const fetchPromise = overlayStore.fetchMessages('sess-1');

    // Simulate navigation to different session before API returns
    overlayStore.viewedSessionId = 'sess-2';

    await fetchPromise;

    // Verify messages were NOT set (navigation guard prevented it)
    expect(overlayStore.messages).toEqual([]);
  });

  it('isolated state: conversations do not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set conversations in store1
    store1.conversations = [{ id: 'conv1', name: 'Test Conversation' }];

    // Verify store2 conversations are still empty
    expect(store2.conversations).toEqual([]);
    expect(store1.conversations).toHaveLength(1);
  });

  it('isolated state: workLogs do not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set workLogs in store1
    store1.workLogs = {
      'msg1': [{ id: 'log1', output: 'Test output' }],
    };

    // Verify store2 workLogs are still empty
    expect(store2.workLogs).toEqual({});
    expect(store1.workLogs['msg1']).toHaveLength(1);
  });

  it('isolated state: activeConversationId does not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set activeConversationId in store1
    store1.activeConversationId = 'conv-1';

    // Verify store2 activeConversationId is still null
    expect(store2.activeConversationId).toBeNull();
    expect(store1.activeConversationId).toBe('conv-1');
  });

  it('isolated state: loading/error do not leak', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();

    // Set loading/error in store1
    store1.loading = true;
    store1.error = 'Test error';

    // Verify store2 loading/error are still at defaults
    expect(store2.loading).toBe(false);
    expect(store2.error).toBeNull();
    expect(store1.loading).toBe(true);
    expect(store1.error).toBe('Test error');
  });

  it('delegated action: restartSession calls through to main store', async () => {
    const overlayStore = createOverlaySessionsStore();

    api.restartSession.mockResolvedValue({ id: 'sess-1', status: 'running' });

    await overlayStore.restartSession('sess-1');

    expect(api.restartSession).toHaveBeenCalledWith('sess-1');
  });

  it('delegated action: startSession calls through to main store', async () => {
    const overlayStore = createOverlaySessionsStore();

    api.startSession.mockResolvedValue({ id: 'sess-1', status: 'running' });

    await overlayStore.startSession('sess-1', 'Test prompt', 'claude-sonnet-4');

    expect(api.startSession).toHaveBeenCalledWith('sess-1', 'Test prompt', 'claude-sonnet-4');
  });

  it('delegated action: sendMessage calls through to main store', async () => {
    const overlayStore = createOverlaySessionsStore();

    api.sendMessage.mockResolvedValue({ id: 'msg1', content: 'Response' });

    await overlayStore.sendMessage('sess-1', 'Hello', [], 'claude-sonnet-4');

    expect(api.sendMessage).toHaveBeenCalledWith('sess-1', 'Hello', [], 'claude-sonnet-4');
  });

  it('updateSessionStatus sets hasResponses when transitioning from running to waiting', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set up running session
    overlayStore.currentSession = { id: 'x', status: 'running' };

    // Update to waiting
    overlayStore.updateSessionStatus('x', 'waiting');

    // Verify hasResponses is set
    expect(overlayStore.currentSession.hasResponses).toBe(true);
  });

  it('updateSessionStatus sets hasResponses when transitioning from running to completed', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set up running session
    overlayStore.currentSession = { id: 'x', status: 'running' };

    // Update to completed
    overlayStore.updateSessionStatus('x', 'completed');

    // Verify hasResponses is set
    expect(overlayStore.currentSession.hasResponses).toBe(true);
  });

  it('addMessage only adds messages matching currentSession', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set current session
    overlayStore.currentSession = { id: 'sess-1', name: 'Test' };

    // Add matching message
    overlayStore.addMessage({ id: 'msg1', sessionId: 'sess-1', content: 'Hello' });
    expect(overlayStore.messages).toHaveLength(1);

    // Try to add non-matching message
    overlayStore.addMessage({ id: 'msg2', sessionId: 'sess-2', content: 'World' });
    expect(overlayStore.messages).toHaveLength(1);
  });

  it('addMessage prevents duplicates', () => {
    const overlayStore = createOverlaySessionsStore();

    overlayStore.currentSession = { id: 'sess-1', name: 'Test' };

    const message = { id: 'msg1', sessionId: 'sess-1', content: 'Hello' };

    // Add message twice
    overlayStore.addMessage(message);
    overlayStore.addMessage(message);

    // Should only appear once
    expect(overlayStore.messages).toHaveLength(1);
  });

  it('clearPartialText clears text and throttle timer', () => {
    const overlayStore = createOverlaySessionsStore();

    // Set partial text
    overlayStore.setPartialText('test');
    expect(overlayStore.partialText).toBe('test');

    // Clear
    overlayStore.clearPartialText();

    expect(overlayStore.partialText).toBe('');
    expect(overlayStore._pendingPartialText).toBeNull();
    expect(overlayStore._partialThrottleTimer).toBeNull();
  });

  it('updateRunningUsage sets runningUsage with conversationId', () => {
    const overlayStore = createOverlaySessionsStore();

    const usage = {
      inputTokens: 50,
      outputTokens: 25,
      cacheReadInputTokens: 5,
    };

    overlayStore.updateRunningUsage(usage, 'conv-1');

    expect(overlayStore.runningUsage).toEqual({
      ...usage,
      conversationId: 'conv-1',
    });
  });

  it('clearRunningUsage clears usage and partial thinking', () => {
    const overlayStore = createOverlaySessionsStore();

    overlayStore.currentSession = { id: 'sess-1' };
    overlayStore.runningUsage = { inputTokens: 100 };
    overlayStore.setPartialThinking('thinking...');

    overlayStore.clearRunningUsage();

    expect(overlayStore.runningUsage).toBeNull();
    expect(overlayStore.partialThinkingBySession['sess-1']).toBeNull();
  });

  it('fetchSession updates existing session in main store', async () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    // Pre-populate main store with a session
    mainStore.sessions.push({ id: 'sess-1', name: 'Old Name', status: 'waiting' });

    // Mock updated session
    const updatedSession = { id: 'sess-1', name: 'New Name', status: 'running' };
    api.getSession.mockResolvedValue(updatedSession);

    await overlayStore.fetchSession('sess-1');

    // Verify session was updated (not duplicated) in main store
    expect(mainStore.sessions).toHaveLength(1);
    expect(mainStore.sessions[0].name).toBe('New Name');
    expect(mainStore.sessions[0].status).toBe('running');
  });

  it('proxied getter: archivedSessions delegates to main store', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    mainStore.archivedSessions.push({ id: 'arch-1', archived: true });

    expect(overlayStore.archivedSessions).toBe(mainStore.archivedSessions);
    expect(overlayStore.archivedSessions).toHaveLength(1);
  });

  it('proxied getter: activeSessions delegates to main store', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    mainStore.sessions.push({ id: 'sess-1', status: 'running', archived: false });

    expect(overlayStore.activeSessions).toBe(mainStore.activeSessions);
  });

  it('proxied getter: hasChildren delegates to main store', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    mainStore.sessions.push(
      { id: 'parent-1', name: 'Parent' },
      { id: 'child-1', name: 'Child', parentSessionId: 'parent-1' }
    );

    expect(overlayStore.hasChildren('parent-1')).toBe(mainStore.hasChildren('parent-1'));
  });

  it('proxied getter: getChildCount delegates to main store', () => {
    const mainStore = useSessionsStore();
    const overlayStore = createOverlaySessionsStore();

    mainStore.sessions.push(
      { id: 'parent-1', name: 'Parent' },
      { id: 'child-1', name: 'Child 1', parentSessionId: 'parent-1' },
      { id: 'child-2', name: 'Child 2', parentSessionId: 'parent-1' }
    );

    expect(overlayStore.getChildCount('parent-1')).toBe(2);
    expect(overlayStore.getChildCount('parent-1')).toBe(mainStore.getChildCount('parent-1'));
  });

  it('fetchSession handles API errors gracefully', async () => {
    const overlayStore = createOverlaySessionsStore();

    api.getSession.mockRejectedValue(new Error('Network error'));

    await overlayStore.fetchSession('sess-1');

    expect(overlayStore.error).toBe('Network error');
    expect(overlayStore.currentSession).toBeNull();
    expect(overlayStore.loading).toBe(false);
  });

  it('fetchMessages handles API errors gracefully', async () => {
    const overlayStore = createOverlaySessionsStore();

    overlayStore.viewedSessionId = 'sess-1';
    api.getSessionMessages.mockRejectedValue(new Error('Network error'));

    await overlayStore.fetchMessages('sess-1');

    expect(overlayStore.error).toBe('Network error');
    expect(overlayStore.messages).toEqual([]);
    expect(overlayStore.loading).toBe(false);
  });

  it('multiple overlay stores can coexist with independent state', () => {
    const store1 = createOverlaySessionsStore();
    const store2 = createOverlaySessionsStore();
    const store3 = createOverlaySessionsStore();

    // Set different state in each
    store1.currentSession = { id: 's1', name: 'Store 1' };
    store2.currentSession = { id: 's2', name: 'Store 2' };
    store3.currentSession = { id: 's3', name: 'Store 3' };

    store1.messages = [{ id: 'm1', content: 'Message 1' }];
    store2.messages = [{ id: 'm2', content: 'Message 2' }];
    store3.messages = [{ id: 'm3', content: 'Message 3' }];

    // Verify each store has independent state
    expect(store1.currentSession.id).toBe('s1');
    expect(store2.currentSession.id).toBe('s2');
    expect(store3.currentSession.id).toBe('s3');

    expect(store1.messages[0].id).toBe('m1');
    expect(store2.messages[0].id).toBe('m2');
    expect(store3.messages[0].id).toBe('m3');
  });

  describe('recentSends (ghost-prompt markers)', () => {
    it('initializes recentSends to an empty object on each overlay', () => {
      const store = createOverlaySessionsStore();
      expect(store.recentSends).toEqual({});
    });

    it('markRecentSend records the timestamp and hasRecentSend reports true', () => {
      const store = createOverlaySessionsStore();
      store.markRecentSend('sess-1');

      expect(store.recentSends['sess-1']).toBeTypeOf('number');
      expect(store.hasRecentSend('sess-1')).toBe(true);
    });

    it('clearRecentSend removes the marker', () => {
      const store = createOverlaySessionsStore();
      store.markRecentSend('sess-1');
      expect(store.hasRecentSend('sess-1')).toBe(true);

      store.clearRecentSend('sess-1');

      expect(store.hasRecentSend('sess-1')).toBe(false);
    });

    it('recentSends do not leak between overlay instances', () => {
      const store1 = createOverlaySessionsStore();
      const store2 = createOverlaySessionsStore();

      store1.markRecentSend('sess-A');

      expect(store1.hasRecentSend('sess-A')).toBe(true);
      expect(store2.hasRecentSend('sess-A')).toBe(false);
    });

    it('recentSends do not leak from overlay to main store', () => {
      const main = useSessionsStore();
      const overlay = createOverlaySessionsStore();

      overlay.markRecentSend('sess-1');

      expect(overlay.hasRecentSend('sess-1')).toBe(true);
      expect(main.hasRecentSend('sess-1')).toBe(false);
    });

    it('$cleanup removes the overlay store entry (including recentSends)', () => {
      const store = createOverlaySessionsStore();
      store.markRecentSend('sess-1');
      const storeId = store.$id;

      const pinia = getActivePinia();
      expect(pinia.state.value[storeId]).toBeDefined();

      store.$cleanup();

      expect(pinia.state.value[storeId]).toBeUndefined();
    });

    it('$cleanup cancels outstanding recent-send safety-net timers', () => {
      vi.useFakeTimers();
      try {
        const store = createOverlaySessionsStore();
        const cancelSpy = vi.spyOn(store, 'cancelAllRecentSendTimers');

        store.markRecentSend('sess-1');
        store.markRecentSend('sess-2');

        store.$cleanup();

        expect(cancelSpy).toHaveBeenCalledTimes(1);

        // Advancing past the TTL must not throw against the disposed store.
        expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
