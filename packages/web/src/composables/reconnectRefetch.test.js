import { describe, expect, it, vi } from 'vitest';
import { createReconnectRefetch } from './reconnectRefetch.js';

describe('createReconnectRefetch', () => {
  it('refetches canonical state on reconnect and ignores a stale overlapping response', async () => {
    let reconnect;
    const onReconnect = vi.fn((callback) => {
      reconnect = callback;
      return vi.fn();
    });
    let resolveFirst;
    let resolveSecond;
    const fetchCanonical = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const apply = vi.fn();
    const reconciliation = createReconnectRefetch({ onReconnect, fetchCanonical, apply });

    const first = reconciliation.refresh();
    const second = reconnect();
    resolveSecond({ model: 'degraded-model', providerId: 'provider-b' });
    await second;
    resolveFirst({ model: 'tier::stale', providerId: null });
    await first;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ model: 'degraded-model', providerId: 'provider-b' });
    reconciliation.dispose();
  });
});
