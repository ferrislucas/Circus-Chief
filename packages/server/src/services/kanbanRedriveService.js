/**
 * Guarded operator redrive for parked or ambiguously-failed lane-entry
 * events. Never dispatches blindly; see `redriveLaneEntryEvent`.
 */
import { databaseManager } from '../database.js';
import {
  createLaneRunForEntry, reviveLaneEntryWorkerForRetry, isStructured,
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

function inspectRedriveTarget(db, eventId) {
  const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  if (!event) return redriveBlocked(eventId, 'entry event not found');
  const eligible = event.status === 'needs_attention'
    || (event.status === 'failed' && String(event.last_error || '').startsWith('ambiguous_dispatch'));
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

function resetProvenForCompletion(event) {
  const live = databaseManager.get();
  const time = Date.now();
  live.prepare(`UPDATE kanban_lane_entry_events SET status='pending', attempt_count=0, next_attempt_at=?,
    last_error=?, updated_at=? WHERE id=? AND status IN ('needs_attention', 'failed')`)
    .run(time, `operator redrive: completing proven delivery (was: ${decisionStamp(event.last_error)})`, time, event.id);
}

function resetUnacceptedForRedelivery(event) {
  const live = databaseManager.get();
  const time = Date.now();
  live.prepare(`UPDATE kanban_lane_entry_events SET status='pending', delivery_phase='pending', dispatch_key=NULL,
    accepted_at=NULL, accepted_dispatch_key=NULL, attempt_count=0, next_attempt_at=?, last_error=?, updated_at=?
    WHERE id=? AND status IN ('needs_attention', 'failed')`)
    .run(time, `operator redrive: redelivering unaccepted dispatch (was: ${decisionStamp(event.last_error)})`, time, event.id);
}

function retireReplacedEvent(event, newEventId) {
  const live = databaseManager.get();
  const time = Date.now();
  live.prepare(`UPDATE kanban_lane_entry_events SET status='invalid',
    last_error=?, completed_at=?, updated_at=? WHERE id=?`)
    .run(`redriven by operator as event ${newEventId || 'unknown'} (was: ${decisionStamp(event.last_error)})`,
      time, time, event.id);
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
  const { event, run, child, acceptedProof } = inspected;
  const base = { eventId, runId: run.id, cardId: event.card_id, childSessionId: run.root_session_id };

  if (acceptedProof) {
    // The provider provably took this dispatch: re-enter pending WITHOUT
    // clearing the evidence, so the drain completes it without a new child.
    const plan = { plan: 'complete_proven', ...base };
    if (dryRun) return { ...plan, applied: false, blocked: false };
    resetProvenForCompletion(event);
    return { ...plan, applied: true, blocked: false, delivered: await drainLaneEntryTrigger(eventId) };
  }

  if (run.status === 'open') {
    // Never accepted and the run is still open: one careful redelivery on
    // the same run. The stale intent is cleared (as in the automatic FR-4
    // path) and the attempt budget is renewed by this explicit decision.
    const plan = { plan: 'redeliver', ...base };
    if (dryRun) return { ...plan, applied: false, blocked: false };
    resetUnacceptedForRedelivery(event);
    if (child) reviveLaneEntryWorkerForRetry(run.id, child.id);
    return { ...plan, applied: true, blocked: false, ...(await settleDrain(eventId)) };
  }

  // Never accepted and the run is terminal: mint a fresh entry event/run
  // explicitly and retire the old event with a linkage.
  const plan = { plan: 'fresh_entry', ...base, runStatus: run.status };
  if (dryRun) return { ...plan, applied: false, blocked: false };
  const replacement = createLaneRunForEntry({
    projectId: event.project_id, workspaceId: event.workspace_id, cardId: event.card_id,
    lane: { id: inspected.lane.id, completionTargetLaneId: inspected.lane.completion_target_lane_id,
      onEnterTemplateId: inspected.lane.on_enter_template_id, onEnterPrompt: inspected.lane.on_enter_prompt },
    cause: 'operator_redrive',
  });
  retireReplacedEvent(event, replacement?.laneEntryEventId);
  const settled = replacement?.laneEntryEventId ? await settleDrain(replacement.laneEntryEventId) : { delivered: false, drainError: 'replacement entry event was not created' };
  return { ...plan, applied: true, blocked: false, newEventId: replacement?.laneEntryEventId || null,
    newRunId: replacement?.id || null, ...settled };
}
