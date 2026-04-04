import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, defineComponent, nextTick } from 'vue';
import { WS_DISCONNECT_DISPLAY_DELAY } from '@claudetools/shared';

// Reactive refs shared across the mock and test code
const mockConnectionStatus = ref('connected');
const mockReconnectAttempt = ref(0);

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    connectionStatus: mockConnectionStatus,
    reconnectAttempt: mockReconnectAttempt,
    isConnected: { value: true },
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    clearSessionBuffer: vi.fn(),
    onReconnect: vi.fn(() => vi.fn()),
  }),
}));

import { useConnectionStatus } from './useConnectionStatus.js';

/**
 * Mount the composable inside a tiny wrapper component so Vue lifecycle
 * hooks (onUnmounted) have a proper component context.
 */
function mountComposable() {
  let result;
  const wrapper = mount(defineComponent({
    setup() {
      result = useConnectionStatus();
      return {};
    },
    render() { return null; },
  }));
  return { result, wrapper };
}

describe('useConnectionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset shared refs to defaults
    mockConnectionStatus.value = 'connected';
    mockReconnectAttempt.value = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes connectionStatus from useWebSocket', () => {
    const { result, wrapper } = mountComposable();
    expect(result.connectionStatus).toBe(mockConnectionStatus);
    wrapper.unmount();
  });

  it('exposes reconnectAttempt from useWebSocket', () => {
    const { result, wrapper } = mountComposable();
    expect(result.reconnectAttempt).toBe(mockReconnectAttempt);
    wrapper.unmount();
  });

  it('isStale is false when connected', () => {
    const { result, wrapper } = mountComposable();
    expect(result.isStale.value).toBe(false);
    wrapper.unmount();
  });

  it('isStale remains false during the first 2 seconds after disconnect', async () => {
    const { result, wrapper } = mountComposable();

    // Simulate disconnect
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    // Advance time just under the display delay
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY - 1);

    expect(result.isStale.value).toBe(false);
    wrapper.unmount();
  });

  it('isStale becomes true after WS_DISCONNECT_DISPLAY_DELAY ms of disconnect', async () => {
    const { result, wrapper } = mountComposable();

    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY);

    expect(result.isStale.value).toBe(true);
    wrapper.unmount();
  });

  it('isStale stays false if connection recovers within WS_DISCONNECT_DISPLAY_DELAY (timer cancelled)', async () => {
    const { result, wrapper } = mountComposable();

    // Disconnect
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    // Advance part-way
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY - 500);
    expect(result.isStale.value).toBe(false);

    // Reconnect before the timer fires
    mockConnectionStatus.value = 'connected';
    await nextTick();

    // Advance past when the timer would have fired
    vi.advanceTimersByTime(1000);

    // isStale should still be false because the timer was cancelled
    expect(result.isStale.value).toBe(false);
    wrapper.unmount();
  });

  it('isStale becomes false immediately on reconnect after being stale', async () => {
    const { result, wrapper } = mountComposable();

    // Disconnect and wait for stale
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY);
    expect(result.isStale.value).toBe(true);

    // Reconnect
    mockConnectionStatus.value = 'connected';
    await nextTick();

    expect(result.isStale.value).toBe(false);
    wrapper.unmount();
  });

  it('does not start a second timer if already timing', async () => {
    const { result, wrapper } = mountComposable();

    // First disconnect
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    // Advance part-way
    vi.advanceTimersByTime(1000);

    // Trigger same status again (should not restart timer)
    mockConnectionStatus.value = 'disconnected';
    await nextTick();

    // Advance to the original timer expiry
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY - 1000);

    // Should be stale based on original timer, not the second status change
    expect(result.isStale.value).toBe(true);
    wrapper.unmount();
  });

  it('clears debounce timer on unmount', async () => {
    const { result, wrapper } = mountComposable();

    // Disconnect to start the timer
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    // Unmount before timer fires
    wrapper.unmount();

    // Advance past the timer
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY + 1000);

    // isStale should still be false because the timer was cleaned up
    expect(result.isStale.value).toBe(false);
  });
});
