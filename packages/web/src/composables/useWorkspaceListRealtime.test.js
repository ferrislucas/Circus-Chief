import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import {
  useWorkspaceListRealtime,
  WORKSPACE_LIST_REFRESH_DELAY_MS,
} from './useWorkspaceListRealtime.js';

const subscriptions = new Map();
const reconnectHandlers = new Set();

function createSubscription(projectId) {
  const handlers = {};
  const subscription = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    emit(name) {
      handlers[name]?.callback();
    },
  };
  for (const name of [
    'onSessionCreated', 'onSessionUpdated', 'onSessionDeleted',
    'onSessionSummaryUpdated', 'onSessionMessage', 'onSessionStatus',
    'onCommandRunStarted', 'onCommandRunComplete', 'onCommandRunError',
    'onCommandRunKilled', 'onCommandRunDeleted', 'onKanbanBoardUpdated', 'onKanbanCardMoved',
    'onKanbanCardAdded', 'onKanbanCardRemoved',
  ]) {
    subscription[name] = vi.fn((callback) => {
      const registration = { active: true, callback: () => registration.active && callback() };
      handlers[name] = registration;
      return vi.fn(() => { registration.active = false; });
    });
  }
  subscriptions.set(projectId, subscription);
  return subscription;
}

vi.mock('./useWebSocket.js', () => ({
  useProjectSubscription: vi.fn(projectId => createSubscription(projectId)),
  useWebSocket: vi.fn(() => ({
    onReconnect: vi.fn((callback) => {
      reconnectHandlers.add(callback);
      return () => reconnectHandlers.delete(callback);
    }),
  })),
}));

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function mountRealtime(projectId, refresh, isRefreshInFlight) {
  return mount(defineComponent({
    setup() {
      useWorkspaceListRealtime(projectId, refresh, isRefreshInFlight);
    },
    template: '<div />',
  }));
}

describe('useWorkspaceListRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscriptions.clear();
    reconnectHandlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of relevant events into one refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealtime(ref('project-a'), refresh);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onSessionUpdated');
    subscription.emit('onSessionSummaryUpdated');
    subscription.emit('onCommandRunComplete');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('project-a');
    wrapper.unmount();
  });

  it('produces at most one trailing refresh for events during an in-flight refresh', async () => {
    const first = deferred();
    const refresh = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const wrapper = mountRealtime(ref('project-a'), refresh);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onSessionUpdated');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    subscription.emit('onSessionMessage');
    subscription.emit('onCommandRunStarted');
    subscription.emit('onSessionUpdated');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('performs one trailing refresh when an event joins an already in-flight list load', async () => {
    const initialLoad = deferred();
    let loading = true;
    const refresh = vi.fn()
      .mockImplementationOnce(() => initialLoad.promise)
      .mockResolvedValue(undefined);
    const wrapper = mountRealtime(ref('project-a'), refresh, () => loading);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onSessionUpdated');
    subscription.emit('onSessionMessage');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    loading = false;
    initialLoad.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('replaces subscriptions on project route reuse and ignores old-project events', async () => {
    const projectId = ref('project-a');
    const refresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealtime(projectId, refresh);
    const projectA = subscriptions.get('project-a');

    projectId.value = 'project-b';
    await Promise.resolve();
    const projectB = subscriptions.get('project-b');
    expect(projectA.unsubscribe).toHaveBeenCalledTimes(1);
    expect(projectB.subscribe).toHaveBeenCalledTimes(1);

    projectA.emit('onSessionUpdated');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).not.toHaveBeenCalled();

    projectB.emit('onSessionUpdated');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith('project-b');
    wrapper.unmount();
  });

  it('cleans up handlers, reconnect callback, timer, and subscription on unmount', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealtime(ref('project-a'), refresh);
    const subscription = subscriptions.get('project-a');
    subscription.emit('onSessionUpdated');

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(reconnectHandlers.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
