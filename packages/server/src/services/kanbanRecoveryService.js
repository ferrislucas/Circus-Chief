/**
 * Readable, machine-consumable health checks and recovery for the durable
 * Kanban lane-run model.  This deliberately operates only on persisted state:
 * it never guesses ownership for historical workers.
 */
import { databaseManager } from '../database.js';
import { supersedeLaneRun } from './workflowSessionService.js';

function issue(type, reason, row, severity = 'error') {
  return { type, reason, severity, ...row };
}

function hasAutomation(lane) {
  return Boolean(lane.on_enter_prompt || lane.on_enter_template_id);
}

function auditLaneInvariant(violations, lane, target) {
  const base = { projectId: lane.project_id, boardId: lane.board_id, laneId: lane.id, targetLaneId: lane.completion_target_lane_id };
  if (!hasAutomation(lane)) violations.push(issue('invalid_lane', 'completion target requires on-entry automation', base));
  if (!target) violations.push(issue('invalid_lane_target', 'completion target does not exist', base));
  else if (target.id === lane.id) violations.push(issue('invalid_lane_target', 'completion target cannot reference its own lane', base));
  else if (target.board_id !== lane.board_id) violations.push(issue('invalid_lane_target', 'completion target belongs to another board', base));
}

function auditOpenRunInvariant(violations, db, row) {
  const base = { runId: row.run_id, cardId: row.card_id, workspaceId: row.workspace_id, laneId: row.source_lane_id };
  if (!row.card_lane_id) violations.push(issue('orphan_open_run', 'open run has no card', base));
  else if (row.active_lane_run_id !== row.run_id) violations.push(issue('stale_run_pointer', 'open run is not the card active run', base));
  else if (row.card_lane_id !== row.source_lane_id) violations.push(issue('run_lane_mismatch', 'card is no longer in the run source lane', base));
  if (!row.root_session_id) violations.push(issue('run_root', 'open run has no root session', base));
  else if (!db.prepare('SELECT 1 FROM sessions WHERE id=? AND lane_run_id=?').get(row.root_session_id, row.run_id)) {
    violations.push(issue('run_root', 'run root is not a member of its run', base));
  }
}

/** Return a stable report suitable for both operators and JSON automation. */
export function auditKanbanInvariants(db = databaseManager.get()) {
  const violations = [];
  const lanes = db.prepare(`SELECT l.*, b.project_id FROM kanban_lanes l JOIN kanban_boards b ON b.id=l.board_id`).all();
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));

  for (const lane of lanes) {
    if (!lane.completion_target_lane_id) continue;
    auditLaneInvariant(violations, lane, laneById.get(lane.completion_target_lane_id));
  }

  for (const row of db.prepare(`SELECT r.id run_id, r.card_id, r.source_lane_id, r.root_session_id, r.workspace_id,
      c.active_lane_run_id, c.lane_id card_lane_id FROM kanban_lane_runs r
      LEFT JOIN kanban_cards c ON c.id=r.card_id WHERE r.status='open'`).all()) {
    auditOpenRunInvariant(violations, db, row);
  }

  for (const row of db.prepare(`SELECT c.id card_id, c.active_lane_run_id run_id, l.board_id, b.project_id
      FROM kanban_cards c JOIN kanban_lanes l ON l.id=c.lane_id JOIN kanban_boards b ON b.id=l.board_id
      WHERE c.active_lane_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM kanban_lane_runs r WHERE r.id=c.active_lane_run_id AND r.status='open'
      )`).all()) {
    violations.push(issue('stale_card_pointer', 'card points at a non-open lane run', { cardId: row.card_id, runId: row.run_id, boardId: row.board_id, projectId: row.project_id }));
  }

  const entryEvents = db.prepare(`SELECT id, project_id, workspace_id, card_id, lane_id, cause, status, claim_token,
      claimed_at, attempt_count, last_error, created_at FROM kanban_lane_entry_events
      WHERE status IN ('pending', 'claimed') ORDER BY created_at`).all()
    .map((row) => ({ id: row.id, projectId: row.project_id, workspaceId: row.workspace_id, cardId: row.card_id,
      laneId: row.lane_id, cause: row.cause, status: row.status, claimedAt: row.claimed_at,
      attemptCount: row.attempt_count, lastError: row.last_error, createdAt: row.created_at }));

  return {
    ok: violations.length === 0,
    generatedAt: Date.now(),
    summary: { lanes: lanes.length, openRuns: db.prepare("SELECT count(*) count FROM kanban_lane_runs WHERE status='open'").get().count,
      violations: violations.length, pendingOrClaimedEntryEvents: entryEvents.length },
    violations, entryEvents,
  };
}

export function formatKanbanInvariantReport(report) {
  const lines = [`Kanban preflight: ${report.ok ? 'PASS' : 'FAIL'} (${report.summary.violations} violation(s))`];
  for (const item of report.violations) lines.push(`- ${item.type}: ${item.reason} [card=${item.cardId || '-'} lane=${item.laneId || '-'} session=${item.sessionId || '-'} run=${item.runId || '-'}]`);
  if (report.entryEvents.length) lines.push(`- ${report.entryEvents.length} pending/claimed lane-entry event(s)`);
  return lines.join('\n');
}

function hasUnambiguousRootTree(db, run) {
  if (!run.root_session_id) return false;
  const members = db.prepare('SELECT id, parent_session_id FROM sessions WHERE lane_run_id=?').all(run.id);
  const byId = new Map(members.map((member) => [member.id, member]));
  if (!byId.has(run.root_session_id)) return false;
  for (const member of members) {
    const seen = new Set(); let cursor = member;
    while (cursor.id !== run.root_session_id) {
      if (seen.has(cursor.id) || !cursor.parent_session_id || !byId.has(cursor.parent_session_id)) return false;
      seen.add(cursor.id); cursor = byId.get(cursor.parent_session_id);
    }
  }
  return true;
}

function rootlessHandoffMatchesEvent(row, run) {
  return [
    row.active_lane_run_id === run.id,
    row.card_lane_id === run.source_lane_id,
    row.lane_entry_event_id === run.lane_entry_event_id,
    row.project_id === run.project_id,
    row.workspace_id === run.workspace_id,
    row.event_card_id === run.card_id,
    row.event_lane_id === run.source_lane_id,
    row.cause === 'completion',
    ['pending', 'claimed'].includes(row.event_status),
    row.source_status === 'succeeded',
    row.transition_applied_at !== null,
  ].every(Boolean);
}

/** A completion handoff is recoverable only when every persisted owner agrees. */
export function isRecoverableRootlessHandoff(db, run) {
  if (run.root_session_id || !run.lane_entry_event_id) return false;
  const row = db.prepare(`SELECT c.active_lane_run_id, c.lane_id card_lane_id, c.lane_entry_event_id,
      e.project_id, e.workspace_id, e.card_id event_card_id, e.lane_id event_lane_id,
      e.cause, e.status event_status, e.claim_token, e.claimed_at,
      source.status source_status, source.transition_applied_at
    FROM kanban_cards c
    JOIN kanban_lane_entry_events e ON e.id=?
    LEFT JOIN kanban_lane_runs source ON source.id=e.caused_by_run_id
    WHERE c.id=?`).get(run.lane_entry_event_id, run.card_id);
  // An active lease is owned by another live delivery attempt. It is not safe
  // to reinterpret it during startup; a stale lease is explicitly recoverable.
  if (!row) return false;
  const leaseIsLive = row.claim_token && row.claimed_at >= Date.now() - 5 * 60 * 1000;
  return !leaseIsLive && rootlessHandoffMatchesEvent(row, run);
}

/**
 * Normalize only demonstrably stale state.  It is intentionally conservative:
 * ambiguous history is cancelled, never attached to a newly-created run.
 */
export function reconcileKanbanOwnership({ dryRun = true } = {}) {
  const db = databaseManager.get();
  const initial = auditKanbanInvariants(db);
  const invalidLanes = initial.violations.filter((v) => v.type.startsWith('invalid_lane'));
  if (invalidLanes.length) return { applied: false, blocked: true, report: initial, changes: [] };

  const changes = [];
  const openRuns = db.prepare(`SELECT r.*, c.active_lane_run_id, c.lane_id card_lane_id FROM kanban_lane_runs r
    LEFT JOIN kanban_cards c ON c.id=r.card_id WHERE r.status='open'`).all()
  const preservedRootlessRunIds = openRuns
    .filter((run) => isRecoverableRootlessHandoff(db, run)).map((run) => run.id);
  const staleRunIds = openRuns
    .filter((run) => !preservedRootlessRunIds.includes(run.id))
    .filter((run) => !run.card_lane_id || run.active_lane_run_id !== run.id || run.card_lane_id !== run.source_lane_id
      || !hasUnambiguousRootTree(db, run)).map((run) => run.id);

  if (!dryRun) {
    for (const runId of staleRunIds) supersedeLaneRun(runId, 'reconciliation_invalid_or_stale_run');
    const now = Date.now();
    const stalePointers = db.prepare(`UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=?
      WHERE active_lane_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kanban_lane_runs r WHERE r.id=active_lane_run_id AND r.status='open')`).run(now).changes;
    if (stalePointers) changes.push({ type: 'cleared_stale_card_pointers', count: stalePointers });
    const released = db.prepare(`UPDATE kanban_lane_entry_events SET claim_token=NULL, claimed_at=NULL, updated_at=?
      WHERE status='pending' AND claim_token IS NOT NULL AND claimed_at < ?`).run(now, now - 5 * 60 * 1000).changes;
    if (released) changes.push({ type: 'reclaimed_entry_claims', count: released });
    const cancelled = db.prepare(`UPDATE sessions SET scheduled_at=NULL, pending_prompt=NULL, pending_model=NULL,
      auto_send_pending_prompt=0, execution_state='idle', workflow_reason='reconciliation_unowned_worker', workflow_updated_at=?
      WHERE lane_run_id IN (SELECT id FROM kanban_lane_runs WHERE status IN ('superseded', 'failed', 'cancelled'))
        AND (scheduled_at IS NOT NULL OR execution_state IN ('running', 'starting', 'retrying', 'paused'))`).run(now).changes;
    if (cancelled) changes.push({ type: 'cancelled_unowned_workers', count: cancelled });
  }
  if (staleRunIds.length) changes.unshift({ type: 'superseded_runs', runIds: staleRunIds });
  if (preservedRootlessRunIds.length) changes.unshift({ type: 'preserved_recoverable_rootless_handoffs', runIds: preservedRootlessRunIds });
  return { applied: !dryRun, blocked: false, report: auditKanbanInvariants(db), changes };
}
