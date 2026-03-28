import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock stores
const mockSessionsStore = reactive({
  sessions: [],
});

const mockStreamingStore = {
  addSessionWorkLog: vi.fn(),
  setSessionPartialText: vi.fn(),
  setPartialThinking: vi.fn(),
  setSessionFileCount: vi.fn(),
  clearSessionStreamingState: vi.fn(),
  clearSessionEphemeralState: vi.fn(),
  hydrateSessionState: vi.fn(),
};

// Mock useSessionSubscription - track instances by sessionId
const mockSubscriptionInstances = {};
function createMockSubscription(sessionId) {
  const handlers = {
    onWorkLog: [],
    onPartial: [],
    onThinkingPartial: [],
    onStatus: [],
    onChangesUpdate: [],
  };
  const sub = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onWorkLog: vi.fn((cb) => { handlers.onWorkLog.push(cb); return vi.fn(); }),
    onPartial: vi.fn((cb) => { handlers.onPartial.push(cb); return vi.fn(); }),
    onThinkingPartial: vi.fn((cb) => { handlers.onThinkingPartial.push(cb); return vi.fn(); }),
    onStatus: vi.fn((cb) => { handlers.onStatus.push(cb); return vi.fn(); }),
    onChangesUpdate: vi.fn((cb) => { handlers.onChangesUpdate.push(cb); return vi.fn(); }),
    _handlers: handlers,
  };
  mockSubscriptionInstances[sessionId] = sub;
  return sub;
}

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

vi.mock('../stores/sessionStreaming.js', () => ({
  useSessionStreamingStore: vi.fn(() => mockStreamingStore),
}));

let reconnectCallback = null;
vi.mock('./useWebSocket.js', () => ({
  useSessionSubscription: vi.fn((sessionId) => createMockSubscription(sessionId)),
  useWebSocket: vi.fn(() => ({
    onReconnect: vi.fn((cb) => {
      reconnectCallback = cb;
      return vi.fn(() => { reconnectCallback = null; });
    }),
  })),
}));

import { useRunningSessionSubscriptions } from './useRunningSessionSubscriptions.js';
import { useSessionSubscription } from './useWebSocket.js';

describe('useRunningSessionSubscriptions', () => {
  let testComponent;
  let wrapper;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mock state
    mockSessionsStore.sessions = [];
    Object.keys(mockSubscriptionInstances).forEach(k => delete mockSubscriptionInstances[k]);
    reconnectCallback = null;

    mockStreamingStore.addSessionWorkLog.mockReset();
    mockStreamingStore.setSessionPartialText.mockReset();
    mockStreamingStore.setPartialThinking.mockReset();
    mockStreamingStore.setSessionFileCount.mockReset();
    mockStreamingStore.clearSessionStreamingState.mockReset();
    mockStreamingStore.clearSessionEphemeralState.mockReset();
    mockStreamingStore.hydrateSessionState.mockReset();

    // Default fetch mock: returns empty streaming state
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
      })
    );

    // Create test component to use the composable
    testComponent = {
      template: '<div>Test</div>',
      setup() {
        const result = useRunningSessionSubscriptions();
        return { ...result };
      },
    };
  });

  afterEach(() => {
    // Ensure wrapper is unmounted to prevent cross-test interference
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.useRealTimers();
  });

  it('subscribes to running sessions on mount (immediate watch trigger)', async () => {
    mockSessionsStore.sessions = [
      { id: 'session-1', status: 'running' },
      { id: 'session-2', status: 'completed' },
    ];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    expect(useSessionSubscription).toHaveBeenCalledWith('session-1');
    expect(useSessionSubscription).not.toHaveBeenCalledWith('session-2');
    expect(mockSubscriptionInstances['session-1'].subscribe).toHaveBeenCalled();
  });

  it('subscribes to newly running sessions when store updates', async () => {
    mockSessionsStore.sessions = [];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    // Add a running session
    mockSessionsStore.sessions = [{ id: 'session-new', status: 'running' }];

    await nextTick();

    expect(useSessionSubscription).toHaveBeenCalledWith('session-new');
    expect(mockSubscriptionInstances['session-new'].subscribe).toHaveBeenCalled();
  });

  it('unsubscribes from sessions that transition away from running/starting', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    expect(sub.subscribe).toHaveBeenCalled();

    // Session becomes completed
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'completed' }];

    await nextTick();

    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('does not duplicate subscriptions for already-subscribed sessions', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    // Trigger watch again with same running sessions (plus a non-running one)
    mockSessionsStore.sessions = [
      { id: 'session-1', status: 'running' },
      { id: 'session-2', status: 'completed' },
    ];

    await nextTick();

    // Should not create another subscription for session-1
    const callsForSession1 = useSessionSubscription.mock.calls.filter(c => c[0] === 'session-1');
    expect(callsForSession1).toHaveLength(1);
  });

  it('calls streamingStore.addSessionWorkLog when onWorkLog fires', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const workLogHandler = sub._handlers.onWorkLog[0];
    const log = { id: '1', type: 'tool_use', tool: 'Read' };
    workLogHandler(log);

    expect(mockStreamingStore.addSessionWorkLog).toHaveBeenCalledWith('session-1', log);
  });

  it('calls streamingStore.setSessionPartialText with correct args when onPartial fires', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const partialHandler = sub._handlers.onPartial[0];
    // onPartial receives a string (text), not { text }
    partialHandler('Hello world');

    expect(mockStreamingStore.setSessionPartialText).toHaveBeenCalledWith('session-1', 'Hello world');
  });

  it('calls streamingStore.setPartialThinking with correct args when onThinkingPartial fires', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const thinkingHandler = sub._handlers.onThinkingPartial[0];
    // onThinkingPartial receives a string (thinking), not { thinking }
    thinkingHandler('Let me think...');

    expect(mockStreamingStore.setPartialThinking).toHaveBeenCalledWith('Let me think...', 'session-1');
  });

  it('calls streamingStore.clearSessionEphemeralState after 2s delay when session stops', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const statusHandler = sub._handlers.onStatus[0];
    // onStatus receives a string (status), not { status }
    statusHandler('completed');

    // Should not clear immediately
    expect(mockStreamingStore.clearSessionEphemeralState).not.toHaveBeenCalled();

    // After 2 seconds
    vi.advanceTimersByTime(2000);

    expect(mockStreamingStore.clearSessionEphemeralState).toHaveBeenCalledWith('session-1');
  });

  it('handles sessions with status "starting" in addition to "running"', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'starting' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    expect(useSessionSubscription).toHaveBeenCalledWith('session-1');
    expect(mockSubscriptionInstances['session-1'].subscribe).toHaveBeenCalled();
  });

  it('does not subscribe to sessions with status "waiting", "completed", or "error"', async () => {
    mockSessionsStore.sessions = [
      { id: 'session-waiting', status: 'waiting' },
      { id: 'session-completed', status: 'completed' },
      { id: 'session-error', status: 'error' },
    ];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    expect(useSessionSubscription).not.toHaveBeenCalledWith('session-waiting');
    expect(useSessionSubscription).not.toHaveBeenCalledWith('session-completed');
    expect(useSessionSubscription).not.toHaveBeenCalledWith('session-error');
  });

  it('calls streamingStore.setSessionFileCount when onChangesUpdate fires', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const changesHandler = sub._handlers.onChangesUpdate[0];
    changesHandler(5, true);

    expect(mockStreamingStore.setSessionFileCount).toHaveBeenCalledWith('session-1', 5);
  });

  it('cancels stale clear timeout if session returns to running before 2s elapses', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const statusHandler = sub._handlers.onStatus[0];

    // Session stops
    statusHandler('completed');
    expect(mockStreamingStore.clearSessionStreamingState).not.toHaveBeenCalled();

    // Advance 1 second (less than 2s timeout)
    vi.advanceTimersByTime(1000);

    // Session returns to running — should cancel the timeout
    statusHandler('running');

    // Advance past the original 2s mark
    vi.advanceTimersByTime(2000);

    // clearSessionEphemeralState should NOT have been called because the timeout was cancelled
    expect(mockStreamingStore.clearSessionEphemeralState).not.toHaveBeenCalled();
  });

  it('clears ephemeral state when clear timeout fires (no cancellation)', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const statusHandler = sub._handlers.onStatus[0];

    statusHandler('completed');
    vi.advanceTimersByTime(2000);

    expect(mockStreamingStore.clearSessionEphemeralState).toHaveBeenCalledWith('session-1');
  });

  it('makes a REST call to /api/sessions/:id/streaming-state after subscribing', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/session-1/streaming-state');
  });

  it('calls hydrateSessionState when streaming-state REST call resolves', async () => {
    const snapshot = {
      workLogs: [{ id: '1', type: 'tool_use', content: 'test' }],
      partialText: 'hello',
      thinking: 'hmm',
    };

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(snapshot),
      })
    );

    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();
    // Wait for fetch promise chain to resolve
    await vi.waitFor(() => {
      expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('session-1', snapshot);
    });
  });

  it('does not throw when streaming-state REST call fails', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    // Should not throw or break the subscription
    const sub = mockSubscriptionInstances['session-1'];
    expect(sub.subscribe).toHaveBeenCalled();
    // hydrateSessionState should not have been called
    expect(mockStreamingStore.hydrateSessionState).not.toHaveBeenCalled();
  });

  it('cleans up all subscriptions on unmount', async () => {
    mockSessionsStore.sessions = [
      { id: 'session-1', status: 'running' },
      { id: 'session-2', status: 'running' },
    ];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub1 = mockSubscriptionInstances['session-1'];
    const sub2 = mockSubscriptionInstances['session-2'];

    expect(sub1.subscribe).toHaveBeenCalled();
    expect(sub2.subscribe).toHaveBeenCalled();

    // Unmount and set wrapper to null so afterEach doesn't double-unmount
    wrapper.unmount();
    wrapper = null;

    expect(sub1.unsubscribe).toHaveBeenCalled();
    expect(sub2.unsubscribe).toHaveBeenCalled();
  });

  describe('hydration retry logic', () => {
    it('retries hydration after 1.5s when initial fetch returns empty data', async () => {
      let fetchCallCount = 0;
      const retrySnapshot = {
        workLogs: [{ id: '1', type: 'tool_use', content: 'test' }],
        partialText: 'hello',
        thinking: null,
      };

      globalThis.fetch = vi.fn(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First call: return empty data
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
          });
        }
        // Retry call: return data
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(retrySnapshot),
        });
      });

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      // Wait for the initial fetch promise chain to resolve
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // hydrateSessionState should NOT have been called yet (empty data)
      expect(mockStreamingStore.hydrateSessionState).not.toHaveBeenCalled();

      // Advance past the 1.5s retry delay — use advanceTimersByTimeAsync
      // so that microtasks (Promise callbacks) within the timer are flushed
      await vi.advanceTimersByTimeAsync(1500);

      // Wait for retry fetch promise to resolve
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('session-1', retrySnapshot);
      });
    });

    it('retries hydration after 1.5s when initial fetch fails', async () => {
      let fetchCallCount = 0;
      const retrySnapshot = {
        workLogs: [{ id: '1', type: 'tool_use', content: 'retry data' }],
        partialText: 'retried',
        thinking: null,
      };

      globalThis.fetch = vi.fn(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(retrySnapshot),
        });
      });

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      // Wait for the initial fetch rejection to be handled
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // Advance past the 1.5s retry delay
      vi.advanceTimersByTime(1500);

      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('session-1', retrySnapshot);
      });
    });

    it('does not retry hydration if session is no longer running', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
        })
      );

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // Session becomes completed before retry fires
      mockSessionsStore.sessions = [{ id: 'session-1', status: 'completed' }];
      await nextTick();

      // Advance past the 1.5s retry delay
      vi.advanceTimersByTime(1500);

      // Should NOT have made a second fetch because session stopped and was unsubscribed
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry hydration when initial fetch returns data with content', async () => {
      const snapshot = {
        workLogs: [{ id: '1', type: 'tool_use', content: 'test' }],
        partialText: 'hello',
        thinking: null,
      };

      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(snapshot),
        })
      );

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('session-1', snapshot);
      });

      // Advance past potential retry delay
      vi.advanceTimersByTime(2000);

      // Should have only called fetch once (no retry needed)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('handles hydration fetch failure without breaking real-time updates', async () => {
      // Both initial and retry fail
      globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      // Subscription should still work
      const sub = mockSubscriptionInstances['session-1'];
      expect(sub.subscribe).toHaveBeenCalled();

      // Advance past retry delay
      vi.advanceTimersByTime(1500);

      // Wait for retry promise to resolve (and fail)
      await nextTick();
      await nextTick();

      // Real-time callbacks should still function
      const workLogHandler = sub._handlers.onWorkLog[0];
      const log = { id: '1', type: 'tool_use', tool: 'Read' };
      workLogHandler(log);

      expect(mockStreamingStore.addSessionWorkLog).toHaveBeenCalledWith('session-1', log);
    });
  });

  describe('child session subscription', () => {
    it('subscribes to child session when it appears in store with "starting" status', async () => {
      mockSessionsStore.sessions = [];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      // Add a child session with starting status
      mockSessionsStore.sessions = [
        { id: 'parent-1', status: 'waiting', parentSessionId: null },
        { id: 'child-1', status: 'starting', parentSessionId: 'parent-1' },
      ];

      await nextTick();

      expect(useSessionSubscription).toHaveBeenCalledWith('child-1');
      expect(mockSubscriptionInstances['child-1'].subscribe).toHaveBeenCalled();
      // Parent should not be subscribed (status is 'waiting')
      expect(useSessionSubscription).not.toHaveBeenCalledWith('parent-1');
    });

    it('subscribes to child session when its status transitions from "waiting" to "running"', async () => {
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'waiting', parentSessionId: 'parent-1' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      // Should not subscribe while waiting
      expect(useSessionSubscription).not.toHaveBeenCalledWith('child-1');

      // Update status to running
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
      ];

      await nextTick();

      expect(useSessionSubscription).toHaveBeenCalledWith('child-1');
      expect(mockSubscriptionInstances['child-1'].subscribe).toHaveBeenCalled();
    });

    it('unsubscribes when child session transitions from "running" to "completed"', async () => {
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      const sub = mockSubscriptionInstances['child-1'];
      expect(sub.subscribe).toHaveBeenCalled();

      // Child session completes
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'completed', parentSessionId: 'parent-1' },
      ];

      await nextTick();

      expect(sub.unsubscribe).toHaveBeenCalled();
    });

    it('hydrates streaming state for newly subscribed child session', async () => {
      const snapshot = {
        workLogs: [{ id: '1', type: 'tool_use', content: 'child work' }],
        partialText: 'hello from child',
        thinking: null,
      };

      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(snapshot),
        })
      );

      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('child-1', snapshot);
      });
    });

    it('does not double-subscribe when child session is already subscribed', async () => {
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      // Trigger the watch again with the same running child session
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
        { id: 'some-other', status: 'completed' },
      ];

      await nextTick();

      const callsForChild = useSessionSubscription.mock.calls.filter(c => c[0] === 'child-1');
      expect(callsForChild).toHaveLength(1);
    });

    it('clears child session ephemeral state after 2s delay when child session stops', async () => {
      mockSessionsStore.sessions = [
        { id: 'child-1', status: 'running', parentSessionId: 'parent-1' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      const sub = mockSubscriptionInstances['child-1'];
      const statusHandler = sub._handlers.onStatus[0];

      // Child session completes
      statusHandler('completed');

      // Should not clear immediately
      expect(mockStreamingStore.clearSessionEphemeralState).not.toHaveBeenCalled();

      // After 2 seconds
      vi.advanceTimersByTime(2000);

      expect(mockStreamingStore.clearSessionEphemeralState).toHaveBeenCalledWith('child-1');
    });
  });

  describe('WebSocket reconnection re-hydration', () => {
    it('reconnection triggers re-hydration for all subscribed sessions', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1', status: 'running' },
        { id: 'session-2', status: 'running' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();

      // Wait for initial hydration fetches
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });

      // Reset fetch call count
      globalThis.fetch.mockClear();

      // Simulate WebSocket reconnection
      expect(reconnectCallback).toBeTruthy();
      reconnectCallback();

      // Both sessions should have re-hydration fetches
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/session-1/streaming-state');
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/sessions/session-2/streaming-state');
      });
    });

    it('reconnect handler is cleaned up on unmount', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1', status: 'running' },
      ];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      const savedCallback = reconnectCallback;

      // Unmount the component
      wrapper.unmount();
      wrapper = null;

      // Reset fetch
      globalThis.fetch.mockClear();

      // The reconnectCallback should have been nulled by the cleanup function
      expect(reconnectCallback).toBeNull();

      // Invoking the saved callback should not trigger fetches (it was cleaned up)
      if (savedCallback) savedCallback();
      // No new fetches should have been made (sessions were unsubscribed)
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('exponential backoff hydration retries', () => {
    it('retries hydration with exponential backoff (1.5s, 3s, 6s, 12s)', async () => {
      // Always return empty data so retries keep happening
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
        })
      );

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      // Wait for initial fetch
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 1st retry after 1.5s
      await vi.advanceTimersByTimeAsync(1500);
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });

      // 2nd retry after 3s
      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      });

      // 3rd retry after 6s
      await vi.advanceTimersByTimeAsync(6000);
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(4);
      });

      // 4th retry after 12s
      await vi.advanceTimersByTimeAsync(12000);
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(5);
      });
    });

    it('stops retrying after MAX_HYDRATION_RETRIES (4)', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
        })
      );

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // Exhaust all retries: 1.5s + 3s + 6s + 12s = 22.5s
      await vi.advanceTimersByTimeAsync(1500);
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

      await vi.advanceTimersByTimeAsync(3000);
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));

      await vi.advanceTimersByTimeAsync(6000);
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(4));

      await vi.advanceTimersByTimeAsync(12000);
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(5));

      // Advance a long time — no more retries should occur
      await vi.advanceTimersByTimeAsync(60000);
      expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    });

    it('retry cleanup on unsubscribe — no additional fetch after session stops', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
        })
      );

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // Session stops before retry fires
      mockSessionsStore.sessions = [{ id: 'session-1', status: 'completed' }];
      await nextTick();

      // Advance past all possible retry delays
      await vi.advanceTimersByTimeAsync(30000);

      // No retry fetch should have been made
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('successful hydration clears retry state — no further retries', async () => {
      let fetchCallCount = 0;
      const validSnapshot = {
        workLogs: [{ id: '1', type: 'tool_use', content: 'test' }],
        partialText: 'hello',
        thinking: null,
      };

      globalThis.fetch = vi.fn(() => {
        fetchCallCount++;
        if (fetchCallCount <= 1) {
          // First call returns empty
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ workLogs: [], partialText: '', thinking: null }),
          });
        }
        // Retry returns valid data
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(validSnapshot),
        });
      });

      mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

      wrapper = mount(testComponent, {
        global: { plugins: [createPinia()] },
      });

      await nextTick();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 1st retry at 1.5s returns valid data
      await vi.advanceTimersByTimeAsync(1500);
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        expect(mockStreamingStore.hydrateSessionState).toHaveBeenCalledWith('session-1', validSnapshot);
      });

      // Advance further — no more retries
      await vi.advanceTimersByTimeAsync(30000);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
