/**
 * Guarded operator redrive for parked or ambiguously-failed lane-entry
 * events. Never dispatches blindly; see `redriveLaneEntryEvent`.
 */
import { databaseManager } from '../database.js';
import {
  insertLaneRunForEntry, reviveLaneEntryWorkerForRetryInTx, isStructured,
} from './workflowSessionService.js';
import { drainLaneEntryTrigger } from './kanbanService.js';
import { isSessionActive } from './sessionManager.js';

function redriveBlocked(eventId, reason, detail = {}) {
  return { eventId, applied: false, blocked: true, reason, ...detail };
}

function decisionStamp(previous) {
  return String(previous || '').slice(0, 100);
}

/**
 * Load and verify the redrive target. Read-only: safe for dry-run on a
 * read-only database handle.
 * @returns {Object} Either a blocked result or the verified context
 */
/**
 * Verify the card/run/lane ownership a redrive would act on. Read-only.
 * @returns {{card:Object,lane:Object,run:Object}|{blocked:string}}
 */
function verifyRedriveOwnership(db, event) {
  const card = db.prepare('SELECT * FROM kanban_cards WHERE id=?').get(event.card_id);
  if (!card) return { blocked: 'target card no longer exists' };
  if (card.lane_id !== event.lane_id) {
    return { blocked: 'card has moved out of the event lane; move it back to mint a fresh entry event' };
  }
  const lane = db.prepare('SELECT id, on_enter_prompt, on_enter_template_id, completion_target_lane_id FROM kanban_lanes WHERE id=?')
    .get(event.lane_id);
  if (!lane || !isStructured({
    completionTargetLaneId: lane.completion_target_lane_id,
    onEnterTemplateId: lane.on_enter_template_id,
    onEnterPrompt: lane.on_enter_prompt,
  })) {
    return { blocked: 'target lane has no on-enter automation' };
  }
  const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(event.id);
  if (!run) return { blocked: 'target lane run is missing' };
  // The card's current pointers fence stale recoveries: when they name
  // different work (a manual move minted a newer entry/run), this event is
  // stale even if it sits in the same lane. Null pointers are legacy rows
  // that predate pointer tracking and do not veto.
  if (card.active_lane_run_id != null && card.active_lane_run_id !== run.id) {
    return { blocked: 'card now points at a newer lane run; redrive the current entry event instead' };
  }
  if (card.lane_entry_event_id != null && card.lane_entry_event_id !== event.id) {
    return { blocked: 'card now points at a newer entry event; redrive the current entry event instead' };
  }
  const competing = db.prepare(`SELECT id FROM kanban_lane_entry_events
    WHERE card_id=? AND id!=? AND status IN ('pending', 'claimed', 'needs_attention')`).get(event.card_id, event.id);
  if (competing) return { blocked: `another entry event ${competing.id} is already active for this card` };
  return { card, lane, run };
}

/** A persisted `running`/`starting` row or a live in-memory execution both veto redrive. */
function isRedriveChildLive(child) {
  return Boolean(child && (isSessionActive(child.id) || child.status === 'running' || child.status === 'starting'));
}

/** Only a matching accepted dispatch key (or a legacy acknowledgement) proves the provider took the turn. */
function hasRedriveAcceptanceProof(event) {
  return (event.accepted_dispatch_key != null && event.accepted_dispatch_key === event.dispatch_key)
    || event.dispatch_acknowledged_at != null;
}

/** Acceptance without a valid attachment stays parked for investigation. */
function verifyRedriveEvidence(event, run, child) {
  const acceptedProof = hasRedriveAcceptanceProof(event);
  const attachmentValid = Boolean(run.root_session_id) && (!child || child.project_id === run.project_id);
  if (acceptedProof && !attachmentValid) {
    return { blocked: 'acceptance evidence has no valid attached run; investigate before redrive',
      detail: { runId: run.id, childSessionId: run.root_session_id } };
  }
  return { acceptedProof };
}

/**
 * A failed event holding dispatch intent without acceptance proof is an
 * uncertain dispatch regardless of its (possibly stale) last-error text:
 * uncertainty must stay visible and redrivable instead of disappearing
 * behind an outdated diagnostic.
 */
function hasUnknownDispatchEvidence(event) {
  return event.delivery_phase === 'dispatch_intent' && event.dispatch_key != null
    && event.dispatch_acknowledged_at == null
    && (event.accepted_dispatch_key == null || event.accepted_dispatch_key !== event.dispatch_key);
}

function inspectRedriveTarget(db, eventId) {
  const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  if (!event) return redriveBlocked(eventId, 'entry event not found');
  const eligible = event.status === 'needs_attention'
    || (event.status === 'failed' && String(event.last_error || '').startsWith('ambiguous_dispatch'))
    || (event.status === 'failed' && hasUnknownDispatchEvidence(event));
  if (!eligible) {
    return redriveBlocked(eventId, `event status '${event.status}' is not redrivable`, { status: event.status });
  }
  const ownership = verifyRedriveOwnership(db, event);
  if (ownership.blocked) return redriveBlocked(eventId, ownership.blocked);
  const { card, lane, run } = ownership;
  const child = run.root_session_id ? db.prepare('SELECT * FROM sessions WHERE id=?').get(run.root_session_id) : null;
  if (isRedriveChildLive(child)) {
    return redriveBlocked(eventId, 'attached child execution may still be active; stop it or let startup recovery settle it first',
      { childSessionId: child.id, childStatus: child.status });
  }
  const evidence = verifyRedriveEvidence(event, run, child);
  if (evidence.blocked) return redriveBlocked(eventId, evidence.blocked, evidence.detail);
  return { event, card, lane, run, child, acceptedProof: evidence.acceptedProof };
}

/** A concurrent change between inspection and apply refuses the redrive. */
function concurrentChangeError() {
  return new Error('redrive target changed concurrently; re-run dry-run to re-inspect');
}

function isConcurrentChangeError(error) {
  return error?.message === concurrentChangeError().message
    || error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || /UNIQUE constraint failed/.test(error?.message || '');
}

/**
 * Re-read and re-verify the redrive target inside the apply transaction.
 * Returns the fresh context or a blocked reason; the caller must not write
 * when blocked. In-process execution (live session) and persisted state are
 * both rechecked — missing or conflicting evidence is never proof of
 * non-start.
 */
function revalidateRedriveTarget(db, inspected) {
  const fresh = inspectRedriveTarget(db, inspected.event.id);
  if (fresh.blocked || !fresh.event) return { blocked: fresh.blocked || 'entry event vanished before apply' };
  return fresh;
}

/**
 * Apply one redrive plan as ONE write transaction: revalidate ownership and
 * evidence, then atomically reset the eligible event (or create/link the
 * fresh event/run, update card pointers, and retire the original). Every
 * mutation is conditional; a missed condition throws so the whole apply
 * rolls back — replacement and retirement commit together or neither
 * commits. No provider work runs inside the transaction.
 * @returns {{ok:true,replacement:Object|null}|{ok:false,reason:string}}
 */
function applyRedrivePlanInTx(db, inspected, plan) {
  const fresh = revalidateRedriveTarget(db, inspected);
  if (fresh.blocked) return { ok: false, reason: fresh.blocked };
  const time = Date.now();
  if (plan === 'complete_proven') {
    const reset = db.prepare(`UPDATE kanban_lane_entry_events SET status='pending', attempt_count=0, next_attempt_at=?,
      last_error=?, updated_at=? WHERE id=? AND status IN ('needs_attention', 'failed')`)
      .run(time, `operator redrive: completing proven delivery (was: ${decisionStamp(fresh.event.last_error)})`,
        time, fresh.event.id);
    if (reset.changes !== 1) throw concurrentChangeError();
    return { ok: true, replacement: null };
  }
  if (plan === 'redeliver') {
    const reset = db.prepare(`UPDATE kanban_lane_entry_events SET status='pending', delivery_phase='pending', dispatch_key=NULL,
      accepted_at=NULL, accepted_dispatch_key=NULL, attempt_count=0, next_attempt_at=?, last_error=?, updated_at=?
      WHERE id=? AND status IN ('needs_attention', 'failed')`)
      .run(time, `operator redrive: redelivering unaccepted dispatch (was: ${decisionStamp(fresh.event.last_error)})`,
        time, fresh.event.id);
    if (reset.changes !== 1) throw concurrentChangeError();
    if (fresh.child) reviveLaneEntryWorkerForRetryInTx(db, fresh.run.id, fresh.child.id);
    return { ok: true, replacement: null };
  }
  const replacement = insertLaneRunForEntry(db, {
    projectId: fresh.event.project_id, workspaceId: fresh.event.workspace_id, cardId: fresh.event.card_id,
    lane: { id: fresh.lane.id, completionTargetLaneId: fresh.lane.completion_target_lane_id,
      onEnterTemplateId: fresh.lane.on_enter_template_id, onEnterPrompt: fresh.lane.on_enter_prompt },
    cause: 'operator_redrive',
  });
  if (!replacement?.laneEntryEventId) throw concurrentChangeError();
  const retired = db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid',
    last_error=?, completed_at=?, updated_at=?
    WHERE id=? AND status IN ('needs_attention', 'failed')`)
    .run(`redriven by operator as event ${replacement.laneEntryEventId} (was: ${decisionStamp(fresh.event.last_error)})`,
      time, time, fresh.event.id);
  if (retired.changes !== 1) throw concurrentChangeError();
  return { ok: true, replacement };
}

async function settleDrain(eventId) {
  try {
    return { delivered: await drainLaneEntryTrigger(eventId), drainError: null };
  } catch (error) {
    return { delivered: false, drainError: error?.message || String(error) };
  }
}

/**
 * Guarded operator redrive for one parked or ambiguously-failed lane-entry
 * event. Never dispatches blindly:
 *
 * - Verifies card/run ownership (card still in the event lane, run attached).
 * - Refuses while the attached child may still be executing.
 * - Proven acceptance completes WITHOUT a new child (plan `complete_proven`).
 * - A never-accepted dispatch on an open run is reset for one careful
 *   redelivery on the same run (plan `redeliver`), with the attempt budget
 *   renewed by this explicit decision.
 * - A never-accepted dispatch on a terminal run mints a FRESH entry
 *   event/run and links it to the retired event (plan `fresh_entry`); the
 *   old event is never silently reopened.
 * - Uncertain evidence (acceptance without a valid attachment) stays parked
 *   for investigation — redrive does not guess.
 *
 * Dry-run reports the plan without writing. Apply records the decision in
 * `last_error` and, for replacements, links old and new events both ways.
 */
export async function redriveLaneEntryEvent(eventId, { dryRun = true, db = databaseManager.get() } = {}) {
  const inspected = inspectRedriveTarget(db, eventId);
  if (inspected.blocked || !inspected.event) return inspected;
  const { event, run, acceptedProof } = inspected;
  const base = { eventId, runId: run.id, cardId: event.card_id, childSessionId: run.root_session_id };

  if (acceptedProof) {
    // The provider provably took this dispatch: re-enter pending WITHOUT
    // clearing the evidence, so the drain completes it without a new child.
    const plan = { plan: 'complete_proven', ...base };
    if (dryRun) return { ...plan, applied: false, blocked: false };
    return applyRedrive(inspected, plan, eventId);
  }

  if (run.status === 'open') {
    // Never accepted and the run is still open: one careful redelivery on
    // the same run. The stale intent is cleared (as in the automatic FR-4
    // path) and the attempt budget is renewed by this explicit decision.
    const plan = { plan: 'redeliver', ...base };
    if (dryRun) return { ...plan, applied: false, blocked: false };
    return applyRedrive(inspected, plan, eventId);
  }

  // Never accepted and the run is terminal: mint a fresh entry event/run
  // explicitly and retire the old event with a linkage.
  const plan = { plan: 'fresh_entry', ...base, runStatus: run.status };
  if (dryRun) return { ...plan, applied: false, blocked: false };
  return applyRedrive(inspected, plan, null);
}

/**
 * Commit one redrive plan, then drain the committed target. The mutation
 * commits atomically (or not at all); provider work runs only after commit,
 * against the committed event. Concurrent-change races refuse with
 * applied:false instead of claiming success; unexpected failures propagate.
 */
async function applyRedrive(inspected, plan, drainEventId) {
  let outcome;
  try {
    outcome = databaseManager.transaction(() => applyRedrivePlanInTx(databaseManager.get(), inspected, plan.plan));
  } catch (error) {
    if (isConcurrentChangeError(error)) return { ...plan, applied: false, blocked: true, reason: error.message };
    throw error;
  }
  if (!outcome.ok) return { ...plan, applied: false, blocked: true, reason: outcome.reason };
  if (plan.plan === 'fresh_entry') {
    const settled = await settleDrain(outcome.replacement.laneEntryEventId);
    return { ...plan, applied: true, blocked: false, newEventId: outcome.replacement.laneEntryEventId,
      newRunId: outcome.replacement.id, ...settled };
  }
  return { ...plan, applied: true, blocked: false, ...(await settleDrain(drainEventId)) };
}
