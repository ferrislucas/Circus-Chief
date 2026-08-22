import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  useProjectListRealtime,
} from './useProjectListRealtime.js';
import {
  WORKSPACE_LIST_REFRESH_DELAY_MS,
} from './useWorkspaceListRealtime.js';
import {
  useProjectSubscription,
  projectSubscriptionCounts,
  projectSubscriptionIds,
} from './useProjectSubscription.js';

// Shared transport state, hoisted so the mock factory and the assertions below
// both see the same objects.
const { send, on, off, listeners, reconnectHandlers, fetchProjects } = vi.hoisted(() => ({
  send: vi.fn(),
  on: vi.fn((type, handler) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
  }),
  off: vi.fn((type, handler) => {
    listeners.get(type)?.delete(handler);
  }),
  listeners: new Map(),
  reconnectHandlers: new Set(),
  fetchProjects: vi.fn(),
}));

// Mock only the socket transport; useProjectSubscription (the real module)
// depends on it for send/on/off and keeps its dedup counters intact.
vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    send,
    on,
    off,
    onReconnect: (callback) => {
      reconnectHandlers.add(callback);
      return () => reconnectHandlers.delete(callback);
    },
  }),
}));

vi.mock('../stores/projects.js', () => ({
  useProjectsStore: () => ({ fetchProjects }),
}));

function mountList(projectIds) {
  return mount(defineComponent({
    setup() {
      useProjectListRealtime(projectIds);
    },
    template: '<div />',
  }));
}

function emitProjectEvent(type, projectId) {
  const handlers = listeners.get(type);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    handler({ type, projectId, session: { id: 's-1' }, sessionId: 's-1' });
  }
}

describe('useProjectListRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    send.mockReset();
    on.mockClear();
    off.mockClear();
    fetchProjects.mockReset();
    fetchProjects.mockResolvedValue(undefined);
    listeners.clear();
    reconnectHandlers.clear();
    projectSubscriptionCounts.clear();
    projectSubscriptionIds.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to every loaded project and unsubscribes them all on unmount', () => {
    const wrapper = mountList(ref(['a', 'b']));

    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId: 'a' });
    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId: 'b' });

    wrapper.unmount();

    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: 'a' });
    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: 'b' });
  });

  it('does not re-send SUBSCRIBE_PROJECT for a project another consumer already subscribed to', () => {
    const other = useProjectSubscription('a');
    other.subscribe();
    send.mockClear();

    const wrapper = mountList(ref(['a']));

    expect(send).not.toHaveBeenCalledWith(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId: 'a' });

    wrapper.unmount();
    other.unsubscribe();
  });

  it('does not tear down a subscription still used by another consumer', () => {
    const wrapper = mountList(ref(['a']));
    const other = useProjectSubscription('a');
    other.subscribe();

    wrapper.unmount();

    expect(send).not.toHaveBeenCalledWith(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: 'a' });
    expect(projectSubscriptionCounts.get('a')).toBe(1);

    other.unsubscribe();
  });

  it('re-subscribes when the project set changes', async () => {
    const ids = ref(['a']);
    const wrapper = mountList(ids);

    ids.value = ['a', 'b'];
    await nextTick();
    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId: 'b' });

    ids.value = ['b'];
    await nextTick();
    expect(send).toHaveBeenCalledWith(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: 'a' });

    wrapper.unmount();
  });

  it('coalesces a burst of session events into one silent refetch', async () => {
    const wrapper = mountList(ref(['a']));

    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_UPDATED, 'a');
    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_CREATED, 'a');
    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_DELETED, 'a');

    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(fetchProjects).toHaveBeenCalledTimes(1);
    expect(fetchProjects).toHaveBeenCalledWith({ silent: true });
    wrapper.unmount();
  });

  it('does not register SESSION_STATUS (project subscribers receive SESSION_UPDATED)', () => {
    const wrapper = mountList(ref(['a']));

    // SESSION_STATUS is delivered to session-subscribers only; the server sends
    // status transitions to project subscribers as SESSION_UPDATED. Registering
    // onSessionStatus would never fire, so the composable must not register it.
    expect(listeners.get(WS_MESSAGE_TYPES.SESSION_STATUS)).toBeUndefined();

    wrapper.unmount();
  });

  it('backs off the debounce under sustained events', async () => {
    const wrapper = mountList(ref(['a']));

    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_UPDATED, 'a');
    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_CREATED, 'a');
    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_DELETED, 'a');
    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_UPDATED, 'a');

    // The double-length delay means the base window alone is not enough.
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(fetchProjects).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(fetchProjects).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('refetches on reconnect', async () => {
    const wrapper = mountList(ref(['a']));

    for (const callback of [...reconnectHandlers]) callback();

    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(fetchProjects).toHaveBeenCalledWith({ silent: true });
    wrapper.unmount();
  });

  it('never refreshes after unmount', async () => {
    const wrapper = mountList(ref(['a']));

    emitProjectEvent(WS_MESSAGE_TYPES.SESSION_UPDATED, 'a');
    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS * 4);
    expect(fetchProjects).not.toHaveBeenCalled();
  });
});