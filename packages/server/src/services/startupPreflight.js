import { auditKanbanInvariants, reconcileKanbanOwnership } from './kanbanRecoveryService.js';

/**
 * Normalize durable Kanban ownership before worker services begin. A bad
 * configuration must degrade automation, never prevent the operator UI from
 * starting.
 */
export function runStartupPreflight({
  reconcile = reconcileKanbanOwnership,
  audit = auditKanbanInvariants,
} = {}) {
  const reconciliation = reconcile({ dryRun: false });
  const report = audit();
  const ok = !reconciliation.blocked && report.ok;
  return { ok, report, reconciliation, workersEnabled: ok };
}
