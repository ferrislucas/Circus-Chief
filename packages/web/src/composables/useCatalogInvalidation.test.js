import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const wsHandlers = {};
const mockTiersStore = { fetchTiers: vi.fn() };
const mockProvidersStore = { fetchProviders: vi.fn() };

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((type, cb) => { wsHandlers[type] = cb; }),
    off: vi.fn((type) => { delete wsHandlers[type]; }),
  }),
}));

vi.mock('../stores/tiers.js', () => ({
  useTiersStore: () => mockTiersStore,
}));

vi.mock('../stores/providers.js', () => ({
  useProvidersStore: () => mockProvidersStore,
}));

import { useCatalogInvalidation } from './useCatalogInvalidation.js';

function emit(payload) {
  wsHandlers[WS_MESSAGE_TYPES.CATALOG_INVALIDATED](payload);
}

/**
 * Client B converges without a reload: a catalog mutation on client A is
 * broadcast, and client B refetches canonical state through the monotonic
 * store path and reconciles its selectors.
 */
describe('useCatalogInvalidation', () => {
  beforeEach(() => {
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    vi.clearAllMocks();
    useCatalogInvalidation();
  });

  it('refetches only tiers for a tiers-scoped invalidation', () => {
    emit({ scope: 'tiers', revision: 1 });

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
    expect(mockProvidersStore.fetchProviders).not.toHaveBeenCalled();
  });

  it('refetches only providers for a providers-scoped invalidation', () => {
    emit({ scope: 'providers', revision: 1 });

    expect(mockProvidersStore.fetchProviders).toHaveBeenCalledTimes(1);
    expect(mockTiersStore.fetchTiers).not.toHaveBeenCalled();
  });

  it('ignores duplicate revisions (idempotent delivery)', () => {
    emit({ scope: 'tiers', revision: 7 });
    emit({ scope: 'tiers', revision: 7 });

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('ignores delayed and out-of-order revisions so older state never wins', () => {
    emit({ scope: 'tiers', revision: 10 });
    emit({ scope: 'tiers', revision: 9 });
    emit({ scope: 'tiers', revision: 10 });

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('a newer revision after an older one refetches again (convergence)', () => {
    emit({ scope: 'providers', revision: 3 });
    emit({ scope: 'providers', revision: 4 });

    expect(mockProvidersStore.fetchProviders).toHaveBeenCalledTimes(2);
  });
});
