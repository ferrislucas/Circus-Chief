/** Durable state machine for structured Kanban lane runs.
 *
 * This deliberately treats execution status as separate from workflow state:
 * a waiting, scheduled, or retried session remains an open obligation until it
 * explicitly requests and then successfully finishes its own work.
 */
import crypto from 'crypto';
import { databaseManager } from '../db/DatabaseManager.js';

const now = () => Date.now();
const id = () => crypto.randomUUID();

function audit(db, runId, type, { sessionId = null, details = null } = {}) {
  db.prepare(`INSERT INTO kanban_lane_run_audit_events
    (id, lane_run_id, session_id, event_type, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id(), runId, sessionId, type, details ? JSON.stringify(details) : null, now());
}

export function createLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause = 'card_added', priorLaneRunId = null }) {
  if (lane.completionMode === 'legacy') return null;
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const time = now();
    const eventId = id(); const runId = id();
    const key = `${cause}:${cardId}:${lane.id}:${eventId}`;
    db.prepare(`INSERT INTO kanban_lane_entry_events
      (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,status,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,?,'completed',?,?,?)`)
      .run(eventId, key, projectId, workspaceId, cardId, lane.id, cause, time, time, time);
    db.prepare(`INSERT INTO kanban_lane_runs
      (id,lane_entry_event_id,prior_lane_run_id,project_id,workspace_id,card_id,source_lane_id,
       completion_target_lane_id,completion_mode,root_session_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`)
      .run(runId, eventId, priorLaneRunId, projectId, workspaceId, cardId, lane.id,
        lane.completionTargetLaneId, lane.completionMode, workspaceId, time, time);
    db.prepare(`UPDATE kanban_cards SET active_lane_run_id=?, lane_entry_event_id=?, updated_at=? WHERE id=?`)
      .run(runId, eventId, time, cardId);
    db.prepare(`UPDATE sessions SET lane_run_id=?, own_work_state='open', workflow_updated_at=?, workflow_reason=NULL
      WHERE id=?`).run(runId, time, workspaceId);
    audit(db, runId, 'run_created', { sessionId: workspaceId, details: { cause, laneId: lane.id } });
    return getRun(runId);
  });
}

export function beginWorkflowTurn(sessionId) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if (!s?.lane_run_id || s.own_work_state !== 'open') return null;
    const token = id(); const time = now();
    db.prepare(`UPDATE sessions SET workflow_turn_token=?, completion_requested_turn_token=NULL,
      completion_request_key=NULL, completion_requested_at=NULL, workflow_updated_at=? WHERE id=?`).run(token, time, sessionId);
    audit(db, s.lane_run_id, 'turn_started', { sessionId });
    return token;
  });
}

export function requestOwnWorkCompletion(sessionId, turnToken, requestKey) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if (!s?.lane_run_id || s.own_work_state !== 'open') throw new Error('Session has no open workflow obligation');
    if (s.workflow_turn_token !== turnToken) throw new Error('Workflow turn token is stale or invalid');
    if (s.completion_request_key === requestKey) return { accepted: true, idempotent: true };
    if (s.completion_request_key) throw new Error('A different completion request is already pending');
    const time = now();
    db.prepare(`UPDATE sessions SET completion_requested_turn_token=?, completion_request_key=?, completion_requested_at=?, workflow_updated_at=? WHERE id=?`)
      .run(turnToken, requestKey, time, time, sessionId);
    audit(db, s.lane_run_id, 'completion_requested', { sessionId, details: { requestKey } });
    return { accepted: true, idempotent: false };
  });
}

export function finalizeOwnWorkCompletion(sessionId, turnToken) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if (!s?.lane_run_id || s.own_work_state !== 'open') return null;
    if (s.workflow_turn_token !== turnToken || s.completion_requested_turn_token !== turnToken) return null;
    // A future schedule is an explicit continuation obligation, never success.
    if (s.scheduled_at || s.pending_prompt) return null;
    const time = now();
    db.prepare(`UPDATE sessions SET own_work_state='closed_successfully', own_work_closed_at=?,
      completion_requested_turn_token=NULL, completion_request_key=NULL, workflow_updated_at=? WHERE id=?`).run(time, time, sessionId);
    audit(db, s.lane_run_id, 'own_work_succeeded', { sessionId });
    return reconcileLaneRun(s.lane_run_id);
  });
}

export function reconcileLaneRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run || run.status !== 'open') return getRun(runId);
  const members = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
  const failed = members.find(s => s.own_work_state === 'closed_failed');
  const cancelled = members.find(s => s.own_work_state === 'cancelled');
  if (failed || cancelled) {
    const state = failed ? 'failed' : 'cancelled'; const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET status=?, failure_reason=?, ${state}_at=?, updated_at=? WHERE id=?`)
      .run(state, failed?.workflow_reason || cancelled?.workflow_reason || state, time, time, runId);
    audit(db, runId, `run_${state}`, { sessionId: failed?.id || cancelled?.id }); return getRun(runId);
  }
  if (members.length && members.every(s => s.own_work_state === 'closed_successfully')) return attemptLaneRunTransition(runId);
  return getRun(runId);
}

export function attemptLaneRunTransition(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run || run.status !== 'open') return getRun(runId);
  const card = db.prepare('SELECT * FROM kanban_cards WHERE id=?').get(run.card_id);
  if (!card || card.active_lane_run_id !== runId || card.lane_id !== run.source_lane_id) return getRun(runId);
  const time = now();
  db.prepare(`UPDATE kanban_lane_runs SET status='succeeded', succeeded_at=?, transition_applied_at=?, updated_at=? WHERE id=? AND status='open'`)
    .run(time, time, time, runId);
  if (run.completion_mode === 'structured' && run.completion_target_lane_id) {
    db.prepare('UPDATE kanban_cards SET lane_id=?, active_lane_run_id=NULL, updated_at=? WHERE id=?').run(run.completion_target_lane_id, time, card.id);
  }
  audit(db, runId, 'transition_applied'); return getRun(runId);
}

export function supersedeRunForCard(cardId, reason = 'manual_move') {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const card = db.prepare('SELECT active_lane_run_id FROM kanban_cards WHERE id=?').get(cardId);
    if (!card?.active_lane_run_id) return null; const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET status='superseded', superseded_at=?, updated_at=?, failure_reason=? WHERE id=? AND status='open'`)
      .run(time, time, reason, card.active_lane_run_id);
    db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=? WHERE id=?').run(time, cardId);
    audit(db, card.active_lane_run_id, 'run_superseded', { details: { reason } }); return getRun(card.active_lane_run_id);
  });
}

export function getRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run) return null; const rows = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
  const open = rows.filter(s => s.own_work_state === 'open');
  return { id: run.id, status: run.status, sourceLaneId: run.source_lane_id, targetLaneId: run.completion_target_lane_id,
    rootSessionId: run.root_session_id, failureReason: run.failure_reason, createdAt: run.created_at,
    openCount: open.length, scheduledCount: open.filter(s => s.scheduled_at).length,
    failedCount: rows.filter(s => s.own_work_state === 'closed_failed').length,
    cancelledCount: rows.filter(s => s.own_work_state === 'cancelled').length,
    blockingSessionIds: open.map(s => s.id), blockingReason: open.some(s => s.scheduled_at) ? 'Waiting for scheduled session' : open.length ? 'Waiting for own-work completion' : null };
}
