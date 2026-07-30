/** Durable state machine for structured Kanban lane runs.
 *
 * This deliberately treats execution status as separate from workflow state:
 * a waiting, scheduled, or retried session remains an open obligation until it
 * explicitly requests and then successfully finishes its own work.
 */
import crypto from 'crypto';
import { databaseManager } from '../db/DatabaseManager.js';
// db/ layer only — safe to import: db/index.js never depends on any
// services/ module, so this cannot create an import cycle (contrast with
// kanbanService.js/kanbanTriggers.js — see attemptLaneRunTransition below).
import { kanbanCards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const now = () => Date.now();
const id = () => crypto.randomUUID();
const SELECT_SESSION_BY_ID = 'SELECT * FROM sessions WHERE id=?';

function audit(db, runId, type, { sessionId = null, details = null } = {}) {
  const operationKey = `${runId}:${type}:${sessionId || '-'}:${details ? JSON.stringify(details) : '-'}`;
  db.prepare(`INSERT INTO kanban_lane_run_audit_events
    (id, operation_key, lane_run_id, session_id, event_type, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_key) DO NOTHING`)
    .run(id(), operationKey, runId, sessionId, type, details ? JSON.stringify(details) : null, now());
}

function isParticipating(session) {
  return Boolean(session?.lane_run_id);
}

/**
 * True when a lane's completion is governed by the durable lane-run engine
 * (either `shadow`, which computes outcomes without moving the card, or
 * `structured`, which also drives the Kanban transition) rather than the
 * legacy single-session completion signal.
 * @param {{ completionMode?: string }|null|undefined} lane
 * @returns {boolean}
 */
export function isStructured(lane) {
  return Boolean(lane?.completionMode && lane.completionMode !== 'legacy');
}

/** True for a better-sqlite3 UNIQUE constraint violation, across driver versions. */
function isUniqueConstraintError(error) {
  return error?.code?.startsWith('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/.test(error?.message || '');
}

/**
 * W7 (FR-1.5, AC-14): a `completion`-caused lane-entry event is
 * deterministically identified by the source run that caused it — a given
 * source run can cause at most one entry event, ever. This activates the
 * pre-existing idx_lane_entry_completion_cause partial unique index (it was
 * declared in the schema but nothing ever populated caused_by_run_id, so it
 * was inert). Other causes (card_added, manual_move) are one-shot,
 * synchronous, single-process actions gated by their own callers.
 */
function causedByRunId(cause, priorLaneRunId) {
  return cause === 'completion' ? priorLaneRunId : null;
}

/** Resolve the run tied to an existing lane-entry event, if any. */
function runForEntryEvent(db, eventId) {
  const run = db.prepare('SELECT id FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(eventId);
  return run ? getRun(run.id) : null;
}

export function createLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause = 'card_added', priorLaneRunId = null }) {
  if (lane.completionMode === 'legacy') return null;
  const db = databaseManager.get();
  const causeRunId = causedByRunId(cause, priorLaneRunId);
  if (causeRunId) {
    const existingEvent = db.prepare('SELECT id FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(causeRunId);
    if (existingEvent) return runForEntryEvent(db, existingEvent.id);
  }
  try {
    return databaseManager.transaction(() => {
      const db2 = databaseManager.get(); const time = now();
      const eventId = id(); const runId = id();
      const key = `${cause}:${cardId}:${lane.id}:${eventId}`;
      db2.prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,'completed',?,?,?)`)
        .run(eventId, key, projectId, workspaceId, cardId, lane.id, cause, causeRunId, time, time, time);
      db2.prepare(`INSERT INTO kanban_lane_runs
        (id,lane_entry_event_id,prior_lane_run_id,project_id,workspace_id,card_id,source_lane_id,
         completion_target_lane_id,completion_mode,root_session_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`)
        .run(runId, eventId, priorLaneRunId, projectId, workspaceId, cardId, lane.id,
          lane.completionTargetLaneId, lane.completionMode, null, time, time);
      db2.prepare(`UPDATE kanban_cards SET active_lane_run_id=?, lane_entry_event_id=?, updated_at=? WHERE id=?`)
        .run(runId, eventId, time, cardId);
      audit(db2, runId, 'run_created', { details: { cause, laneId: lane.id } });
      return getRun(runId);
    });
  } catch (error) {
    // W7 (AC-14): a concurrent caller committed first — either the same
    // caused_by_run_id entry event, or idx_lane_runs_one_open_card (at most
    // one open run per card). Resolve to whichever run now actually owns the
    // card instead of surfacing a 500 for a request that was, semantically,
    // a duplicate.
    if (!isUniqueConstraintError(error)) throw error;
    if (causeRunId) {
      const winningEvent = db.prepare('SELECT id FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(causeRunId);
      if (winningEvent) return runForEntryEvent(db, winningEvent.id);
    }
    const activeRunId = db.prepare('SELECT active_lane_run_id FROM kanban_cards WHERE id=?').get(cardId)?.active_lane_run_id;
    return activeRunId ? getRun(activeRunId) : null;
  }
}

/** Attach the actual on-entry worker as a lane run's root exactly once. */
export function attachRootSession(runId, sessionId) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
    const session = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!run || run.status !== 'open') throw new Error('Cannot attach a root to a terminal lane run');
    const belongsToWorkspace = session && db.prepare(`WITH RECURSIVE ancestors(id, parent_session_id) AS (
      SELECT id, parent_session_id FROM sessions WHERE id=?
      UNION ALL
      SELECT s.id, s.parent_session_id FROM sessions s JOIN ancestors a ON a.parent_session_id=s.id
    ) SELECT 1 FROM ancestors WHERE id=?`).get(sessionId, run.workspace_id);
    if (!session || !belongsToWorkspace || session.id === run.workspace_id || session.project_id !== run.project_id) {
      throw new Error('Lane run root must be an on-entry child in the same project');
    }
    if (run.root_session_id && run.root_session_id !== sessionId) {
      throw new Error('Lane run already has a different root session');
    }
    const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET root_session_id=?, updated_at=? WHERE id=? AND root_session_id IS NULL`)
      .run(sessionId, time, runId);
    db.prepare(`UPDATE sessions SET lane_run_id=?, own_work_state='open', workflow_updated_at=?, workflow_reason=NULL
      WHERE id=?`).run(runId, time, sessionId);
    audit(db, runId, 'root_session_attached', { sessionId });
    return getRun(runId);
  });
}

export function beginWorkflowTurn(sessionId) {
  // Most executions are unrelated to lane runs. Avoid opening a transaction
  // for those hot-path sessions; the transaction below still re-reads state.
  if (!isParticipating(databaseManager.get().prepare('SELECT lane_run_id FROM sessions WHERE id=?').get(sessionId))) return null;
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!isParticipating(s) || s.own_work_state !== 'open') return null;
    const token = id(); const time = now();
    db.prepare(`UPDATE sessions SET workflow_turn_token=?, completion_requested_turn_token=NULL,
      completion_request_key=NULL, completion_requested_at=NULL, workflow_updated_at=? WHERE id=?`).run(token, time, sessionId);
    audit(db, s.lane_run_id, 'turn_started', { sessionId });
    return token;
  });
}

export function requestOwnWorkCompletion(sessionId, turnToken, requestKey) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
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
  if (!isParticipating(databaseManager.get().prepare('SELECT lane_run_id FROM sessions WHERE id=?').get(sessionId))) return null;
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!isParticipating(s) || s.own_work_state !== 'open') return null;
    if (s.workflow_turn_token !== turnToken || s.completion_requested_turn_token !== turnToken) return null;
    // A future schedule is an explicit continuation obligation, never success.
    if (s.scheduled_at || s.pending_prompt) return null;
    const time = now();
    db.prepare(`UPDATE sessions SET own_work_state='closed_successfully', own_work_closed_at=?,
      completion_requested_turn_token=NULL, completion_request_key=NULL, execution_state='idle', workflow_updated_at=? WHERE id=?`).run(time, time, sessionId);
    audit(db, s.lane_run_id, 'own_work_succeeded', { sessionId });
    return reconcileLaneRun(s.lane_run_id);
  });
}

/**
 * Terminally close a session's own-work obligation via failure or
 * cancellation (success goes through finalizeOwnWorkCompletion instead), and
 * reconcile its lane run (FR-9: permanent failures and user
 * stops/cancellations must never be interpreted as success). No-op — returns
 * null — for non-participating sessions or sessions whose own work is
 * already closed, so callers may invoke this unconditionally on every
 * error/stop path without checking participation first.
 * @param {string} sessionId
 * @param {'closed_failed'|'cancelled'} outcome
 * @param {string|null} [reason]
 * @returns {Object|null} The reconciled run, or null if this was a no-op
 */
export function closeOwnWork(sessionId, outcome, reason = null) {
  if (!isParticipating(databaseManager.get().prepare('SELECT lane_run_id FROM sessions WHERE id=?').get(sessionId))) return null;
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!isParticipating(s) || s.own_work_state !== 'open') return null;
    const time = now();
    db.prepare(`UPDATE sessions SET own_work_state=?, workflow_reason=?, own_work_closed_at=?,
      workflow_turn_token=NULL, completion_requested_turn_token=NULL, completion_request_key=NULL,
      execution_state='stopped', subtree_outcome=?, workflow_updated_at=? WHERE id=?`)
      .run(outcome, reason, time, outcome === 'closed_failed' ? 'failed' : 'cancelled', time, sessionId);
    audit(db, s.lane_run_id, outcome === 'closed_failed' ? 'own_work_failed' : 'own_work_cancelled', { sessionId, details: { reason } });
    return reconcileLaneRun(s.lane_run_id);
  });
}

/**
 * Update only the execution_state dimension (FR-5) for a participating
 * session — e.g. 'retrying' while an auto-reschedule after a transient error
 * is pending. Does not touch own_work_state: the obligation stays open. No-op
 * for non-participating sessions.
 * @param {string} sessionId
 * @param {string} executionState
 */
export function markExecutionState(sessionId, executionState) {
  const db = databaseManager.get();
  const s = db.prepare('SELECT lane_run_id FROM sessions WHERE id=?').get(sessionId);
  if (!isParticipating(s)) return;
  db.prepare('UPDATE sessions SET execution_state=?, workflow_updated_at=? WHERE id=?').run(executionState, now(), sessionId);
}

/**
 * FR-6/FR-7 pure roll-up rule: a session's subtree outcome from its own-work
 * state and the already-computed subtree outcomes of its direct blocking
 * children. Precedence — failed beats cancelled beats open beats succeeded —
 * so a single failed obligation anywhere in a subtree marks every ancestor's
 * subtree failed, even if a sibling subtree is merely cancelled or still open.
 * @param {string} ownWorkState - 'open'|'closed_successfully'|'closed_failed'|'cancelled'
 * @param {string[]} childSubtreeOutcomes - already-computed outcomes of direct children
 * @returns {'open'|'succeeded'|'failed'|'cancelled'}
 */
export function computeSubtreeOutcome(ownWorkState, childSubtreeOutcomes) {
  if (ownWorkState === 'closed_failed' || childSubtreeOutcomes.includes('failed')) return 'failed';
  if (ownWorkState === 'cancelled' || childSubtreeOutcomes.includes('cancelled')) return 'cancelled';
  if (ownWorkState !== 'closed_successfully') return 'open';
  if (childSubtreeOutcomes.some((o) => o !== 'succeeded')) return 'open';
  return 'succeeded';
}

/**
 * FR-6.4: persisted sessions are the source of truth. Recompute every
 * member's subtree_outcome bottom-up (leaves to root) from the member rows
 * themselves — not from any cached counter — and persist any value that
 * changed. Safe to call repeatedly (idempotent) and usable standalone as a
 * reconciliation query, independent of reconcileLaneRun.
 * @param {string} runId
 * @returns {string|null} The recomputed root subtree outcome, or null if the run has no root yet
 */
export function recomputeSubtreeOutcomes(runId) {
  const db = databaseManager.get();
  const run = db.prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run?.root_session_id) return null;
  const members = db.prepare('SELECT id, parent_session_id, own_work_state, subtree_outcome FROM sessions WHERE lane_run_id=?').all(runId);
  const byParent = new Map();
  for (const m of members) {
    if (!byParent.has(m.parent_session_id)) byParent.set(m.parent_session_id, []);
    byParent.get(m.parent_session_id).push(m);
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  const computed = new Map();
  const time = now();
  function resolve(node) {
    if (computed.has(node.id)) return computed.get(node.id);
    const childOutcomes = (byParent.get(node.id) || []).map((child) => resolve(child));
    const outcome = computeSubtreeOutcome(node.own_work_state, childOutcomes);
    computed.set(node.id, outcome);
    if (outcome !== node.subtree_outcome) {
      db.prepare('UPDATE sessions SET subtree_outcome=?, workflow_updated_at=? WHERE id=?').run(outcome, time, node.id);
    }
    return outcome;
  }
  const root = byId.get(run.root_session_id);
  return root ? resolve(root) : null;
}

// W4 (FR-9): closeOwnWork() is the single entry point that ever sets
// own_work_state to closed_failed/cancelled — see sessionExecution.js
// (permanent execution failure) and sessionManager.js#stopSession (user
// stop/cancellation). Both call through here to fail/cancel the run.
//
// W5 (FR-6/FR-7): the run-level predicate is now defined in terms of the
// freshly recomputed root subtree_outcome, matching FR-7's literal
// predicate table, rather than an ad hoc flat scan of all members.
export function reconcileLaneRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run || run.status !== 'open') return getRun(runId);
  const rootOutcome = recomputeSubtreeOutcomes(runId);
  if (rootOutcome === 'failed' || rootOutcome === 'cancelled') {
    const members = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
    const failed = members.find((s) => s.own_work_state === 'closed_failed');
    const cancelled = members.find((s) => s.own_work_state === 'cancelled');
    const state = rootOutcome; const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET status=?, failure_reason=?, ${state}_at=?, updated_at=? WHERE id=?`)
      .run(state, failed?.workflow_reason || cancelled?.workflow_reason || state, time, time, runId);
    audit(db, runId, `run_${state}`, { sessionId: failed?.id || cancelled?.id }); return getRun(runId);
  }
  if (rootOutcome === 'succeeded') return attemptLaneRunTransition(runId);
  return getRun(runId);
}

/**
 * Move the card into its target lane (via the same KanbanCardRepository
 * method the manual-move path uses) and broadcast KANBAN_CARD_MOVED,
 * mirroring kanbanService.moveCard's broadcast payload shape. No-op — does
 * not move or broadcast — when there is no structured target lane (e.g.
 * `shadow` mode, or `structured` mode with no completionTargetLaneId).
 * @returns {string|null} The target lane id, or null if nothing moved
 */
function moveCardForTransition(db, run, card) {
  const targetLaneId = (run.completion_mode === 'structured' && run.completion_target_lane_id) ? run.completion_target_lane_id : null;
  if (!targetLaneId) return null;
  const movedCard = kanbanCards.moveToLane(card.id, targetLaneId);
  const projectRow = db.prepare('SELECT project_id FROM sessions WHERE id=?').get(run.workspace_id);
  if (projectRow) {
    broadcastToProject(projectRow.project_id, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: projectRow.project_id,
      cardId: card.id,
      fromLaneId: card.lane_id,
      toLaneId: targetLaneId,
      card: movedCard,
    });
  }
  return targetLaneId;
}

/**
 * W6 (FR-8): apply a successful lane run's guarded Kanban transition.
 *
 * FR-8 guards are re-checked here, immediately before the mutating UPDATE, so
 * a stale/superseded run (AC-9) or a card that already moved out from under
 * this run can never be transitioned. The run-succeeded UPDATE doubles as the
 * concurrency guard: it is scoped to `WHERE status='open'`, so only the
 * caller that actually flips the row (winner.changes === 1) proceeds to move
 * the card — a duplicate/concurrent evaluator is a no-op (AC-12, AC-14).
 *
 * This function stays synchronous — it runs inside the same better-sqlite3
 * transaction as the run-succeeded write — and deliberately has no
 * dependency on kanbanService.js/kanbanTriggers.js, which both transitively
 * depend on sessionManager.js -> sessionExecution.js -> this module; pulling
 * them in here would create an import cycle. Instead, when a target-lane
 * move actually happened, the necessarily-async remainder (creating the next
 * lane run and starting its on-enter session) is handed back to the caller
 * via the returned `pendingTargetLaneTrigger` — see
 * kanbanService.triggerStructuredTransitionAutomation(), called from
 * sessionExecution.js right after finalizeOwnWorkCompletion().
 */
export function attemptLaneRunTransition(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run || run.status !== 'open') return getRun(runId);
  const card = db.prepare('SELECT * FROM kanban_cards WHERE id=?').get(run.card_id);
  if (!card || card.active_lane_run_id !== runId || card.lane_id !== run.source_lane_id) return getRun(runId);
  const time = now();
  const winner = db.prepare(`UPDATE kanban_lane_runs SET status='succeeded', succeeded_at=?, transition_applied_at=?, updated_at=? WHERE id=? AND status='open'`)
    .run(time, time, time, runId);
  if (winner.changes === 0) return getRun(runId);

  const targetLaneId = moveCardForTransition(db, run, card);
  db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=? WHERE id=?').run(now(), card.id);
  audit(db, runId, 'transition_applied');

  const result = getRun(runId);
  if (targetLaneId) {
    result.pendingTargetLaneTrigger = { workspaceSessionId: run.workspace_id, targetLaneId, cardId: card.id, sourceRunId: runId };
  }
  return result;
}

export function supersedeRunForCard(cardId, reason = 'manual_move') {
  // Legacy cards never participate in lane runs. Keep their move hot path
  // read-only instead of opening a transaction merely to discover that fact.
  const activeLaneRun = databaseManager.get()
    .prepare('SELECT active_lane_run_id FROM kanban_cards WHERE id=?')
    .get(cardId)?.active_lane_run_id;
  if (!activeLaneRun) return null;

  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const card = db.prepare('SELECT active_lane_run_id FROM kanban_cards WHERE id=?').get(cardId);
    if (!card?.active_lane_run_id) return null; const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET status='superseded', superseded_at=?, updated_at=?, failure_reason=? WHERE id=? AND status='open'`)
      .run(time, time, reason, card.active_lane_run_id);
    db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=? WHERE id=?').run(time, cardId);
    audit(db, card.active_lane_run_id, 'run_superseded', { details: { reason } }); return getRun(card.active_lane_run_id);
  });
}

function laneRunCounts(rows) {
  const open = rows.filter(s => s.own_work_state === 'open');
  const scheduled = open.filter(s => s.scheduled_at).sort((a, b) => a.scheduled_at - b.scheduled_at);
  const retrying = open.filter(s => s.execution_state === 'retrying');
  return {
    open, scheduled, retrying,
    failedCount: rows.filter(s => s.own_work_state === 'closed_failed').length,
    cancelledCount: rows.filter(s => s.own_work_state === 'cancelled').length,
    failedSessionId: rows.find(s => s.own_work_state === 'closed_failed')?.id || null,
  };
}

export function getRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run) return null; const rows = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
  const { open, scheduled, retrying, failedCount, cancelledCount, failedSessionId } = laneRunCounts(rows);
  const names = db.prepare(`SELECT (SELECT name FROM kanban_lanes WHERE id=?) AS source_name,
    (SELECT name FROM kanban_lanes WHERE id=?) AS target_name`).get(run.source_lane_id, run.completion_target_lane_id);
  const blocker = scheduled[0] || retrying[0] || open[0] || null;
  return { id: run.id, status: run.status, sourceLaneId: run.source_lane_id, sourceLaneName: names?.source_name || null,
    targetLaneId: run.completion_target_lane_id, targetLaneName: names?.target_name || null,
    rootSessionId: run.root_session_id, failureReason: run.failure_reason, createdAt: run.created_at,
    succeededAt: run.succeeded_at, failedAt: run.failed_at, cancelledAt: run.cancelled_at, supersededAt: run.superseded_at,
    openCount: open.length, scheduledCount: open.filter(s => s.scheduled_at).length,
    retryingCount: retrying.length, nextScheduledAt: scheduled[0]?.scheduled_at || null,
    failedCount, failedSessionId, cancelledCount,
    blockingSessionIds: open.map(s => s.id), blockingSessionId: blocker?.id || null,
    blockingReason: scheduled.length ? 'Waiting for scheduled work' : retrying.length ? 'Retrying automation' : open.length ? 'Waiting for descendants' : null };
}
