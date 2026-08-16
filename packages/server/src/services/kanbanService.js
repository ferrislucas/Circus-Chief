/* eslint-disable max-lines -- one durable state machine is easier to audit together */
import crypto from 'crypto';
import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  sessions,
  projects,
  databaseManager,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { triggerOnEnterTemplate, triggerOnEnterPrompt } from './kanbanTriggers.js';
import { createLaneRunForEntry, supersedeRunForCard, completeRunForSelfMove, isStructured, resolveCardActor } from './workflowSessionService.js';
import { buildFullBoardResponse } from './kanbanBoardResponse.js';
import {
  beginLaneEntryDelivery,
  isLaneEntryDeliveryStopping,
  stopLaneEntryDelivery,
  trackLaneEntryDelivery,
} from './laneEntryDeliveryCoordinator.js';

/**
 * Get the full board with all lanes and cards for a project.
 * Lazy-creates the board with default lanes if it doesn't exist.
 *
 * @param {string} projectId - The project ID
 * @returns {Object|null} Full board with lanes and cards, or null if the project does not exist
 */
export function getFullBoard(projectId) {
  const project = projects.getById(projectId);
  if (!project) {
    return null;
  }

  const board = kanbanBoards.getOrCreateForProject(projectId);
  return buildFullBoardResponse(board);
}

/**
 * Resolve any session id to its workspace root id.
 * If the session has no parent chain, the id itself is returned.
 *
 * @param {string} sessionId - Any session id (root or child)
 * @returns {string} Workspace root id
 */
function resolveWorkspaceId(sessionId) {
  return sessions.getRootSessionId(sessionId) || sessionId;
}

export async function triggerLaneEntryAutomation(sessionId, laneId, options = {}) {
  const { runOnEnterTemplate = true, depth = 0, laneRunId = null, childSessionId = null,
    beforeDispatch, abortController } = options;

  if (!runOnEnterTemplate) return { delivered: true, rootSessionId: null };

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  let result = { delivered: true, rootSessionId: null };
  if (lane?.onEnterTemplateId) {
    result = await triggerOnEnterTemplate(sessionId, lane, {
      depth, laneRunId, childSessionId, beforeDispatch, abortController,
    });
  } else if (lane?.onEnterPrompt) {
    result = await triggerOnEnterPrompt(sessionId, lane, {
      depth, laneRunId, childSessionId, beforeDispatch, abortController,
    });
  }
  if (!result?.delivered) throw new Error(`Lane-entry delivery failed: ${result?.reason || 'unknown error'}`);
  return result;
}

/**
 * Add a session to the kanban board.
 *
 * @param {string} sessionId - The session ID
 * @param {string} laneId - The lane to add the session to
 * @param {Object} [options] - Options
 * @param {number} [options.sortOrder] - Optional sort order
 * @param {boolean} [options.runOnEnterTemplate=true] - Whether to run lane on-enter automation
 * @param {number} [options.depth=0] - Current recursion depth for template triggers
 * @returns {Object} The created card
 * @throws {Error} If session already has a card on the board
 */
export async function addSessionToBoard(sessionId, laneId, options = {}) {
  const { sortOrder, runOnEnterTemplate = true, depth = 0, finalizeMutation } = options;

  // Normalize to workspace root — all cards are keyed to the root session.
  const workspaceId = resolveWorkspaceId(sessionId);

  // The board transition and its durable intent are one unit of work.  In
  // particular, never expose a card that entered an automated lane without
  // its lane-entry event/run after a crash or constraint failure.
  const rootSession = sessions.getById(workspaceId);
  const lane = kanbanLanes.getById(laneId);
  const { card, laneRun, finalizedResult } = databaseManager.transaction(() => {
    if (kanbanCards.getBySessionId(workspaceId)) {
      throw new Error('Session already has a card on the board');
    }
    const createdCard = kanbanCards.create(laneId, workspaceId, { sortOrder });
    const createdRun = rootSession && runOnEnterTemplate && isStructured(lane)
      ? createLaneRunForEntry({ projectId: rootSession.projectId, workspaceId, cardId: createdCard.id, lane })
      : null;
    const result = finalizeMutation?.({ card: createdCard, eventId: createdRun?.laneEntryEventId || null });
    return { card: createdCard, laneRun: createdRun, finalizedResult: result };
  });

  // Delivery remains detached from the committed mutation. It only wakes the
  // durable worker and therefore cannot invalidate a successful transition.
  if (rootSession) {
    broadcastToProject(rootSession.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
      projectId: rootSession.projectId,
      card,
      laneId,
    });

    // Lane entry automation fires on the workspace root (consistent with
    // "all sessions in a workspace move together").
    const rootDepth = rootSession.laneTriggerDepth || 0;
    // Every automated entry is committed before it is delivered.  This is the
    // durable success boundary for add/move/completion alike.
    if (laneRun) {
      scheduleLaneEntryDelivery(laneRun.laneEntryEventId, { depth: depth || rootDepth });
      // Let the accepted handoff reach its first asynchronous boundary so
      // callers retain the established immediate session-created UX, without
      // making their result dependent on delivery success.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return finalizedResult ?? card;
}

/**
 * Move a card to a different lane, optionally triggering the on-enter template.
 *
 * @param {string} cardId - The card ID
 * @param {string} targetLaneId - The target lane ID
 * @param {Object} [options] - Options
 * @param {number} [options.sortOrder] - Optional sort order in target lane
 * @param {boolean} [options.runOnEnterTemplate=true] - Whether to run the on-enter template
 * @param {number} [options.depth=0] - Current recursion depth for template triggers
 * @param {string|null} [options.actorSessionId] - Session attributed to an
 *   agent-facing request. The service validates its active-run membership.
 * @returns {Promise<Object>} The moved card
 */
export async function moveCard(cardId, targetLaneId, options = {}) {
  const { sortOrder, runOnEnterTemplate = true, depth = 0, finalizeMutation, actorSessionId = null } = options;

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    throw new Error('Card not found');
  }

  const fromLaneId = card.laneId;

  // Get session for project ID and broadcast
  const sessionId = card.sessions?.[0]?.id;
  const session = sessionId ? sessions.getById(sessionId) : null;
  const lane = kanbanLanes.getById(targetLaneId);
  // Supersession, movement, and the successor entry intent must commit
  // together. A delivery failure after this point is retryable outbox work.
  const { movedCard, laneRun, finalizedResult, selfMove } = databaseManager.transaction(() => {
    // A worker's move is a durable exit-lane declaration. The card remains in
    // its source lane until the worker's subtree has completed.
    const actor = resolveCardActor(databaseManager.get(), cardId, actorSessionId);
    const selfMoveResult = actor
      ? completeRunForSelfMove(cardId, targetLaneId, actorSessionId, { runOnEnterTemplate })
      : null;
    // An attributed agent may interrupt another worker's run. Preserve that
    // fact for audits; only a UI/external move is a manual supersession.
    const cause = actorSessionId ? 'agent_move' : 'manual_move';
    if (!selfMoveResult) supersedeRunForCard(cardId, cause);
    const updatedCard = selfMoveResult ? kanbanCards.getByIdWithLane(cardId) : kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);
    // A self-move's successor is created by finalizeOwnWorkCompletion after
    // the initiating turn has actually ended. Starting it here would allow
    // two lane workers to mutate the same workspace concurrently.
    const createdRun = !selfMoveResult && session && runOnEnterTemplate && isStructured(lane)
      ? createLaneRunForEntry({ projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause })
      : null;
    const responseCard = selfMoveResult
      ? { ...updatedCard, deferred: true, chosenExitLaneId: selfMoveResult.chosenExitLaneId }
      : updatedCard;
    const result = finalizeMutation?.({ card: responseCard, eventId: createdRun?.laneEntryEventId || null });
    return { movedCard: responseCard, laneRun: createdRun, finalizedResult: result, selfMove: Boolean(selfMoveResult) };
  });

  if (session && !selfMove) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    if (laneRun) {
      scheduleLaneEntryDelivery(laneRun.laneEntryEventId, { depth });
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return finalizedResult ?? movedCard;
}

/**
 * W6 (FRD: Kanban Lane-Run Structured Completion, FR-8): finish a
 * structured lane-run's transition into the target lane's on-enter
 * automation.
 *
 * The DB transition itself (marking the run succeeded, moving the card, and
 * assigning sort_order) already happened synchronously and atomically inside
 * workflowSessionService.js's attemptLaneRunTransition. Its move broadcast is
 * emitted immediately after that transaction commits. This module cannot be
 * imported there (kanbanService -> kanbanTriggers -> sessionManager ->
 * sessionExecution -> workflowSessionService would cycle), so it hands back a
 * `pendingTargetLaneTrigger` descriptor for the necessarily-async remainder:
 * creating the target lane's next run and starting its on-enter session.
 *
 * @param {{ workspaceSessionId: string, targetLaneId: string, cardId: string, sourceRunId: string }} pending
 */
export async function triggerStructuredTransitionAutomation(pending) {
  const { workspaceSessionId } = pending;
  const workspaceSession = sessions.getById(workspaceSessionId);
  if (!workspaceSession) return;

  const laneRun = pending.laneEntryEventId
    ? databaseManager.get().prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(pending.laneEntryEventId)
    : null;

  // Completion commits an automated lane's entry event and run together.
  // A descriptor without its run is an invariant violation, not a request to
  // reconstruct ownership after the card move has already been exposed.
  if (!laneRun) throw new Error(`Target lane run is missing for entry event ${pending.laneEntryEventId || 'unknown'}`);
  return drainLaneEntryTrigger(laneRun.lane_entry_event_id, { depth: workspaceSession.laneTriggerDepth || 0 });
}

const ENTRY_EVENT_LEASE_MS = 5 * 60 * 1000;
const ENTRY_EVENT_RENEWAL_MS = Math.floor(ENTRY_EVENT_LEASE_MS / 3);
const MAX_ENTRY_EVENT_ATTEMPTS = 8;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const RETRY_JITTER = 0.2;

/**
 * Delivery is deliberately detached from the board mutation. The entry event
 * and its run are already committed, so a provider/setup failure must become
 * retryable outbox state rather than turn a successful add or move into a
 * failed API request.
 */
function scheduleLaneEntryDelivery(eventId, options) {
  if (isLaneEntryDeliveryStopping()) return;
  void drainLaneEntryTrigger(eventId, options).catch((error) => {
    console.error(`Kanban lane-entry delivery ${eventId} failed; queued for retry:`, error);
  });
}

export function laneEntryRetryDelay(attempt, random = Math.random) {
  const capped = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(capped * (1 - RETRY_JITTER + random() * RETRY_JITTER * 2));
}

function claimLaneEntryTrigger(eventId) {
  const token = crypto.randomUUID();
  const time = Date.now();
  const claimed = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET status='claimed', claim_token=?, claimed_at=?, claim_expires_at=?, attempt_count=attempt_count+1, updated_at=?
    WHERE id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      AND attempt_count < ?`).run(token, time, time + ENTRY_EVENT_LEASE_MS, time, eventId, time, MAX_ENTRY_EVENT_ATTEMPTS);
  return claimed.changes ? token : null;
}

/**
 * Keeps an outbox claim alive while the child-session setup/provider dispatch
 * is in flight. Every transition remains token-fenced; a failed renewal
 * closes the guard so a stale worker cannot acknowledge or publish success.
 */
function createLaneEntryClaimGuard(eventId, token, abortController) {
  const db = databaseManager.get();
  let current = true;
  const renew = () => {
    if (!current) return;
    const now = Date.now();
    const changed = db.prepare(`UPDATE kanban_lane_entry_events
      SET claim_expires_at=?, updated_at=?
      WHERE id=? AND status='claimed' AND claim_token=? AND claim_expires_at>?`)
      .run(now + ENTRY_EVENT_LEASE_MS, now, eventId, token, now).changes;
    if (changed !== 1) {
      current = false;
      abortController?.abort(new Error('Lane-entry claim ownership was lost'));
    }
  };
  const timer = setInterval(renew, ENTRY_EVENT_RENEWAL_MS);
  timer.unref?.();
  return {
    assertCurrent() {
      if (!current) throw new Error('Lane-entry claim ownership was lost');
      const owner = db.prepare(`SELECT 1 FROM kanban_lane_entry_events
        WHERE id=? AND status='claimed' AND claim_token=? AND claim_expires_at>?`).get(eventId, token, Date.now());
      if (!owner) {
        current = false;
        abortController?.abort(new Error('Lane-entry claim ownership was lost'));
        throw new Error('Lane-entry claim ownership was lost');
      }
    },
    stop() { clearInterval(timer); },
  };
}

function completeVerifiedLaneEntry(eventId, rootSessionId, token) {
  if (!eventId || !rootSessionId || !token) return false;
  const db = databaseManager.get();
  const owner = db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE lane_entry_event_id=? AND status='open' AND root_session_id=?`).get(eventId, rootSessionId);
  if (!owner) throw new Error('Lane-entry delivery did not attach the expected run root');
  const time = Date.now();
  const completed = db.prepare(`UPDATE kanban_lane_entry_events SET status='completed', delivery_phase='completed', completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND status='claimed' AND claim_token=? AND dispatch_acknowledged_at IS NOT NULL`).run(time, time, eventId, token);
  if (completed.changes !== 1) throw new Error('Lane-entry event could not be completed after root verification');
  return true;
}

function markDispatchIntent(eventId, token) {
  const db = databaseManager.get(); const time = Date.now();
  const key = crypto.randomUUID();
  const result = db.prepare(`UPDATE kanban_lane_entry_events
    SET delivery_phase='dispatch_intent', dispatch_key=COALESCE(dispatch_key, ?), updated_at=?
    WHERE id=? AND status='claimed' AND claim_token=?`).run(key, time, eventId, token);
  if (result.changes !== 1) throw new Error('Lane-entry claim was lost before provider dispatch');
  return db.prepare('SELECT dispatch_key FROM kanban_lane_entry_events WHERE id=?').get(eventId).dispatch_key;
}

function acknowledgeDispatch(eventId, token) {
  const time = Date.now();
  const result = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET delivery_phase='dispatch_acknowledged', dispatch_acknowledged_at=?, updated_at=?
    WHERE id=? AND status='claimed' AND claim_token=? AND delivery_phase='dispatch_intent'`).run(time, time, eventId, token);
  if (result.changes !== 1) throw new Error('Lane-entry claim was lost before dispatch acknowledgement');
}

function resolveDeliveryState(event) {
  const db = databaseManager.get();
  let run = db.prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(event.id);
  // Compatibility for durable events written by versions which committed the
  // event before creating its target run. New entry sources create both in one
  // transaction; this branch never creates a replacement once a run exists.
  if (!run) {
    const lane = kanbanLanes.getById(event.lane_id);
    if (!lane || !isStructured(lane)) return { state: 'ownership_conflict', reason: 'target lane run is missing' };
    const created = createLaneRunForEntry({ projectId: event.project_id, workspaceId: event.workspace_id,
      cardId: event.card_id, lane, cause: event.cause, priorLaneRunId: event.caused_by_run_id, entryEventId: event.id });
    run = created && db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(created.id);
  }
  if (!run) return { state: 'ownership_conflict', reason: 'target lane run is missing' };
  if (!run.root_session_id) return { state: 'needs_delivery', run };
  const owner = db.prepare(`WITH RECURSIVE ancestors(id, parent_session_id) AS (
    SELECT id, parent_session_id FROM sessions WHERE id=? UNION ALL
    SELECT s.id, s.parent_session_id FROM sessions s JOIN ancestors a ON a.parent_session_id=s.id
  ) SELECT 1 FROM sessions s WHERE s.id=? AND s.project_id=? AND EXISTS (SELECT 1 FROM ancestors WHERE id=?)`)
    .get(run.root_session_id, run.root_session_id, run.project_id, run.workspace_id);
  if (!owner) return { state: 'ownership_conflict', reason: 'attached root does not belong to target run workspace' };
  if (event.dispatch_acknowledged_at) return { state: 'already_delivered', run, rootSessionId: run.root_session_id };
  // Child allocation is setup state, not evidence of a provider call. Reuse
  // the same child after any failure before durable dispatch intent.
  if (event.delivery_phase !== 'dispatch_intent' || !event.dispatch_key) {
    return { state: 'needs_delivery', run, rootSessionId: run.root_session_id };
  }
  // We deliberately refuse to infer acknowledgement from ownership.  This
  // leaves pre-ack crashes visible and safe instead of risking a duplicate.
  return { state: 'ambiguous_dispatch', reason: 'child ownership exists without provider dispatch acknowledgement' };
}

/** Drain one committed completion handoff. Safe to call repeatedly. */
// eslint-disable-next-line complexity -- deliberately linear durable state machine
// eslint-disable-next-line max-statements, complexity -- durable transition boundaries are intentionally linear
async function drainLaneEntryTriggerImpl(eventId, options = {}) {
  const token = claimLaneEntryTrigger(eventId);
  if (!token) return false;
  const abortController = new AbortController();
  const claim = createLaneEntryClaimGuard(eventId, token, abortController);
  const db = databaseManager.get();
  const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  const valid = event && db.prepare('SELECT 1 FROM kanban_cards WHERE id=?').get(event.card_id);
  // A completion handoff is valid only if its source run actually performed
  // this exact guarded transition. This prevents an old outbox event from
  // spawning work after a manual move or a superseded source worker.
  const sourceValid = !event?.caused_by_run_id || db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE id=? AND status='succeeded' AND transition_applied_at IS NOT NULL`).get(event.caused_by_run_id);
  if (!valid || !sourceValid) {
    const reason = !valid ? 'target card no longer exists' : 'source run no longer owns a completed transition';
    const time = Date.now();
    db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid', last_error=?,
      completed_at=?, updated_at=?, claim_token=NULL, claim_expires_at=NULL WHERE id=? AND claim_token=?`).run(reason, time, time, eventId, token);
    claim.stop();
    return false;
  }
  try {
    claim.assertCurrent();
    const resolved = resolveDeliveryState(event);
    if (resolved.state === 'ownership_conflict') throw new Error(resolved.reason);
    if (resolved.state === 'ambiguous_dispatch') throw new Error(resolved.reason);
    let rootSessionId = resolved.rootSessionId;
    if (resolved.state === 'needs_delivery') {
      const delivery = await triggerLaneEntryAutomation(event.workspace_id, event.lane_id, {
        runOnEnterTemplate: true, depth: options.depth || 0, laneRunId: resolved.run.id,
        childSessionId: resolved.rootSessionId,
        abortController,
        beforeDispatch: () => { claim.assertCurrent(); return markDispatchIntent(event.id, token); },
      });
      rootSessionId = delivery?.rootSessionId;
      claim.assertCurrent();
      acknowledgeDispatch(event.id, token);
    }
    claim.assertCurrent();
    return completeVerifiedLaneEntry(event.id, rootSessionId, token);
  } catch (error) {
    const time = Date.now();
    const exhausted = event.attempt_count >= MAX_ENTRY_EVENT_ATTEMPTS;
    const nextAttemptAt = exhausted ? null : time + laneEntryRetryDelay(event.attempt_count);
    db.prepare(`UPDATE kanban_lane_entry_events
      SET status=CASE WHEN ? THEN 'failed' ELSE 'pending' END,
        claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=?, last_error=?, updated_at=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END
      WHERE id=? AND claim_token=?`)
      .run(exhausted ? 1 : 0, nextAttemptAt, String(error.message || 'delivery failed').slice(0, 240), time, exhausted ? 1 : 0, time, eventId, token);
    throw error;
  } finally {
    claim.stop();
  }
}

/**
 * Drain one event while registering it with the shared delivery lifecycle.
 * This public boundary is intentionally used by HTTP, completion, and retry
 * callers alike so graceful shutdown cannot miss a source of side effects.
 */
export function drainLaneEntryTrigger(eventId, options = {}) {
  if (isLaneEntryDeliveryStopping()) return Promise.resolve(false);
  return trackLaneEntryDelivery(drainLaneEntryTriggerImpl(eventId, options));
}

/** Reclaim only leases that have actually expired (shared by startup and polling). */
export function reclaimExpiredLaneEntryClaims(time = Date.now()) {
  return databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET status='pending', claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, updated_at=?
    WHERE status='claimed' AND claim_expires_at <= ?`).run(time, time).changes;
}

export async function drainPendingLaneEntryTriggers() {
  const time = Date.now();
  reclaimExpiredLaneEntryClaims(time);
  // Terminally expose exhausted deliveries instead of endlessly spinning a
  // startup loop. Pending event age/attempt_count/last_error remain directly
  // queryable through the durable outbox table for operations visibility.
  databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET status='failed', last_error=COALESCE(last_error, 'delivery attempts exhausted'),
    completed_at=?, updated_at=? WHERE status='pending' AND attempt_count >= ?`).run(Date.now(), Date.now(), MAX_ENTRY_EVENT_ATTEMPTS);
  const events = databaseManager.get().prepare(`SELECT id FROM kanban_lane_entry_events
    WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT 50`).all(Date.now());
  for (const { id } of events) {
    try { await drainLaneEntryTrigger(id); } catch (error) { console.error('Kanban lane-entry recovery failed:', error); }
  }
}

let retryTimer = null;
let retryInFlight = null;
let retryStopping = false;
const RETRY_POLL_MS = 1_000;

/** Start the bounded durable outbox poller after startup recovery is complete. */
export function startLaneEntryRetryWorker() {
  if (retryTimer) return;
  retryStopping = false;
  beginLaneEntryDelivery();
  const tick = async () => {
    if (retryStopping || retryInFlight) return;
    retryInFlight = drainPendingLaneEntryTriggers().catch((error) => {
      console.error('Kanban lane-entry retry worker failed:', error);
    }).finally(() => { retryInFlight = null; });
    await retryInFlight;
  };
  retryTimer = setInterval(tick, RETRY_POLL_MS);
  retryTimer.unref?.();
  void tick();
}

/** Stop accepting retry work and wait only a bounded time for an active claim. */
export async function stopLaneEntryRetryWorker(timeoutMs = 5_000) {
  retryStopping = true;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
  await stopLaneEntryDelivery(timeoutMs, () => retryInFlight);
}

/**
 * Remove a session from the board (called when session is deleted).
 *
 * @param {string} sessionId - The session ID
 */
export function removeSessionFromBoard(sessionId) {
  // Normalize to workspace root — cards are keyed to the root.
  const workspaceId = resolveWorkspaceId(sessionId);
  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return; // Workspace wasn't on the board
  }

  const laneId = card.laneId;
  const rootSession = sessions.getById(workspaceId);
  const projectId = rootSession?.projectId;

  supersedeRunForCard(card.id, 'card_removed');
  kanbanCards.delete(card.id);

  if (projectId) {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
      projectId,
      cardId: card.id,
      laneId,
    });
  }
}
