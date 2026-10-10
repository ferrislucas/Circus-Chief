import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const wsHandlers = {};
let reconnectCallback;

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((type, cb) => { wsHandlers[type] = cb; }),
    off: vi.fn((type) => { delete wsHandlers[type]; }),
    onReconnect: vi.fn((cb) => { reconnectCallback = cb; return () => {}; }),
  }),
}));

import { useCanonicalSync } from './useCanonicalSync.js';

function mountSync(options) {
  let api;
  const Host = defineComponent({
    setup() {
      api = useCanonicalSync(options);
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wrapper, api: () => api };
}

describe('useCanonicalSync', () => {
  beforeEach(() => {
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    reconnectCallback = undefined;
    vi.clearAllMocks();
  });

  it('refresh applies the newest overlapping response and notifies settlement', async () => {
    let resolveFirst;
    let resolveSecond;
    const fetchCanonical = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    const applyCanonical = vi.fn();
    const onSettled = vi.fn();
    const { api } = mountSync({
      fetchCanonical,
      applyCanonical,
      messageType: 'test:updated',
      selectPush: () => undefined,
      onSettled,
    });

    const first = api().refresh();
    const second = api().refresh();
    resolveSecond({ v: 2 });
    await second;
    resolveFirst({ v: 1 });
    await first;

    expect(applyCanonical).toHaveBeenCalledTimes(1);
    expect(applyCanonical).toHaveBeenCalledWith({ v: 2 }, undefined);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it('routes inline websocket payloads to notify and refetches name-only pushes', async () => {
    const fetchCanonical = vi.fn().mockResolvedValue({ v: 'refetched' });
    const applyCanonical = vi.fn();
    mountSync({
      fetchCanonical,
      applyCanonical,
      messageType: 'test:updated',
      selectPush: (message) => {
        if (message?.inline) return { notify: message.inline };
        if (message?.refetch) return { options: { preserveEdits: true } };
        return undefined;
      },
    });
    await flushPromises();

    wsHandlers['test:updated']({ inline: { v: 'pushed' } });
    expect(applyCanonical).toHaveBeenCalledWith({ v: 'pushed' }, undefined);

    wsHandlers['test:updated']({ refetch: true });
    await flushPromises();
    // The composable never fetches on mount — editors trigger the initial
    // refresh themselves — so only the push-triggered refetch ran.
    expect(fetchCanonical).toHaveBeenCalledTimes(1);
    expect(applyCanonical).toHaveBeenLastCalledWith({ v: 'refetched' }, { preserveEdits: true });

    wsHandlers['test:updated']({ unrelated: true });
    expect(fetchCanonical).toHaveBeenCalledTimes(1);
  });

  it('reconnect refreshes and unmount disposes late writes', async () => {
    const resolvers = [];
    const fetchCanonical = vi.fn().mockImplementation(() => new Promise((r) => { resolvers.push(r); }));
    const applyCanonical = vi.fn();
    const { wrapper, api } = mountSync({
      fetchCanonical,
      applyCanonical,
      messageType: 'test:updated',
      selectPush: () => undefined,
    });

    const pending = api().refresh();
    const restarted = reconnectCallback();
    resolvers[1]({ v: 'reconnect' });
    await restarted;
    wrapper.unmount();
    resolvers[0]({ v: 'late' });
    await pending;

    // The reconnect refresh applied; the stale initial response did not
    // write after unmount.
    expect(applyCanonical).toHaveBeenCalledTimes(1);
    expect(applyCanonical).toHaveBeenCalledWith({ v: 'reconnect' }, { preserveEdits: true });
  });

  it('uses the shared message type constants', () => {
    expect(WS_MESSAGE_TYPES.TEMPLATE_UPDATED).toBe('template:updated');
  });
});
