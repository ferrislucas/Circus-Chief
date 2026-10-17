import { describe, expect, it, vi } from 'vitest';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';

const enabled = { id: 'openai-default', name: 'OpenAI', kind: 'openai', enabled: true };
const disabled = { id: 'google-default', name: 'Google', kind: 'google', enabled: false };

describe('ProviderAllowanceService', () => {
  it('returns an explicit unknown snapshot for every enabled provider', () => {
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled, disabled] },
    });

    expect(service.getSnapshots()).toEqual(expect.objectContaining({ snapshots: [expect.objectContaining({
      providerId: enabled.id,
      providerName: enabled.name,
      status: 'unknown',
      allowances: [],
      source: null,
      unavailableReason: expect.stringContaining('No verified'),
    })], activeProviderIds: [] }));
  });

  it('broadcasts a normalized changed snapshot without provider configuration', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] }, broadcaster,
    });
    const snapshot = {
      providerId: enabled.id, providerName: enabled.name, providerKind: 'openai',
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, value: 25, valueKind: 'remaining', limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
    };

    service.observe(snapshot);
    expect(broadcaster).toHaveBeenCalledWith(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, { snapshot: { ...snapshot, stale: false, lastUsedAt: null } });
    expect(service.getSnapshots()).toEqual({ snapshots: [{ ...snapshot, stale: false, lastUsedAt: null }], activeProviderIds: [] });
  });

  it('normalizes inconsistent adapter measurements and broadcasts only the canonical snapshot', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] }, broadcaster,
    });

    const received = service.observe({
      providerId: enabled.id, providerName: 'Adapter supplied name', providerKind: enabled.kind,
      status: 'available', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{
        key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 90,
        unit: 'requests', resetsAt: 3, accountEmail: 'private@example.test',
      }],
      credentials: { token: 'secret-sentinel' },
    });

    const expected = {
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, stale: false, lastUsedAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, value: 25, valueKind: 'remaining', limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
    };
    expect(received).toEqual(expected);
    expect(service.getSnapshots()).toEqual({ snapshots: [expected], activeProviderIds: [] });
    expect(broadcaster).toHaveBeenCalledWith(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, { snapshot: expected });
  });

  it('rejects any candidate whose providerKind contradicts the target provider', () => {
    const broadcaster = vi.fn();
    const anthropic = { id: 'anthropic-default', name: 'Claude', kind: 'anthropic', enabled: true };
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [anthropic] }, broadcaster,
    });
    const candidate = {
      providerId: anthropic.id, providerName: anthropic.name, providerKind: 'openai',
      status: 'available', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: 25, limit: 100, remainingPercent: 25, unit: 'tokens', resetsAt: null }],
    };

    expect(service.observe(candidate)).toBeNull();
    expect(broadcaster).not.toHaveBeenCalled();
    expect(service.getSnapshots().snapshots[0]).toMatchObject({ providerKind: 'anthropic', status: 'unknown' });

    // A matching kind stores, and a kind-less candidate (a future
    // configured-budget source) is accepted, not penalized for omitting it.
    expect(service.observe({ ...candidate, providerKind: anthropic.kind })).toMatchObject({ providerKind: 'anthropic', status: 'warning' });
    expect(broadcaster).toHaveBeenCalledTimes(1);
    expect(service.observe({ ...candidate, providerKind: undefined, source: 'configured' })).toMatchObject({ providerKind: 'anthropic', status: 'warning' });
  });

  it('does not trust unusable measurements but honors an authoritative status hint', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'exhausted', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [
        { key: 'zero', label: 'Zero', remaining: -4, limit: 0, remainingPercent: -10, unit: 'requests', resetsAt: 'bad' },
        { key: 'missing', label: 'Missing', remaining: 5, limit: null, remainingPercent: 150, unit: 'requests', resetsAt: null },
      ],
    })).toMatchObject({
      status: 'exhausted',
      allowances: [
        { key: 'zero', remaining: null, limit: null, remainingPercent: null, resetsAt: null },
        { key: 'missing', remaining: 5, limit: null, remainingPercent: null, resetsAt: null },
      ],
    });
  });

  it.each([
    ['exhausted at zero', 0, 'exhausted'],
    ['critical above zero', 0.1, 'critical'],
    ['critical at the 10% boundary', 10, 'critical'],
    ['warning above 10%', 10.1, 'warning'],
    ['warning at the 25% boundary', 25, 'warning'],
    ['available above 25%', 25.1, 'available'],
    ['available at a representative healthy value', 50, 'available'],
  ])('derives %s from clamped authoritative percentages', (_caseName, remaining, status) => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });
    const observeRemaining = (remainingAmount) => service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'unknown', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: remainingAmount, limit: 100, remainingPercent: 99, unit: 'requests', resetsAt: null }],
    });

    expect(observeRemaining(remaining)).toMatchObject({ status, allowances: [{ remainingPercent: remaining }] });
  });

  it('orders snapshots by most-recently-used provider with never-used providers last', () => {
    const providers = [
      { id: 'provider-a', name: 'A', kind: 'openai', enabled: true },
      { id: 'provider-b', name: 'B', kind: 'openai', enabled: true },
      { id: 'provider-c', name: 'C', kind: 'openai', enabled: true },
      { id: 'provider-d', name: 'D', kind: 'openai', enabled: true },
    ];
    // provider-b is executing, but recency — not liveness — owns dialog
    // order now. The response keeps activeProviderIds for badge/trigger and
    // probe-gating consumers; it is no longer an ordering input.
    const getExecutingProviderIds = vi.fn(() => ['provider-b']);
    const getProviderLastUsedAt = vi.fn(() => ({ 'provider-c': 2000, 'provider-a': 1000 }));
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => providers },
      sessionRepository: { getExecutingProviderIds, getProviderLastUsedAt },
    });

    service.observe({
      providerId: 'provider-c', providerName: 'C', providerKind: 'openai',
      status: 'exhausted', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 0, limit: 100, remainingPercent: 0, unit: 'requests', resetsAt: null }],
    });

    const snapshots = service.getSnapshots();
    expect(snapshots.snapshots.map(({ providerId }) => providerId)).toEqual([
      'provider-c', 'provider-a', 'provider-b', 'provider-d',
    ]);
    expect(snapshots.snapshots).toMatchObject([
      { lastUsedAt: 2000 }, { lastUsedAt: 1000 }, { lastUsedAt: null }, { lastUsedAt: null },
    ]);
    expect(snapshots.activeProviderIds).toEqual(['provider-b']);
    expect(getProviderLastUsedAt).toHaveBeenCalled();
    expect(getExecutingProviderIds).toHaveBeenCalledOnce();
  });

  it('preserves configured order for equal recency timestamps', () => {
    const providers = [
      { id: 'provider-a', name: 'A', kind: 'openai', enabled: true },
      { id: 'provider-b', name: 'B', kind: 'openai', enabled: true },
      { id: 'provider-c', name: 'C', kind: 'openai', enabled: true },
    ];
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => providers },
      sessionRepository: {
        getExecutingProviderIds: () => [],
        getProviderLastUsedAt: () => ({ 'provider-a': 1000, 'provider-b': 1000 }),
      },
    });

    expect(service.getSnapshots().snapshots.map(({ providerId }) => providerId)).toEqual([
      'provider-a', 'provider-b', 'provider-c',
    ]);
  });

  it('preserves the stored lastUsedAt across observations and broadcasts the stamped snapshot', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] },
      sessionRepository: { getProviderLastUsedAt: () => ({ [enabled.id]: 500 }) },
      broadcaster,
    });
    const candidate = {
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    };

    // First sighting stamps recency from the session-domain projection.
    expect(service.observe(candidate)).toMatchObject({ lastUsedAt: 500 });
    expect(broadcaster).toHaveBeenCalledWith(
      WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED,
      { snapshot: expect.objectContaining({ lastUsedAt: 500 }) },
    );

    // Allowance frames are not a usage signal: a candidate carrying its own
    // recency — or none at all — never resets the stored value.
    broadcaster.mockClear();
    expect(service.observe({ ...candidate, lastUsedAt: 9999 })).toMatchObject({ lastUsedAt: 500 });
    expect(broadcaster).not.toHaveBeenCalled();
    expect(service.observe({ ...candidate, status: 'critical', allowances: [{ ...candidate.allowances[0], remaining: 5, remainingPercent: 5 }] }))
      .toMatchObject({ lastUsedAt: 500, status: 'critical' });
  });

  it('serves the live session projection when it is newer than the stored stamp', () => {
    // An observation freezes the projection value of that moment. Session
    // activity after the observation must still move the provider: reads
    // prefer the live projection, keeping the stored stamp only for
    // providers with no session rows at all.
    let projection = { [enabled.id]: 500 };
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] },
      sessionRepository: { getProviderLastUsedAt: () => projection },
    });
    const candidate = {
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    };

    expect(service.observe(candidate)).toMatchObject({ lastUsedAt: 500 });

    projection = { [enabled.id]: 900 };
    expect(service.getSnapshots().snapshots[0]).toMatchObject({ lastUsedAt: 900 });

    // Providers with no session rows keep their last-known stamp instead of
    // resetting to null.
    projection = {};
    expect(service.getSnapshots().snapshots[0]).toMatchObject({ lastUsedAt: 500 });
  });

  it('marks cached snapshots stale at read time while retaining their last-known values', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] }, clock: { now: () => 10 } });
    service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 5, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    });

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'warning', stale: true, updatedAt: 1, staleAt: 5, allowances: [{ remaining: 25, limit: 100 }] });
  });

  it('sorts a fresh-available provider above a stale-critical idle one while keeping the stale overlay', () => {
    // Intentional inversion of the old attention-first order: recency owns
    // dialog order now. Staleness stays an overlay — the idle provider still
    // reads as stale-critical for trigger, badge, and announcements.
    const providers = [
      { id: 'provider-a', name: 'A', kind: 'openai', enabled: true },
      { id: 'provider-b', name: 'B', kind: 'openai', enabled: true },
    ];
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => providers },
      sessionRepository: { getProviderLastUsedAt: () => ({ 'provider-a': 9000, 'provider-b': 1000 }) },
      clock: { now: () => 10 },
    });
    service.observe({
      providerId: 'provider-a', providerName: 'A', providerKind: 'openai',
      status: 'available', source: 'provider', updatedAt: 9, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 90, limit: 100, remainingPercent: 90, unit: 'requests', resetsAt: null }],
    });
    service.observe({
      providerId: 'provider-b', providerName: 'B', providerKind: 'openai',
      status: 'critical', source: 'provider', updatedAt: 1, staleAt: 5, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 5, limit: 100, remainingPercent: 5, unit: 'requests', resetsAt: null }],
    });

    const snapshots = service.getSnapshots().snapshots;
    expect(snapshots.map(({ providerId }) => providerId)).toEqual(['provider-a', 'provider-b']);
    expect(snapshots[1]).toMatchObject({ status: 'critical', stale: true, lastUsedAt: 1000 });
    expect(snapshots[0]).toMatchObject({ status: 'available', lastUsedAt: 9000 });
  });

  it('broadcasts the freshness-aged snapshot when the observation is already stale', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] }, broadcaster, clock: { now: () => 10 },
    });
    const received = service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 5, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    });

    // The store keeps the un-aged snapshot; the wire carries the stale overlay.
    expect(received).toMatchObject({ status: 'warning', stale: false, updatedAt: 1, staleAt: 5 });
    expect(broadcaster).toHaveBeenCalledWith(
      WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED,
      { snapshot: expect.objectContaining({ status: 'warning', stale: true, updatedAt: 1, staleAt: 5 }) },
    );
    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'warning', stale: true });
  });

  it('does not retain or broadcast allowance updates for disabled or unknown providers', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled, disabled] }, broadcaster });
    const valid = {
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 2, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    };

    expect(service.observe({ ...valid, providerId: disabled.id })).toBeNull();
    expect(service.observe({ ...valid, providerId: 'missing' })).toBeNull();
    expect(broadcaster).not.toHaveBeenCalled();
    service.observe(valid);
    service.observe({ allowances: valid.allowances, unavailableReason: null, staleAt: 2, updatedAt: 1, source: 'provider', status: 'warning', providerKind: enabled.kind, providerName: enabled.name, providerId: enabled.id });
    expect(broadcaster).toHaveBeenCalledTimes(1);
    service.observe({ ...valid, allowances: [{ ...valid.allowances[0], remaining: 5, remainingPercent: 5 }] });
    expect(broadcaster).toHaveBeenCalledTimes(2);
  });

  it('accepts a percentage-only subscription allowance and derives status from it', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    // Subscription sources report utilization percent only (no absolute
    // counts). The server converts consumed → remaining (AC 14 is the
    // adapter's job); the service accepts the clamped result as authoritative.
    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'unknown', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: 18, unit: 'tokens', resetsAt: 2 }],
    })).toMatchObject({ status: 'warning', allowances: [{ remaining: null, limit: null, remainingPercent: 18 }] });
  });

  it.each([-5, 140, Number.NaN, '62', null])('rejects the out-of-range adapter percentage %p as untrusted input', (untrusted) => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'unknown', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: untrusted, unit: 'tokens', resetsAt: null }],
    })).toMatchObject({ status: 'unknown', allowances: [{ remainingPercent: null }] });
  });

  it('prefers the percentage derived from absolutes over an adapter-supplied one', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'unknown', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'tokens', label: 'Tokens', remaining: 25, limit: 100, remainingPercent: 90, unit: 'tokens', resetsAt: null }],
    })).toMatchObject({ status: 'warning', allowances: [{ remainingPercent: 25 }] });
  });

  it.each([
    ['exhausted', 'exhausted'],
    ['warning', 'warning'],
    ['available', 'available'],
  ])('keeps a status-only snapshot (%s) with its reset time and no fabricated percentage', (hint, expected) => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: hint, source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: null, unit: 'tokens', resetsAt: 1_800_000_000_000 }],
    })).toMatchObject({
      status: expected,
      allowances: [{ remaining: null, limit: null, remainingPercent: null, resetsAt: 1_800_000_000_000 }],
    });
  });

  it('collapses a status-only snapshot with an invalid status hint to unknown', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'kaboom', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: null, unit: 'tokens', resetsAt: null }],
    })).toMatchObject({ status: 'unknown' });
  });

  it('lets authoritative percentages win over a status hint', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });

    expect(service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'rejected', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: 50, unit: 'tokens', resetsAt: null }],
    })).toMatchObject({ status: 'available' });
  });

  it('applies freshness to status-only snapshots', () => {
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] },
      clock: { now: () => 10 },
    });

    service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'exhausted', source: 'provider', updatedAt: 1, staleAfterMs: 5, unavailableReason: null,
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: null, unit: 'tokens', resetsAt: null }],
    });

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'exhausted', stale: true, staleAt: 6 });
  });

  it('marks an observation with an already-past reset stale immediately', () => {
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] },
      clock: { now: () => 10 },
    });

    service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'available', source: 'observed-header', updatedAt: 1, staleAfterMs: -5_000, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 75, limit: 100, remainingPercent: 75, unit: 'requests', resetsAt: -4_999 }],
    });

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'available', stale: true, staleAt: -4_999 });
  });

  describe('getSnapshot', () => {
    const observed = {
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
    };

    it('returns the stored normalized snapshot after observe', () => {
      const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });
      const stored = service.observe(observed);

      expect(service.getSnapshot(enabled.id)).toEqual(stored);
    });

    it('returns null for an unknown provider id', () => {
      const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });
      service.observe(observed);

      expect(service.getSnapshot('no-such-provider')).toBeNull();
    });

    it('returns an equal but not identical copy on each call', () => {
      const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });
      service.observe(observed);

      const first = service.getSnapshot(enabled.id);
      const second = service.getSnapshot(enabled.id);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first.allowances).not.toBe(second.allowances);
    });

    it('isolates stored state from mutations of a returned snapshot', () => {
      const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] } });
      service.observe(observed);

      const snapshot = service.getSnapshot(enabled.id);
      snapshot.allowances.push({
        key: 'injected', label: 'Injected', remaining: 0, value: 0, valueKind: 'remaining',
        limit: 100, remainingPercent: 0, unit: 'requests', resetsAt: null,
      });
      snapshot.status = 'exhausted';

      const reread = service.getSnapshot(enabled.id);
      expect(reread.allowances).toHaveLength(1);
      expect(reread.status).toBe('warning');
    });

    it('reads without broadcasting and without mutating the stored snapshot', () => {
      const broadcaster = vi.fn();
      const service = new ProviderAllowanceService({
        providerRepository: { getAll: () => [enabled] }, broadcaster,
      });
      const stored = service.observe(observed);
      broadcaster.mockClear();

      const first = service.getSnapshot(enabled.id);
      const second = service.getSnapshot(enabled.id);

      expect(first).toEqual(stored);
      expect(second).toEqual(stored);
      expect(broadcaster).not.toHaveBeenCalled();
    });

    it('still returns a stored snapshot for a disabled provider', () => {
      const google = { id: 'google-default', name: 'Google', kind: 'google', enabled: true };
      const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [google] } });
      const stored = service.observe({
        providerId: google.id, providerName: google.name, providerKind: google.kind,
        status: 'available', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
        allowances: [{ key: 'requests', label: 'Requests', remaining: 75, limit: 100, remainingPercent: 75, unit: 'requests', resetsAt: null }],
      });
      // Provider is now disabled: the list prunes it, but the read-only
      // getter still serves the stored snapshot.
      service.providerRepository = { getAll: () => [{ ...google, enabled: false }] };

      expect(service.getSnapshot(google.id)).toEqual(stored);
    });
  });
});
