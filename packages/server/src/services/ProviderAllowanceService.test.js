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
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
    };

    service.observe(snapshot);
    expect(broadcaster).toHaveBeenCalledWith(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, { snapshot });
    expect(service.getSnapshots()).toEqual({ snapshots: [snapshot], activeProviderIds: [] });
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
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
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
        { key: 'zero', remaining: 0, limit: null, remainingPercent: null, resetsAt: null },
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

  it('prioritizes executing-session providers, then attention providers, using configured order as a tiebreaker', () => {
    const providers = [
      { id: 'provider-a', name: 'A', kind: 'openai', enabled: true },
      { id: 'provider-b', name: 'B', kind: 'openai', enabled: true },
      { id: 'provider-c', name: 'C', kind: 'openai', enabled: true },
      { id: 'provider-d', name: 'D', kind: 'openai', enabled: true },
    ];
    const getExecutingProviderIds = vi.fn(() => ['provider-b']);
    const getActiveAndWaiting = vi.fn(() => [{ id: 'idle-c', providerId: 'provider-c' }]);
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => providers },
      sessionRepository: {
        getExecutingProviderIds,
        getActiveAndWaiting,
      },
    });

    service.observe({
      providerId: 'provider-c', providerName: 'C', providerKind: 'openai',
      status: 'exhausted', source: 'provider', updatedAt: 1, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 0, limit: 100, remainingPercent: 0, unit: 'requests', resetsAt: null }],
    });

    expect(service.getSnapshots().snapshots.map(({ providerId }) => providerId)).toEqual([
      'provider-b', 'provider-c', 'provider-a', 'provider-d',
    ]);
    expect(getExecutingProviderIds).toHaveBeenCalledOnce();
    expect(getActiveAndWaiting).not.toHaveBeenCalled();
  });

  it('marks cached snapshots stale at read time while retaining their last-known values', () => {
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [enabled] }, clock: { now: () => 10 } });
    service.observe({
      providerId: enabled.id, providerName: enabled.name, providerKind: enabled.kind,
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 5, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    });

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'stale', updatedAt: 1, staleAt: 5, allowances: [{ remaining: 25, limit: 100 }] });
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

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'stale', staleAt: 6 });
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

    expect(service.getSnapshots().snapshots[0]).toMatchObject({ status: 'stale', staleAt: -4_999 });
  });
});
