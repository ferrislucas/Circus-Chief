import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useWebSocket } from './useWebSocket.js';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';

/**
 * Consume versioned model-catalog invalidations (`catalog:invalidated`).
 *
 * Installed once at the app root. A catalog mutation on ANY client is
 * broadcast with a strictly increasing revision; this client refetches the
 * named scope through the stores' monotonic intake path (item 3), so
 * selectors converge without a reload and active selections reconcile
 * against canonical state via `describeSelectionProblem`.
 *
 * Revision guard: only a revision NEWER than the last applied one refetches.
 * Duplicate, delayed, and out-of-order deliveries are idempotent no-ops.
 */
export function useCatalogInvalidation() {
  const { on, off } = useWebSocket();
  const tiersStore = useTiersStore();
  const providersStore = useProvidersStore();
  let lastRevision = 0;

  function handleCatalogInvalidated(message) {
    const revision = typeof message?.revision === 'number' ? message.revision : 0;
    if (!(revision > lastRevision)) return;
    lastRevision = revision;
    if (message?.scope === 'providers') {
      // Finding 10: tier availability derives from provider/model
      // eligibility, so a providers-scoped invalidation refreshes the tier
      // catalog too — through the same monotonic intake path, keeping the
      // revision guard above as the single ordering rule. Tiers-scoped
      // events keep their narrower scope below.
      providersStore.fetchProviders();
      tiersStore.fetchTiers();
    } else if (message?.scope === 'tiers') {
      tiersStore.fetchTiers();
    } else {
      tiersStore.fetchTiers();
      providersStore.fetchProviders();
    }
  }

  on(WS_MESSAGE_TYPES.CATALOG_INVALIDATED, handleCatalogInvalidated);

  function dispose() {
    off(WS_MESSAGE_TYPES.CATALOG_INVALIDATED, handleCatalogInvalidated);
  }

  return { dispose };
}
