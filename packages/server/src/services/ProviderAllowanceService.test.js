import { describe, expect, it, vi } from 'vitest';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';

const enabled = { id: 'openai-default', name: 'OpenAI', kind: 'openai', enabled: true };
const disabled = { id: 'google-default', name: 'Google', kind: 'google', enabled: false };

describe('ProviderAllowanceService', () => {
  it('returns an explicit unknown snapshot for every enabled provider', () => {
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled, disabled] },
    });

    expect(service.getSnapshots()).toEqual([expect.objectContaining({
      providerId: enabled.id,
      providerName: enabled.name,
      status: 'unknown',
      allowances: [],
      source: null,
      unavailableReason: expect.stringContaining('No verified'),
    })]);
  });

  it('broadcasts a normalized changed snapshot without provider configuration', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] }, broadcaster,
    });
    const snapshot = {
      providerId: enabled.id, providerName: enabled.name, providerKind: 'openai',
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 2, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt: 3 }],
    };

    service.observe(snapshot);
    expect(broadcaster).toHaveBeenCalledWith('provider:allowance_updated', { snapshot });
    expect(service.getSnapshots()).toEqual([snapshot]);
  });

  it('does not retain or broadcast allowance updates while disabled', () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [enabled] }, broadcaster, isEnabled: () => false,
    });
    const snapshot = {
      providerId: enabled.id, providerName: enabled.name, providerKind: 'openai',
      status: 'warning', source: 'provider', updatedAt: 1, staleAt: 2, unavailableReason: null,
      allowances: [],
    };

    service.observe(snapshot);
    expect(broadcaster).not.toHaveBeenCalled();
    expect(service.getSnapshots()).toEqual([]);
  });

  it('prioritizes active-session providers, then attention providers, using configured order as a tiebreaker', () => {
    const providers = [
      { id: 'provider-a', name: 'A', kind: 'openai', enabled: true },
      { id: 'provider-b', name: 'B', kind: 'openai', enabled: true },
      { id: 'provider-c', name: 'C', kind: 'openai', enabled: true },
      { id: 'provider-d', name: 'D', kind: 'openai', enabled: true },
    ];
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => providers },
      sessionRepository: {
        getActiveAndWaiting: () => [
          { id: 'active-b', providerId: 'provider-b' },
          { id: 'also-active-b', providerId: 'provider-b' },
        ],
      },
    });

    service.observe({
      providerId: 'provider-c', providerName: 'C', providerKind: 'openai',
      status: 'exhausted', source: 'provider', updatedAt: 1, staleAt: 2, unavailableReason: null,
      allowances: [],
    });

    expect(service.getSnapshots().map(({ providerId }) => providerId)).toEqual([
      'provider-b', 'provider-c', 'provider-a', 'provider-d',
    ]);
  });
});
