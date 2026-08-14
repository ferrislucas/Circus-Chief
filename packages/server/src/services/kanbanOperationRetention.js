import { databaseManager } from '../database.js';

export const DEFAULT_KANBAN_OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_KANBAN_OPERATION_ABANDONED_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Delete one bounded batch of terminal API operations. Processing operations
 * are never eligible, regardless of age, so cleanup cannot steal live work. */
export function cleanupKanbanApiOperations({
  db = databaseManager.get(),
  now = Date.now(),
  retentionMs = DEFAULT_KANBAN_OPERATION_RETENTION_MS,
  abandonedMs = DEFAULT_KANBAN_OPERATION_ABANDONED_MS,
  batchSize = DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH,
} = {}) {
  const safeRetention = Math.max(0, Number(retentionMs) || DEFAULT_KANBAN_OPERATION_RETENTION_MS);
  const safeBatch = Math.max(1, Math.min(10_000, Math.trunc(Number(batchSize) || DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH)));
  const cutoff = now - safeRetention;
  const abandonedCutoff = now - Math.max(0, Number(abandonedMs) || DEFAULT_KANBAN_OPERATION_ABANDONED_MS);
  // An expired lease remains retryable for a conservative grace period. Past
  // that point quarantine it as terminal so unique keys and indexes cannot
  // accumulate forever. It is retained for the normal audit/replay window.
  const terminalized = db.prepare(`UPDATE kanban_api_operations
    SET status='abandoned', owner_token=NULL, lease_expires_at=NULL,
      terminal_error='operation lease expired without a persisted response', updated_at=?
    WHERE status='processing' AND lease_expires_at IS NOT NULL
      AND lease_expires_at < ? AND updated_at < ?`).run(now, now, abandonedCutoff).changes;
  const deleted = db.prepare(`DELETE FROM kanban_api_operations WHERE id IN (
    SELECT id FROM kanban_api_operations
    WHERE status IN ('completed','abandoned') AND updated_at < ? ORDER BY updated_at LIMIT ?
  )`).run(cutoff, safeBatch).changes;
  const remainingEligible = Number(db.prepare(`SELECT count(*) count FROM kanban_api_operations
    WHERE status IN ('completed','abandoned') AND updated_at < ?`).get(cutoff).count || 0);
  return { terminalized, deleted, remainingEligible, cutoff, abandonedCutoff, batchSize: safeBatch };
}

let cleanupTimer = null;

export function startKanbanOperationRetention() {
  if (cleanupTimer) return;
  const run = () => {
    try {
      const result = cleanupKanbanApiOperations();
      if (result.deleted || result.remainingEligible) console.log('[Kanban operation retention]', result);
    } catch (error) {
      console.error('Kanban operation retention failed:', error);
    }
  };
  run();
  cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function stopKanbanOperationRetention() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
