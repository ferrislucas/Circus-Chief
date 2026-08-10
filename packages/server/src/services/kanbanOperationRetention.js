import { databaseManager } from '../database.js';

export const DEFAULT_KANBAN_OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Delete one bounded batch of terminal API operations. Processing operations
 * are never eligible, regardless of age, so cleanup cannot steal live work. */
export function cleanupKanbanApiOperations({
  db = databaseManager.get(),
  now = Date.now(),
  retentionMs = DEFAULT_KANBAN_OPERATION_RETENTION_MS,
  batchSize = DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH,
} = {}) {
  const safeRetention = Math.max(0, Number(retentionMs) || DEFAULT_KANBAN_OPERATION_RETENTION_MS);
  const safeBatch = Math.max(1, Math.min(10_000, Math.trunc(Number(batchSize) || DEFAULT_KANBAN_OPERATION_CLEANUP_BATCH)));
  const cutoff = now - safeRetention;
  const deleted = db.prepare(`DELETE FROM kanban_api_operations WHERE id IN (
    SELECT id FROM kanban_api_operations
    WHERE status='completed' AND updated_at < ? ORDER BY updated_at LIMIT ?
  )`).run(cutoff, safeBatch).changes;
  const remainingEligible = Number(db.prepare(`SELECT count(*) count FROM kanban_api_operations
    WHERE status='completed' AND updated_at < ?`).get(cutoff).count || 0);
  return { deleted, remainingEligible, cutoff, batchSize: safeBatch };
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
