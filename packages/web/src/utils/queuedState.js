/**
 * Shared queue-state resolution for the queued badge.
 *
 * Two sources can report a workspace's queue state: the workspace-card API
 * (`session.kanban`, a snapshot that needs no board load) and the live
 * kanban store card (patched by realtime broadcasts). The card API wins when
 * it carries queue fields; otherwise the store card fills the gap (deep-link
 * safety net before the API ships the fields, and live updates after).
 * Returns the winning `{ entryState, entryStatus, queuePosition }`-shaped
 * object, or null when neither source reports a queued entry.
 *
 * @param {Object|null} apiKanban - Compact `session.kanban` object or null
 * @param {Object|null} storeCard - Kanban store card or null
 * @returns {Object|null}
 */
export function resolveQueueState(apiKanban, storeCard) {
  if (isQueuedSource(apiKanban)) {
    return {
      entryState: apiKanban.entryState ?? null,
      entryStatus: apiKanban.entryStatus ?? null,
      queuePosition: apiKanban.queuePosition ?? null,
    };
  }
  if (isQueuedSource(storeCard)) {
    return {
      entryState: storeCard.entryState ?? null,
      entryStatus: storeCard.entryStatus ?? null,
      queuePosition: storeCard.queuePosition ?? null,
    };
  }
  return null;
}

function isQueuedSource(source) {
  return source?.entryState === 'queued' || source?.entryStatus === 'queued';
}
