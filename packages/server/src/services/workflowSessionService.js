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
import { activeSessions } from './streamEventHandler.js';
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

function activeRunOwnsSession(db, session) {
  if (!isParticipating(session)) return true;
  return Boolean(db.prepare(`SELECT 1 FROM kanban_lane_runs r
    JOIN kanban_cards c ON c.id=r.card_id
    WHERE r.id=? AND r.status='open' AND c.active_lane_run_id=r.id AND c.lane_id=r.source_lane_id`)
    .get(session.lane_run_id));
}

/**
 * The single ownership predicate for every asynchronous lane-worker action.
 * Keep this in the database layer rather than trusting a session object read
 * before an await: a manual move may supersede the run at any point.
 */
export function activeLaneRunOwnsSession(sessionId) {
  const db = databaseManager.get();
  const session = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
  return Boolean(session?.own_work_state === 'open' && activeRunOwnsSession(db, session));
}

/** Execute a synchronous write only while a lane worker still owns its run.
 * The predicate and write share one SQLite transaction, closing the gap
 * between an explicit schedule/reschedule request and a manual move. */
export function withActiveLaneRunOwnership(sessionId, mutation) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const session = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!session) return null;
    if (session.lane_run_id && (session.own_work_state !== 'open' || !activeRunOwnsSession(db, session))) {
      return null;
    }
    return mutation();
  });
}

/** Clear state which could otherwise revive a superseded worker. */
function clearExecutableMemberState(db, runId, reason, time) {
  return db.prepare(`UPDATE sessions SET own_work_state='cancelled', own_work_closed_at=?, workflow_reason=?,
    workflow_updated_at=?, execution_state=CASE WHEN execution_state='running' THEN execution_state ELSE 'stopped' END,
    scheduled_at=NULL, pending_prompt=NULL, pending_model=NULL, pending_conversation_id=NULL,
    auto_send_pending_prompt=0, reschedule_count=0
    WHERE lane_run_id=? AND own_work_state='open'`).run(time, reason, time, runId);
}

/** Scheduler/start guard. Stale lane workers lose their pending work before
 * they can create another provider process. */
export function claimWorkflowSessionStart(sessionId) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const session = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!session?.lane_run_id) return true;
    if (session.own_work_state === 'open' && activeRunOwnsSession(db, session)) {
      audit(db, session.lane_run_id, 'scheduled_start_claimed', { sessionId });
      return true;
    }
    const time = now();
    db.prepare(`UPDATE sessions SET scheduled_at=NULL, pending_prompt=NULL, pending_model=NULL,
      auto_send_pending_prompt=0, execution_state='stopped', workflow_updated_at=? WHERE id=?`).run(time, sessionId);
    audit(db, session.lane_run_id, 'stale_start_rejected', { sessionId });
    return false;
  });
}

/**
 * A lane is automated only when it has entry work. Target-only lanes are
 * rejected at configuration time rather than silently borrowing a session.
 * @returns {boolean}
 */
export function isStructured(lane) {
  // Target-only lanes are rejected by the lane repository, but retaining
  // this guard makes reconciliation of a pre-cutover row deterministic:
  // it receives a durable owner rather than falling back to legacy moves.
  return Boolean(lane?.completionTargetLaneId || lane?.onEnterTemplateId || lane?.onEnterPrompt);
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

export function createLaneRunForEntry({ projectId, workspaceId, cardId, lane, cause = 'card_added', priorLaneRunId = null, entryEventId = null }) {
  if (!isStructured(lane)) return null;
  const db = databaseManager.get();
  const causeRunId = causedByRunId(cause, priorLaneRunId);
  if (causeRunId && !entryEventId) {
    const existingEvent = db.prepare('SELECT id FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(causeRunId);
    if (existingEvent) return runForEntryEvent(db, existingEvent.id);
  }
  try {
    return databaseManager.transaction(() => {
      const db2 = databaseManager.get(); const time = now();
      const eventId = entryEventId || id(); const runId = id();
      const key = `${cause}:${cardId}:${lane.id}:${eventId}`;
      if (!entryEventId) db2.prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,'completed',?,?,?)`)
        .run(eventId, key, projectId, workspaceId, cardId, lane.id, cause, causeRunId, time, time, time);
      db2.prepare(`INSERT INTO kanban_lane_runs
        (id,lane_entry_event_id,prior_lane_run_id,project_id,workspace_id,card_id,source_lane_id,
         completion_target_lane_id,root_session_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'open',?,?)`)
        .run(runId, eventId, priorLaneRunId, projectId, workspaceId, cardId, lane.id,
          lane.completionTargetLaneId, null, time, time);
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
    if (!isParticipating(s) || s.own_work_state !== 'open' || !activeRunOwnsSession(db, s)) return null;
    const executionStateBeforeTurn = s.execution_state;
    const time = now();
    db.prepare('UPDATE sessions SET execution_state=\'running\', workflow_updated_at=? WHERE id=?').run(time, sessionId);
    audit(db, s.lane_run_id, 'turn_started', { sessionId });
    return { executionStateBeforeTurn };
  });
}

/**
 * Close own work when a successful server-side turn has no continuation.
 * Lane workers signal that they have more work by self-scheduling; a plain
 * turn end is deliberately the contract for "own work done". Interactive
 * workers needing a future turn must therefore schedule that turn first.
 */
export function finalizeOwnWorkCompletion(sessionId) {
  if (!isParticipating(databaseManager.get().prepare('SELECT lane_run_id FROM sessions WHERE id=?').get(sessionId))) return null;
  return databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!isParticipating(s) || s.own_work_state !== 'open') return null;
    // A future schedule is an explicit continuation obligation, never success.
    if (s.scheduled_at || s.pending_prompt) return null;
    const time = now();
    db.prepare(`UPDATE sessions SET own_work_state='closed_successfully', own_work_closed_at=?,
      execution_state='idle', workflow_updated_at=? WHERE id=?`).run(time, time, sessionId);
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
  databaseManager.transaction(() => {
    const db = databaseManager.get(); const s = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
    if (!isParticipating(s) || !activeRunOwnsSession(db, s)) return;
    db.prepare('UPDATE sessions SET execution_state=?, workflow_updated_at=? WHERE id=?').run(executionState, now(), sessionId);
  });
}

/**
 * FR-9.8: A graceful provider limit/outage leaves a participating session's
 * own work open, but makes its waiting state visible. The guards prevent an
 * outer held turn from overwriting a nested auto-send continuation that has
 * already scheduled or completed real work.
 */
export function markHeldForLimit(sessionId) {
  const db = databaseManager.get();
  const time = now();
  const held = db.prepare(`UPDATE sessions SET execution_state='paused', workflow_updated_at=?
    WHERE id=? AND lane_run_id IS NOT NULL AND own_work_state='open'
      AND scheduled_at IS NULL AND pending_prompt IS NULL`)
    .run(time, sessionId);
  if (held.changes !== 1) return false;
  const session = db.prepare(SELECT_SESSION_BY_ID).get(sessionId);
  // Include the timestamp for diagnostics and a per-turn nonce for audit's
  // idempotency key: two very fast, distinct turns can share a millisecond.
  audit(db, session.lane_run_id, 'own_work_held_for_limit', { sessionId, details: { heldAt: time, turnId: id() } });
  return true;
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
 * when the lane has no completion target).
 * @returns {string|null} The target lane id, or null if nothing moved
 */
function moveCardForTransition(db, run, card) {
  const targetLaneId = run.completion_target_lane_id || null;
  if (!targetLaneId) return null;
  const movedCard = kanbanCards.moveToLane(card.id, targetLaneId);
  if (run.project_id) {
    broadcastToProject(run.project_id, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: run.project_id,
      cardId: card.id,
      fromLaneId: card.lane_id,
      toLaneId: targetLaneId,
      card: movedCard,
    });
  }
  return targetLaneId;
}

function enqueueTargetLaneTrigger(db, { run, card, targetLaneId, time }) {
  const eventId = id();
  db.prepare(`INSERT INTO kanban_lane_entry_events
    (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`)
    .run(eventId, `completion:${run.id}`, run.project_id, run.workspace_id, card.id,
      targetLaneId, 'completion', run.id, time, time);
  return eventId;
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
  const laneEntryEventId = targetLaneId ? enqueueTargetLaneTrigger(db, { run, card, targetLaneId, time }) : null;
  db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=? WHERE id=?').run(now(), card.id);
  audit(db, runId, 'transition_applied');

  const result = getRun(runId);
  if (targetLaneId) {
    result.pendingTargetLaneTrigger = { workspaceSessionId: run.workspace_id, targetLaneId, cardId: card.id, sourceRunId: runId, laneEntryEventId };
  }
  return result;
}

export function supersedeLaneRun(runId, reason = 'manual_move') {
  const candidate = databaseManager.get().prepare('SELECT id FROM kanban_lane_runs WHERE id=? AND status=\'open\'').get(runId);
  if (!candidate) return null;
  const result = databaseManager.transaction(() => {
    const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
    if (!run || run.status !== 'open') return null;
    const time = now();
    db.prepare(`UPDATE kanban_lane_runs SET status='superseded', superseded_at=?, updated_at=?, failure_reason=? WHERE id=? AND status='open'`)
      .run(time, time, reason, runId);
    clearExecutableMemberState(db, runId, reason, time);
    db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, updated_at=? WHERE active_lane_run_id=?').run(time, runId);
    audit(db, runId, 'run_superseded', { details: { reason } });
    for (const member of db.prepare('SELECT id FROM sessions WHERE lane_run_id=?').all(runId)) {
      audit(db, runId, 'member_cancelled_on_supersession', { sessionId: member.id, details: { reason } });
    }
    return getRun(runId);
  });
  if (result) {
    for (const { id: sessionId } of databaseManager.get().prepare('SELECT id FROM sessions WHERE lane_run_id=?').all(result.id)) {
      activeSessions.get(sessionId)?.controller?.abort();
    }
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

  return supersedeLaneRun(activeLaneRun, reason);
}

function laneRunCounts(rows) {
  const open = rows.filter(s => s.own_work_state === 'open');
  const scheduled = open.filter(s => s.scheduled_at).sort((a, b) => a.scheduled_at - b.scheduled_at);
  const retrying = open.filter(s => s.execution_state === 'retrying');
  const paused = open.filter(s => s.execution_state === 'paused');
  return {
    open, scheduled, retrying, paused,
    failedCount: rows.filter(s => s.own_work_state === 'closed_failed').length,
    cancelledCount: rows.filter(s => s.own_work_state === 'cancelled').length,
    failedSessionId: rows.find(s => s.own_work_state === 'closed_failed')?.id || null,
  };
}

function findOwnWorkState(sessions, sessionId) {
  return sessions.find(session => session.id === sessionId)?.own_work_state || null;
}

function blockerDetails({ scheduled, retrying, paused, open }) {
  const groups = [
    [scheduled, 'Waiting for scheduled work'],
    [retrying, 'Retrying automation'],
    [paused, 'Paused — provider limit or outage'],
    [open, 'Waiting for descendants'],
  ];
  const [sessions, reason] = groups.find(([members]) => members.length) || [];
  return { session: sessions?.[0] || null, reason: reason || null };
}

export function getRun(runId) {
  const db = databaseManager.get(); const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run) return null; const rows = db.prepare('SELECT * FROM sessions WHERE lane_run_id=?').all(runId);
  const { open, scheduled, retrying, paused, failedCount, cancelledCount, failedSessionId } = laneRunCounts(rows);
  const names = db.prepare(`SELECT (SELECT name FROM kanban_lanes WHERE id=?) AS source_name,
    (SELECT name FROM kanban_lanes WHERE id=?) AS target_name`).get(run.source_lane_id, run.completion_target_lane_id);
  const blocker = blockerDetails({ scheduled, retrying, paused, open });
  return { id: run.id, status: run.status, sourceLaneId: run.source_lane_id, sourceLaneName: names?.source_name || null,
    targetLaneId: run.completion_target_lane_id, targetLaneName: names?.target_name || null,
    rootSessionId: run.root_session_id, rootOwnWorkState: findOwnWorkState(rows, run.root_session_id),
    failureReason: run.failure_reason, createdAt: run.created_at,
    succeededAt: run.succeeded_at, failedAt: run.failed_at, cancelledAt: run.cancelled_at, supersededAt: run.superseded_at,
    openCount: open.length, scheduledCount: open.filter(s => s.scheduled_at).length,
    retryingCount: retrying.length, pausedCount: paused.length, nextScheduledAt: scheduled[0]?.scheduled_at || null,
    failedCount, failedSessionId, cancelledCount,
    blockingSessionIds: open.map(s => s.id), blockingSessionId: blocker.session?.id || null,
    blockingReason: blocker.reason };
}
