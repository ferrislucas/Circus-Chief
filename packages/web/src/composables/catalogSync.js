/**
 * The single ordering mechanism for every canonical intake source: initial
 * load, websocket invalidation, reconnect, and user-triggered refresh.
 *
 * Every intake — a fetched response (`refresh`) or an inline websocket
 * payload (`notifyCanonical`) — shares one revision counter. A slower, older
 * response can never overwrite newer canonical state, no matter which source
 * produced which request. Disposal (component unmount) stops all late
 * writes.
 */
export function createCatalogSync({ fetchCanonical, applyCanonical }) {
  let requestRevision = 0;
  let appliedRevision = 0;
  let disposed = false;

  async function refresh(options) {
    const request = ++requestRevision;
    const canonical = await fetchCanonical(options);
    if (!disposed && request >= appliedRevision) {
      appliedRevision = request;
      applyCanonical(canonical, options);
    }
    return canonical;
  }

  function notifyCanonical(canonical, options) {
    if (disposed) return;
    appliedRevision = ++requestRevision;
    applyCanonical(canonical, options);
  }

  function dispose() {
    disposed = true;
  }

  return { refresh, notifyCanonical, dispose };
}
