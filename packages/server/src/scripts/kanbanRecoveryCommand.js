import Database from 'better-sqlite3';
import { initDatabase } from '../database.js';
import { auditKanbanInvariants, formatKanbanInvariantReport, reconcileKanbanOwnership, redriveLaneEntryEvent } from '../services/kanbanRecoveryService.js';
import { copyDatabaseBackups, getActiveDbPath, verifyDatabaseBackup } from './dbUtils.js';

export const KANBAN_RECOVERY_VERSION = 'kanban-recovery/v1';
const VALID_ARGUMENTS = new Set(['--apply', '--dry-run', '--json']);

export function parseRecoveryArguments(argv) {
  const args = new Set(argv);
  const flags = [...args].filter((arg) => !arg.startsWith('--redrive='));
  const redrive = argv.find((arg) => arg.startsWith('--redrive='));
  const unknown = flags.filter((arg) => !VALID_ARGUMENTS.has(arg));
  if (unknown.length || (args.has('--apply') && args.has('--dry-run'))) {
    return { error: 'Usage: kanban:recover [--dry-run|--apply] [--json] [--redrive=<lane-entry-event-id>]' };
  }
  const redriveEventId = redrive ? redrive.slice('--redrive='.length) : null;
  if (redrive && !redriveEventId) {
    return { error: 'Usage: kanban:recover [--dry-run|--apply] [--json] [--redrive=<lane-entry-event-id>]' };
  }
  return { apply: args.has('--apply'), json: args.has('--json'), redriveEventId };
}

/**
 * Run during a maintenance window after workers stop. `--apply` is the only
 * mutating mode and always backs up and verifies the database first.
 */
export async function runKanbanRecovery({ apply = false, dbPath = getActiveDbPath(), redriveEventId = null } = {}) {
  if (redriveEventId) {
    return runLaneEntryRedrive({ apply, dbPath, redriveEventId });
  }
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

/**
 * Guarded redrive for one parked or ambiguously-failed lane-entry event.
 * Dry-run is read-only (bypasses migrations like the ownership dry run);
 * `--apply` backs up, verifies, migrates, then redrives. Note the liveness
 * caveat: this command runs out-of-process, so an in-memory live execution
 * in the server is invisible here — the attached child's persisted row state
 * is the guard, and redrive refuses `running`/`starting` rows.
 */
function verifiedRedriveBackup(dbPath) {
  const backup = copyDatabaseBackups(dbPath);
  const backupVerification = verifyDatabaseBackup(backup);
  if (!backupVerification.ok) {
    return { backup, backupVerification, error: 'Backup verification failed; no redrive was attempted.' };
  }
  return { backup, backupVerification, error: null };
}

async function readOnlyRedrive(dbPath, redriveEventId) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return await redriveLaneEntryEvent(redriveEventId, { dryRun: true, db });
  } finally {
    db.close();
  }
}

export async function runLaneEntryRedrive({ apply = false, dbPath = getActiveDbPath(), redriveEventId }) {
  if (!apply) {
    try {
      const redrive = await readOnlyRedrive(dbPath, redriveEventId);
      return { version: KANBAN_RECOVERY_VERSION, mode: 'dry-run', dbPath, applied: false,
        blocked: redrive.blocked, backup: null, backupVerification: null, report: null, changes: [], redrive };
    } catch (error) {
      return { version: KANBAN_RECOVERY_VERSION, mode: 'dry-run', dbPath, applied: false, blocked: true,
        backup: null, backupVerification: null, report: null, changes: [],
        error: `Unable to open copied database for read-only redrive: ${error.message}` };
    }
  }
  const { backup, backupVerification, error } = verifiedRedriveBackup(dbPath);
  if (error) {
    return { version: KANBAN_RECOVERY_VERSION, mode: 'apply', dbPath, applied: false, blocked: true,
      backup, backupVerification, report: null, changes: [], redrive: null, error };
  }
  initDatabase(dbPath);
  const redrive = await redriveLaneEntryEvent(redriveEventId, { dryRun: false });
  const report = auditKanbanInvariants();
  return { version: KANBAN_RECOVERY_VERSION, mode: 'apply', dbPath, applied: redrive.applied,
    blocked: redrive.blocked, backup, backupVerification, report, changes: [], redrive };
}

function formatRedriveSummary(redrive) {
  if (redrive.blocked) return `Redrive ${redrive.eventId}: BLOCKED (${redrive.reason})`;
  if (!redrive.applied) return `Redrive ${redrive.eventId}: DRY-RUN plan=${redrive.plan}`;
  const drain = redrive.drainError ? ` drainError=${redrive.drainError}` : '';
  const replacement = redrive.newEventId ? ` newEvent=${redrive.newEventId}` : '';
  return `Redrive ${redrive.eventId}: APPLIED plan=${redrive.plan} delivered=${redrive.delivered ?? 'n/a'}${drain}${replacement}`;
}

export function formatKanbanRecovery(result) {
  const lines = [`Kanban recovery ${result.version}: ${result.mode}${result.applied ? ' applied' : ''}`, `Database: ${result.dbPath}`];
  if (result.backupVerification) lines.push(`Backup verification: ${result.backupVerification.ok ? 'PASS' : 'FAIL'}`);
  if (result.error) lines.push(`Error: ${result.error}`);
  if (result.redrive) lines.push(formatRedriveSummary(result.redrive));
  if (result.report) lines.push(formatKanbanInvariantReport(result.report));
  return lines.join('\n');
}
