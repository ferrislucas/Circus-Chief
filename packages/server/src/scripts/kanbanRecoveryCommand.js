import Database from 'better-sqlite3';
import { initDatabase } from '../database.js';
import { auditKanbanInvariants, formatKanbanInvariantReport, reconcileKanbanOwnership } from '../services/kanbanRecoveryService.js';
import { copyDatabaseBackups, getActiveDbPath, verifyDatabaseBackup } from './dbUtils.js';

export const KANBAN_RECOVERY_VERSION = 'kanban-recovery/v1';
const VALID_ARGUMENTS = new Set(['--apply', '--dry-run', '--json']);

export function parseRecoveryArguments(argv) {
  const args = new Set(argv);
  const unknown = [...args].filter((arg) => !VALID_ARGUMENTS.has(arg));
  if (unknown.length || (args.has('--apply') && args.has('--dry-run'))) {
    return { error: 'Usage: kanban:recover [--dry-run|--apply] [--json]' };
  }
  return { apply: args.has('--apply'), json: args.has('--json') };
}

/**
 * Run during a maintenance window after workers stop. `--apply` is the only
 * mutating mode and always backs up and verifies the database first.
 */
export function runKanbanRecovery({ apply = false, dbPath = getActiveDbPath() } = {}) {
  let backup = null;
  let backupVerification = null;
  if (apply) {
    backup = copyDatabaseBackups(dbPath);
    backupVerification = verifyDatabaseBackup(backup);
    if (!backupVerification.ok) {
      return { version: KANBAN_RECOVERY_VERSION, mode: 'apply', dbPath, applied: false, blocked: true,
        backup, backupVerification, report: null, changes: [],
        error: 'Backup verification failed; no migration or reconciliation was attempted.' };
    }
  }

  if (!apply) {
    // A dry run deliberately bypasses DatabaseManager: its normal initializer
    // runs migrations, which would make a supposedly read-only preflight write.
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        const report = auditKanbanInvariants(db);
        return { version: KANBAN_RECOVERY_VERSION, mode: 'dry-run', dbPath, applied: false, blocked: false,
        backup, backupVerification, report, changes: [] };
      } finally {
        db.close();
      }
    } catch (error) {
      return { version: KANBAN_RECOVERY_VERSION, mode: 'dry-run', dbPath, applied: false, blocked: true,
        backup, backupVerification, report: null, changes: [],
        error: `Unable to open copied database for read-only preflight: ${error.message}` };
    }
  }

  // Initialization runs the versioned schema migrations after the verified
  // backup, then reconciliation and an independent post-recovery audit run.
  initDatabase(dbPath);
  const recovery = reconcileKanbanOwnership({ dryRun: false });
  const report = auditKanbanInvariants();
  return { version: KANBAN_RECOVERY_VERSION, mode: apply ? 'apply' : 'dry-run', dbPath,
    applied: recovery.applied, blocked: recovery.blocked, backup, backupVerification,
    report, changes: recovery.changes };
}

export function formatKanbanRecovery(result) {
  const lines = [`Kanban recovery ${result.version}: ${result.mode}${result.applied ? ' applied' : ''}`, `Database: ${result.dbPath}`];
  if (result.backupVerification) lines.push(`Backup verification: ${result.backupVerification.ok ? 'PASS' : 'FAIL'}`);
  if (result.error) lines.push(`Error: ${result.error}`);
  if (result.report) lines.push(formatKanbanInvariantReport(result.report));
  return lines.join('\n');
}
