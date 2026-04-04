import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';

// vi.hoisted runs BEFORE vi.mock factories, so these refs are available
// when useWebSocket (and useConnectionStatus's module-level code) first executes.
const { mockConnectionStatus, mockReconnectAttempt } = vi.hoisted(() => {
  const { ref: hoistedRef } = require('vue');
  return {
    mockConnectionStatus: hoistedRef('connected'),
    mockReconnectAttempt: hoistedRef(0),
  };
});

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

// Import after mock is set up. Because useConnectionStatus.js now
// runs its singleton watcher at module-level, the mock must be ready first.
import { useConnectionStatus, WS_DISCONNECT_DISPLAY_DELAY } from './useConnectionStatus.js';

describe('useConnectionStatus', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    // Reset shared refs to defaults — this triggers the singleton watcher
    mockConnectionStatus.value = 'connected';
    mockReconnectAttempt.value = 0;
    await nextTick();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('WS_DISCONNECT_DISPLAY_DELAY is exported as 2000', () => {
    expect(WS_DISCONNECT_DISPLAY_DELAY).toBe(2000);
  });

  it('exposes connectionStatus from useWebSocket', () => {
    const result = useConnectionStatus();
    expect(result.connectionStatus).toBe(mockConnectionStatus);
  });

  it('exposes reconnectAttempt from useWebSocket', () => {
    const result = useConnectionStatus();
    expect(result.reconnectAttempt).toBe(mockReconnectAttempt);
  });

  it('isStale is false when connected', () => {
    const result = useConnectionStatus();
    expect(result.isStale.value).toBe(false);
  });

  it('all callers share the same singleton refs', () => {
    const a = useConnectionStatus();
    const b = useConnectionStatus();
    expect(a.isStale).toBe(b.isStale);
    expect(a.connectionStatus).toBe(b.connectionStatus);
    expect(a.reconnectAttempt).toBe(b.reconnectAttempt);
  });

  it('isStale remains false during the first 2 seconds after disconnect', async () => {
    const result = useConnectionStatus();

    // Simulate disconnect
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    // Advance time just under the display delay
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY - 1);

    expect(result.isStale.value).toBe(false);
  });

  it('isStale becomes true after WS_DISCONNECT_DISPLAY_DELAY ms of disconnect', async () => {
    const result = useConnectionStatus();

    mockConnectionStatus.value = 'reconnecting';
    await nextTick();

    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY);

    expect(result.isStale.value).toBe(true);
  });

  it('isStale stays false if connection recovers within WS_DISCONNECT_DISPLAY_DELAY (timer cancelled)', async () => {
    const result = useConnectionStatus();

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
  });

  it('isStale becomes false immediately on reconnect after being stale', async () => {
    const result = useConnectionStatus();

    // Disconnect and wait for stale
    mockConnectionStatus.value = 'reconnecting';
    await nextTick();
    vi.advanceTimersByTime(WS_DISCONNECT_DISPLAY_DELAY);
    expect(result.isStale.value).toBe(true);

    // Reconnect
    mockConnectionStatus.value = 'connected';
    await nextTick();

    expect(result.isStale.value).toBe(false);
  });

  it('does not start a second timer if already timing', async () => {
    const result = useConnectionStatus();

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
  });
});
