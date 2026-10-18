import { broadcast } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Versioned model-catalog invalidation.
 *
 * Emitted strictly AFTER a tier, provider, or model-catalog mutation commits
 * (same post-commit rule as tier-degradation publishing: a broadcast failure
 * must never roll back a successful write). Connected clients refetch the
 * named scope through their monotonic intake path and reconcile active
 * selections against the canonical state.
 *
 * Revision semantics: strictly increasing per server process
 * (`Math.max(Date.now(), last + 1)`), so clients can drop duplicate,
 * delayed, and out-of-order deliveries by keeping the maximum revision they
 * have applied. Single-process revision state is an explicit consequence of
 * the supported deployment boundary (one server process owns the catalog);
 * see the deployment-boundary enforcement for why a second writer cannot
 * exist. Bursts are intentionally NOT coalesced here: every invalidation
 * carries a newer revision and the client-side fetch guard makes overlapping
 * refetches converge on the latest response, so coalescing would only delay
 * convergence.
 */

let lastRevision = 0;

export function nextCatalogRevision(now = Date.now()) {
  lastRevision = Math.max(now, lastRevision + 1);
  return lastRevision;
}

/**
 * Broadcast a catalog invalidation for `scope` (`'tiers'` or `'providers'`).
 * @param {'tiers'|'providers'} scope
 * @returns {number} The emitted revision.
 */
export function publishCatalogInvalidation(scope) {
  const revision = nextCatalogRevision();
  broadcast(WS_MESSAGE_TYPES.CATALOG_INVALIDATED, { scope, revision });
  return revision;
}

/** Test-only reset for the process-local revision counter. */
export function _resetCatalogRevisionForTests() {
  lastRevision = 0;
}
