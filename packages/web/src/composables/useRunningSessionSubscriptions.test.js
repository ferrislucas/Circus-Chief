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

vi.mock('./useWebSocket.js', () => ({
  useSessionSubscription: vi.fn((sessionId) => createMockSubscription(sessionId)),
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

    mockStreamingStore.addSessionWorkLog.mockReset();
    mockStreamingStore.setSessionPartialText.mockReset();
    mockStreamingStore.setPartialThinking.mockReset();
    mockStreamingStore.setSessionFileCount.mockReset();
    mockStreamingStore.clearSessionStreamingState.mockReset();
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

  it('calls streamingStore.clearSessionStreamingState after 2s delay when session stops', async () => {
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
    expect(mockStreamingStore.clearSessionStreamingState).not.toHaveBeenCalled();

    // After 2 seconds
    vi.advanceTimersByTime(2000);

    expect(mockStreamingStore.clearSessionStreamingState).toHaveBeenCalledWith('session-1');
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

    // clearSessionStreamingState should NOT have been called because the timeout was cancelled
    expect(mockStreamingStore.clearSessionStreamingState).not.toHaveBeenCalled();
  });

  it('clears streaming state when clear timeout fires (no cancellation)', async () => {
    mockSessionsStore.sessions = [{ id: 'session-1', status: 'running' }];

    wrapper = mount(testComponent, {
      global: { plugins: [createPinia()] },
    });

    await nextTick();

    const sub = mockSubscriptionInstances['session-1'];
    const statusHandler = sub._handlers.onStatus[0];

    statusHandler('completed');
    vi.advanceTimersByTime(2000);

    expect(mockStreamingStore.clearSessionStreamingState).toHaveBeenCalledWith('session-1');
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
});
