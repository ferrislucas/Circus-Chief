import { createCatalogSync } from './catalogSync.js';

/**
 * Run a canonical refetch on websocket reconnect without allowing a slower,
 * older request to overwrite newer state. The caller owns how canonical data
 * is merged with local edits; this helper only owns request ordering and
 * listener disposal.
 *
 * Implemented on the shared {@link createCatalogSync} coordinator so the
 * reconnect path shares its revision with every other canonical intake.
 */
export function createReconnectRefetch({ onReconnect, fetchCanonical, apply }) {
  const sync = createCatalogSync({ fetchCanonical, applyCanonical: (canonical) => apply(canonical) });
  const removeReconnectListener = onReconnect(() => sync.refresh());

  return {
    refresh: (options) => sync.refresh(options),
    notifyCanonical: (canonical, options) => sync.notifyCanonical(canonical, options),
    dispose() {
      sync.dispose();
      removeReconnectListener?.();
    },
  };
}
