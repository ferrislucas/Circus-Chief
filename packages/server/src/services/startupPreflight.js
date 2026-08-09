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
  // A broken lane is quarantined by its own configuration validation; it
  // must not stop delivery for every other project. Ownership corruption is
  // still a global safety stop because it cannot be scoped reliably.
  const onlyInvalidConfiguration = report.violations?.length > 0
    && report.violations.every((violation) => violation.type === 'invalid_lane' || violation.type === 'invalid_lane_target');
  return { ok, report, reconciliation, workersEnabled: ok || onlyInvalidConfiguration };
}
