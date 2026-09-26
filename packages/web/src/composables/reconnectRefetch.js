/**
 * Run a canonical refetch on websocket reconnect without allowing a slower,
 * older request to overwrite newer state. The caller owns how canonical data
 * is merged with local edits; this helper only owns request ordering and
 * listener disposal.
 */
export function createReconnectRefetch({ onReconnect, fetchCanonical, apply }) {
  let revision = 0;
  let disposed = false;

  async function refresh() {
    const requestRevision = ++revision;
    const canonical = await fetchCanonical();
    if (!disposed && requestRevision === revision) apply(canonical);
    return canonical;
  }

  const removeReconnectListener = onReconnect(refresh);

  return {
    refresh,
    dispose() {
      disposed = true;
      removeReconnectListener?.();
    },
  };
}
