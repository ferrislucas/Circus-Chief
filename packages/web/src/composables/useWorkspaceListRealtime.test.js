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
    emit(name, ...args) {
      handlers[name]?.callback(...args);
    },
  };
  for (const name of [
    'onSessionCreated', 'onSessionUpdated', 'onSessionDeleted',
    'onSessionSummaryUpdated', 'onSessionMessage',
    'onCommandRunStarted', 'onCommandRunComplete', 'onCommandRunError',
    'onCommandRunKilled', 'onCommandRunDeleted', 'onKanbanBoardUpdated', 'onKanbanCardMoved',
    'onKanbanCardAdded', 'onKanbanCardRemoved',
  ]) {
    subscription[name] = vi.fn((callback) => {
      const registration = {
        active: true,
        callback: (...args) => registration.active && callback(...args),
      };
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

function mountRealtime(projectId, refresh, isRefreshInFlight, patchEvent, refreshCard) {
  return mount(defineComponent({
    setup() {
      useWorkspaceListRealtime(projectId, refresh, { isRefreshInFlight, patchEvent, refreshCard });
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

  it('coalesces a burst of membership events into one refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealtime(ref('project-a'), refresh);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onSessionUpdated');
    subscription.emit('onSessionDeleted');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('project-a');
    wrapper.unmount();
  });

  it('patches command-run events locally without issuing a list request', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const patchEvent = vi.fn(() => 'card-1');
    const wrapper = mountRealtime(ref('project-a'), refresh, undefined, patchEvent);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onCommandRunStarted', 'run-1', 'session-1', 'build');
    subscription.emit('onCommandRunComplete', {
      runId: 'run-1', sessionId: 'session-1', buttonId: 'build', exitCode: 0, status: 'completed',
    });
    subscription.emit('onCommandRunError', 'run-2', 'session-1', 'build', 'boom');
    subscription.emit('onCommandRunKilled', { runId: 'run-3', sessionId: 'session-1', buttonId: 'build' });
    subscription.emit('onCommandRunDeleted', 'run-4', 'session-1', 'build');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS * 4);

    expect(patchEvent).toHaveBeenCalledTimes(5);
    expect(refresh).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('patches summary events locally without issuing a list request', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const patchEvent = vi.fn(() => 'card-1');
    const wrapper = mountRealtime(ref('project-a'), refresh, undefined, patchEvent);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onSessionSummaryUpdated');
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS * 4);

    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('reconciles session updates through a targeted card request', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const refreshCard = vi.fn().mockResolvedValue('card-1');
    const wrapper = mountRealtime(ref('project-a'), refresh, undefined, undefined, refreshCard);
    subscriptions.get('project-a').emit('onSessionUpdated', { id: 'child-1', status: 'running' });
    await Promise.resolve();
    expect(refreshCard).toHaveBeenCalledWith('child-1');
    expect(refresh).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('refreshes the list when a session update belongs to an unloaded card', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const refreshCard = vi.fn().mockResolvedValue(null);
    const wrapper = mountRealtime(ref('project-a'), refresh, undefined, undefined, refreshCard);

    subscriptions.get('project-a').emit('onSessionUpdated', { id: 'session-9', status: 'running' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(refreshCard).toHaveBeenCalledWith('session-9');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('project-a');
    wrapper.unmount();
  });

  it('falls back to a debounced refresh when a patched session is unknown', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const patchEvent = vi.fn(() => null);
    const wrapper = mountRealtime(ref('project-a'), refresh, undefined, patchEvent);
    const subscription = subscriptions.get('project-a');

    subscription.emit('onCommandRunComplete', {
      runId: 'run-1', sessionId: 'session-9', buttonId: 'build', exitCode: 0, status: 'completed',
    });
    await vi.advanceTimersByTimeAsync(WORKSPACE_LIST_REFRESH_DELAY_MS);

    expect(patchEvent).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
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
