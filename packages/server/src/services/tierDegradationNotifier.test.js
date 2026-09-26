import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaleTierEchoRegistry } from './tierDegradationNotifier.js';

describe('StaleTierEchoRegistry', () => {
  afterEach(() => vi.useRealTimers());

  it('removes expired entries even when no follow-up request arrives', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100, maxSize: 3 });

    registry.record('session-a', 'tier::a');
    vi.advanceTimersByTime(100);

    expect(registry.size).toBe(0);
    registry.dispose();
  });

  it('sweeps expired entries before retaining new records and applies deterministic capacity eviction', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100, maxSize: 2 });

    registry.record('expired', 'tier::expired');
    vi.advanceTimersByTime(100);
    registry.record('first', 'tier::first');
    registry.record('second', 'tier::second');
    registry.record('third', 'tier::third');

    expect(registry.size).toBe(2);
    expect(registry.consume('first', 'tier::first')).toBe(false);
    expect(registry.consume('second', 'tier::second')).toBe(true);
    expect(registry.consume('third', 'tier::third')).toBe(true);
    registry.dispose();
  });

  it('does not consume a valid record for a mismatched tier reference', () => {
    const registry = new StaleTierEchoRegistry();
    registry.record('session-a', 'tier::correct');

    expect(registry.consume('session-a', 'tier::wrong')).toBe(false);
    expect(registry.consume('session-a', 'tier::correct')).toBe(true);
    expect(registry.consume('session-a', 'tier::correct')).toBe(false);
    registry.dispose();
  });

  it('clears its scheduled cleanup timer on disposal', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100 });
    registry.record('session-a', 'tier::a');

    registry.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
