import { initDatabase } from '../database.js';
import { getActiveDbPath } from './dbUtils.js';
import { auditKanbanInvariants, formatKanbanInvariantReport, reconcileKanbanOwnership } from '../services/kanbanRecoveryService.js';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const apply = args.has('--apply');
if ([...args].some((arg) => !['--apply', '--dry-run', '--json'].includes(arg))) {
  console.error('Usage: node src/scripts/reconcileKanban.js [--dry-run|--apply] [--json]'); process.exitCode = 2;
} else {
  initDatabase(getActiveDbPath());
  const result = apply ? reconcileKanbanOwnership({ dryRun: false }) : { applied: false, blocked: false, report: auditKanbanInvariants(), changes: [] };
  console.log(json ? JSON.stringify(result, null, 2) : formatKanbanInvariantReport(result.report));
  if (!result.report.ok || result.blocked) process.exitCode = 1;
}
