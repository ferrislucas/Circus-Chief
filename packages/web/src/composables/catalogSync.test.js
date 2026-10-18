import { describe, expect, it, vi } from 'vitest';
import { createCatalogSync } from './catalogSync.js';

/**
 * One ordering mechanism for every canonical intake source: initial load,
 * websocket invalidation, reconnect, and user-triggered refresh. A slower,
 * older response must never overwrite newer canonical state, no matter
 * which source produced which request.
 */
describe('createCatalogSync', () => {
  function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }

  it('ignores a stale initial-load response that resolves after a manual refresh', async () => {
    const initial = deferred();
    const manual = deferred();
    const fetchCanonical = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(manual.promise);
    const apply = vi.fn();
    const sync = createCatalogSync({ fetchCanonical, applyCanonical: apply });

    const first = sync.refresh();
    const second = sync.refresh();
    manual.resolve({ tiers: ['new'] });
    await second;
    initial.resolve({ tiers: ['stale'] });
    await first;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ tiers: ['new'] }, undefined);
  });

  it('a websocket push wins over an in-flight slower fetch', async () => {
    const slow = deferred();
    const fetchCanonical = vi.fn().mockReturnValue(slow.promise);
    const apply = vi.fn();
    const sync = createCatalogSync({ fetchCanonical, applyCanonical: apply });

    const pending = sync.refresh();
    sync.notifyCanonical({ tiers: ['pushed'] });
    slow.resolve({ tiers: ['stale-fetch'] });
    await pending;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ tiers: ['pushed'] }, undefined);
  });

  it('a reconnect refresh after a push applies the fresher fetch', async () => {
    const fetchCanonical = vi.fn().mockResolvedValue({ tiers: ['reconnect'] });
    const apply = vi.fn();
    const sync = createCatalogSync({ fetchCanonical, applyCanonical: apply });

    sync.notifyCanonical({ tiers: ['pushed'] });
    await sync.refresh();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith({ tiers: ['reconnect'] }, undefined);
  });

  it('repeated reconnects resolve in request order without late writes', async () => {
    const first = deferred();
    const second = deferred();
    const fetchCanonical = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const apply = vi.fn();
    const sync = createCatalogSync({ fetchCanonical, applyCanonical: apply });

    const r1 = sync.refresh();
    const r2 = sync.refresh();
    second.resolve({ tiers: ['second'] });
    await r2;
    first.resolve({ tiers: ['first'] });
    await r1;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ tiers: ['second'] }, undefined);
  });

  it('dispose stops late responses from applying (unmount safety)', async () => {
    const slow = deferred();
    const fetchCanonical = vi.fn().mockReturnValue(slow.promise);
    const apply = vi.fn();
    const sync = createCatalogSync({ fetchCanonical, applyCanonical: apply });

    const pending = sync.refresh();
    sync.dispose();
    sync.notifyCanonical({ tiers: ['too-late'] });
    slow.resolve({ tiers: ['too-late'] });
    await pending;

    expect(apply).not.toHaveBeenCalled();
  });
});
