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
import {
  createLaneRunForEntry, supersedeLaneRun, supersedeLaneRunAuthorityOnly,
  supersedeRunForCard, isStructured, getRun, reviveLaneEntryWorkerForRetryInTx,
} from './workflowSessionService.js';
import { ApiError } from '../errors/ApiError.js';
import { retrySqliteContention } from './sqliteContention.js';
import { kanbanRoutingMetrics, recordRouteDecision } from './kanbanRoutingObservability.js';
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

/** Build the committed route outcome and its public response in one place. */
function createRouteOutcome(status, laneId, finalizeMutation, { eventId = null, ...outcome } = {}) {
  const response = { status, laneId };
  return { response: finalizeMutation?.({ response, eventId }) ?? response, ...outcome };
}

/**
 * Repair a card whose active-run pointer is stale before creating its next
 * lane entry. Preconditions: the caller holds the route transaction and has
 * validated `targetLane`. Postconditions: every pre-existing open run for the
 * card is superseded, and a structured destination has a durable successor.
 */
function repairStaleRunAndMoveCard(db, {
  card, targetLane, workspace, supersessionReason = 'workspace_routed', preserveMemberSessions = false,
}) {
  const openRun = db.prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'").get(card.id);
  // Manual routes revoke only source automation authority; automatic repair
  // retains the existing full-cancellation behavior.
  if (openRun) {
    const supersede = preserveMemberSessions ? supersedeLaneRunAuthorityOnly : supersedeLaneRun;
    supersede(openRun.id, supersessionReason);
  }

  const moved = kanbanCards.moveToLane(card.id, targetLane.id);
  const laneRun = isStructured(targetLane)
    ? createLaneRunForEntry({
      projectId: workspace.projectId, workspaceId: workspace.id, cardId: card.id, lane: targetLane, cause: 'workspace_route',
    })
    : null;
  if (isStructured(targetLane) && !laneRun) throw new Error('Structured lane entry run was not created');
  if (!laneRun) db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, lane_entry_event_id=NULL, updated_at=? WHERE id=?')
    .run(Date.now(), card.id);
  return { moved, laneRun, supersededRunId: openRun?.id || null };
}

function getOwningOpenRun(db, card) {
  if (!card?.activeLaneRunId) return null;
  const run = db.prepare("SELECT * FROM kanban_lane_runs WHERE id=? AND status='open'").get(card.activeLaneRunId);
  return run && run.card_id === card.id && run.source_lane_id === card.laneId ? run : null;
}

function updateScheduledDestination(db, runId, laneId) {
  const time = Date.now();
  const update = db.prepare(`UPDATE kanban_lane_runs
    SET chosen_exit_lane_id=?, chosen_exit_declared_at=?, updated_at=?
    WHERE id=? AND status='open'`).run(laneId, time, time, runId);
  return update.changes === 1 ? time : null;
}

function recordScheduledDestination(db, runId, laneId, time) {
  db.prepare(`INSERT INTO kanban_lane_run_audit_events
    (id, operation_key, lane_run_id, session_id, event_type, details_json, created_at)
    VALUES (?, ?, ?, NULL, 'route_selected', ?, ?)
    ON CONFLICT(operation_key) DO NOTHING`)
    .run(crypto.randomUUID(), `${runId}:route_selected:${laneId}:${time}`, runId, JSON.stringify({ targetLaneId: laneId }), time);
}

function movedRouteOutcome(db, { card, targetLane, workspace, laneId, finalizeMutation, manualMove = false }) {
  const { moved, laneRun, supersededRunId } = repairStaleRunAndMoveCard(db, {
    card, targetLane, workspace, supersessionReason: manualMove ? 'manual_card_move' : 'workspace_routed',
    preserveMemberSessions: manualMove,
  });
  return createRouteOutcome('moved', laneId, finalizeMutation, {
    eventId: laneRun?.laneEntryEventId || null, moved: { card, moved, laneRun }, projectId: workspace.projectId,
    auditRunId: supersededRunId,
  });
}

function scheduledRouteOutcome({ run, card, workspace, laneId, finalizeMutation, overwritten = false }) {
  return createRouteOutcome('scheduled', laneId, finalizeMutation, {
    moved: null, selectedRunId: run.id, cardId: card.id, projectId: workspace.projectId,
    auditOutcome: overwritten ? 'scheduled_overwritten' : 'scheduled',
  });
}

function scheduledRouteNoopOutcome({ workspace, laneId, finalizeMutation, run = null }) {
  return createRouteOutcome('noop', laneId, finalizeMutation, {
    moved: null, projectId: workspace.projectId, auditRunId: run?.id || null,
  });
}

/** Re-read after a conditional miss; never acknowledge an uncommitted route. */
function scheduleRouteOrRecover(db, { workspaceId, card, run, targetLane, workspace, laneId, finalizeMutation }) {
  if (run.chosen_exit_lane_id === laneId) return scheduledRouteNoopOutcome({ workspace, laneId, finalizeMutation, run });
  let selectedRun = run;
  let selectedCard = card;
  let time = updateScheduledDestination(db, selectedRun.id, laneId);
  if (!time) {
    selectedCard = kanbanCards.getBySessionId(workspaceId);
    selectedRun = getOwningOpenRun(db, selectedCard);
    if (!selectedRun) return movedRouteOutcome(db, { card: selectedCard || card, targetLane, workspace, laneId, finalizeMutation });
    if (selectedRun.chosen_exit_lane_id === laneId) {
      return scheduledRouteNoopOutcome({ workspace, laneId, finalizeMutation, run: selectedRun });
    }
    time = updateScheduledDestination(db, selectedRun.id, laneId);
    if (!time) throw new ApiError('Lane routing changed concurrently; please retry', { status: 503, code: 'KANBAN_ROUTE_RETRYABLE' });
  }
  recordScheduledDestination(db, selectedRun.id, laneId, time);
  return scheduledRouteOutcome({ run: selectedRun, card: selectedCard, workspace, laneId, finalizeMutation,
    overwritten: Boolean(run.chosen_exit_lane_id) });
}

export async function triggerLaneEntryAutomation(sessionId, laneId, options = {}) {
  const { runOnEnterTemplate = true, laneRunId = null, childSessionId = null,
    beforeDispatch, abortController, onAccepted } = options;

  if (!runOnEnterTemplate) return { delivered: true, rootSessionId: null };

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  let result = { delivered: true, rootSessionId: null };
  if (lane?.onEnterTemplateId) {
    result = await triggerOnEnterTemplate(sessionId, lane, {
      laneRunId, childSessionId, beforeDispatch, abortController, onAccepted,
    });
  } else if (lane?.onEnterPrompt) {
    result = await triggerOnEnterPrompt(sessionId, lane, {
      laneRunId, childSessionId, beforeDispatch, abortController, onAccepted,
    });
  }
  if (!result?.delivered) {
    const error = new Error(`Lane-entry delivery failed: ${result?.reason || 'unknown error'}`);
    error.deliveryOutcome = result?.outcome || 'unknown';
    throw error;
  }
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
 * @returns {Object} The created card
 * @throws {Error} If session already has a card on the board
 */
export async function addSessionToBoard(sessionId, laneId, options = {}) {
  const { sortOrder, runOnEnterTemplate = true, finalizeMutation } = options;

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
    // Every automated entry is committed before it is delivered.  This is the
    // durable success boundary for add/move/completion alike.
    if (laneRun) {
      scheduleLaneEntryDelivery(laneRun.laneEntryEventId);
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
 * @returns {Promise<Object>} The moved card
 */
export async function moveCard(cardId, targetLaneId, options = {}) {
  const { sortOrder, runOnEnterTemplate = true, finalizeMutation } = options;

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
  const { movedCard, laneRun, finalizedResult } = databaseManager.transaction(() => {
    supersedeRunForCard(cardId, 'card_moved');
    const updatedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);
    const createdRun = session && runOnEnterTemplate && isStructured(lane)
      ? createLaneRunForEntry({ projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause: 'manual_move' })
      : null;
    const result = finalizeMutation?.({ card: updatedCard, eventId: createdRun?.laneEntryEventId || null });
    return { movedCard: updatedCard, laneRun: createdRun, finalizedResult: result };
  });

  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    if (laneRun) {
      scheduleLaneEntryDelivery(laneRun.laneEntryEventId);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return finalizedResult ?? movedCard;
}

/**
 * Route a workspace card.  The immediate transaction owns the decision about
 * whether a request is applied now. Public manual routes are authoritative:
 * an open lane run is superseded as part of the same committed move. Internal
 * automation-owned callers retain deferred exit selection.
 *
 * @returns {Promise<{status: 'noop'|'moved'|'scheduled', laneId: string}>}
 */
export async function routeWorkspaceCard(workspaceId, laneId, {
  finalizeMutation, callerSessionId = null, manualMove = false,
} = {}) {
  const requestAt = Date.now();
  // eslint-disable-next-line max-statements, complexity -- the transactional state decision is intentionally co-located.
  const outcome = await retrySqliteContention(() => databaseManager.immediateTransaction(() => {
    const db = databaseManager.get();
    const workspace = sessions.getById(workspaceId);
    const card = kanbanCards.getBySessionId(workspaceId);
    if (!workspace || !card) {
      throw new ApiError('No card found for this workspace', { status: 404, code: 'KANBAN_WORKSPACE_CARD_NOT_FOUND' });
    }
    const sourceLane = kanbanLanes.getById(card.laneId);
    const targetLane = kanbanLanes.getById(laneId);
    if (!sourceLane || !targetLane || sourceLane.boardId !== targetLane.boardId) {
      throw new ApiError('Target lane not found', { status: 404, code: 'KANBAN_TARGET_LANE_NOT_FOUND' });
    }

    const run = getOwningOpenRun(db, card);
    const decision = card.laneId === laneId
      ? createRouteOutcome('noop', laneId, finalizeMutation, {
        moved: null, projectId: workspace.projectId, auditRunId: run?.id || null,
      })
      : manualMove || !run
        ? movedRouteOutcome(db, { card, targetLane, workspace, laneId, finalizeMutation, manualMove })
        : scheduleRouteOrRecover(db, { workspaceId, card, run, targetLane, workspace, laneId, finalizeMutation });
    const auditOutcome = decision.auditOutcome || decision.response.status;
    recordRouteDecision(db, {
      projectId: workspace.projectId, workspaceId, callerSessionId, sourceLaneId: card.laneId,
      destinationLaneId: laneId, outcome: auditOutcome,
      laneRunId: decision.selectedRunId || decision.auditRunId || null,
      requestAt, committedAt: Date.now(),
    });
    return decision;
  }));

  kanbanRoutingMetrics.recordAccepted(outcome.auditOutcome || outcome.response.status);

  if (outcome.moved) {
    broadcastToProject(outcome.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: outcome.projectId, cardId: outcome.moved.card.id, fromLaneId: outcome.moved.card.laneId,
      toLaneId: outcome.moved.moved.laneId, card: outcome.moved.moved,
    });
    if (outcome.moved.laneRun) {
      scheduleLaneEntryDelivery(outcome.moved.laneRun.laneEntryEventId);
      await new Promise((resolve) => setImmediate(resolve));
    }
  } else if (outcome.selectedRunId) {
    broadcastToProject(outcome.projectId, WS_MESSAGE_TYPES.KANBAN_EXIT_LANE_DECLARED, {
      projectId: outcome.projectId,
      cardId: outcome.cardId,
      activeLaneRun: getRun(outcome.selectedRunId),
    });
  }
  return outcome.response;
}

/**
 * Retire a card's active lane run and remove the card as one durable change.
 *
 * Every path that can remove a card — explicit card removal, session
 * deletion, lane deletion, board deletion, and project deletion — must go
 * through this family before an FK cascade can make the card unavailable to
 * the lane-run state machine. `projectId` is derived from the card itself
 * (card → lane → board → project) so the broadcast survives even when the
 * card's sessions were already deleted.
 *
 * @param {Object} card - The card to remove
 * @returns {Object|null} removal descriptor `{ projectId, laneId }` for the
 *   caller's broadcast, or null when the card's lane is already gone and
 *   there is no project left to notify
 */
export function removeCard(card) {
  const projectId = kanbanCards.getProjectId(card.id);
  const laneId = card.laneId;
  databaseManager.transaction(() => {
    supersedeRunForCard(card.id, 'card_removed');
    kanbanCards.delete(card.id);
  });

  if (!projectId) {
    // Only reachable if the card's lane vanished between the caller's fetch
    // and this delete; warn so a silent cascade never goes unnoticed.
    console.warn(`Kanban card ${card.id} removed without a resolvable project; no broadcast sent`);
    return null;
  }

  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
    projectId,
    cardId: card.id,
    laneId,
  });
  return { projectId, laneId };
}

/**
 * Delete a lane and all of its cards, superseding their active lane runs.
 *
 * The supersessions, card deletions (via FK cascade from the lane), and lane
 * deletion commit as ONE transaction, so no concurrent card add can slip past
 * the supersession pass and be cascade-deleted while its run stays open.
 * No per-card events are emitted: callers broadcast KANBAN_BOARD_UPDATED,
 * which carries the full board and makes per-card events redundant.
 *
 * @param {Object} lane - The lane to delete
 */
export function removeLane(lane) {
  databaseManager.transaction(() => {
    for (const card of kanbanCards.getByLaneId(lane.id)) {
      supersedeRunForCard(card.id, 'card_removed');
    }
    kanbanLanes.delete(lane.id);
  });
}

/**
 * Delete a board, all of its lanes, and all of their cards, superseding any
 * active lane runs. Single transaction, for the same reasons as removeLane.
 *
 * @param {Object} board - The board to delete
 */
export function removeBoard(board) {
  databaseManager.transaction(() => {
    for (const card of kanbanCards.getByBoardId(board.id)) {
      supersedeRunForCard(card.id, 'card_removed');
    }
    kanbanBoards.delete(board.id);
  });
}

/**
 * Delete a project's board (if any), superseding its active lane runs before
 * the project row's own cascades remove the cards. Used by project deletion,
 * where the board may not have been fetched yet.
 *
 * @param {string} projectId
 */
export function removeBoardForProject(projectId) {
  const board = kanbanBoards.getByProjectId(projectId);
  if (board) removeBoard(board);
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
  return drainLaneEntryTrigger(laneRun.lane_entry_event_id);
}

const envPositiveInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
const ENTRY_EVENT_LEASE_MS = envPositiveInt('KANBAN_ENTRY_LEASE_MS', 5 * 60 * 1000);
const ENTRY_EVENT_RENEWAL_MS = Math.floor(ENTRY_EVENT_LEASE_MS / 3);
const MAX_ENTRY_EVENT_ATTEMPTS = envPositiveInt('KANBAN_ENTRY_MAX_ATTEMPTS', 8);
const RETRY_BASE_MS = envPositiveInt('KANBAN_ENTRY_RETRY_BASE_MS', 1_000);
const RETRY_MAX_MS = envPositiveInt('KANBAN_ENTRY_RETRY_MAX_MS', 5 * 60 * 1000);
const RETRY_JITTER = 0.2;

/**
 * Delivery is deliberately detached from the board mutation. The entry event
 * and its run are already committed, so a provider/setup failure must become
 * retryable outbox state rather than turn a successful add or move into a
 * failed API request.
 */
function scheduleLaneEntryDelivery(eventId) {
  if (isLaneEntryDeliveryStopping()) return;
  void drainLaneEntryTrigger(eventId).catch((error) => {
    console.error(`Kanban lane-entry delivery ${eventId} failed; queued for retry:`, error);
  });
}

export function laneEntryRetryDelay(attempt, random = Math.random) {
  const capped = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(capped * (1 - RETRY_JITTER + random() * RETRY_JITTER * 2));
}

const SELECT_LANE_ENTRY_EVENT_BY_ID = 'SELECT * FROM kanban_lane_entry_events WHERE id=?';

function claimLaneEntryTrigger(eventId, { countAttempt = true } = {}) {
  const token = crypto.randomUUID();
  const time = Date.now();
  // Reconciliation claims recover already-proven deliveries without
  // dispatching, so they neither consume the dispatch attempt budget nor
  // observe it: the budget caps new dispatches, not reconciliation of the
  // last dispatch.
  const increment = countAttempt ? 'attempt_count=attempt_count+1,' : '';
  const budget = countAttempt ? 'AND attempt_count < ?' : '';
  const params = countAttempt
    ? [token, time, time + ENTRY_EVENT_LEASE_MS, time, eventId, time, MAX_ENTRY_EVENT_ATTEMPTS]
    : [token, time, time + ENTRY_EVENT_LEASE_MS, time, eventId, time];
  const claimed = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET status='claimed', claim_token=?, claimed_at=?, claim_expires_at=?, ${increment} updated_at=?
    WHERE id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ${budget}`).run(...params);
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

/**
 * Record durable acceptance evidence under the live delivery claim. Called at
 * provider-acceptance signal time, before the handoff transaction. Best
 * effort: when the claim was already lost the write cannot commit, which
 * preserves uncertainty instead of fabricating evidence.
 * @returns {boolean} True when the evidence was durably recorded
 */
function recordDispatchAcceptance(eventId, token) {
  const time = Date.now();
  const recorded = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET accepted_at=?, accepted_dispatch_key=dispatch_key, updated_at=?
    WHERE id=? AND status='claimed' AND claim_token=?
      AND delivery_phase='dispatch_intent' AND dispatch_key IS NOT NULL`)
    .run(time, time, eventId, token);
  return recorded.changes === 1;
}

/**
 * Atomic delivery handoff: one transaction verifies the live claim token and
 * lease, the event/child/run association, and the dispatch identity, then
 * writes the durable acknowledgement, marks the event completed, and clears
 * claim ownership. Completion here means delivery accepted, not lane work
 * succeeded. Only the owner of a live claim can commit; acknowledgement and
 * completion cannot be split by a crash.
 */
function completeAcceptedLaneEntry(eventId, rootSessionId, token) {
  if (!eventId || !rootSessionId || !token) return false;
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const time = Date.now();
    const event = db.prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
    if (!event || event.status !== 'claimed' || event.claim_token !== token || !(event.claim_expires_at > time)) {
      throw new Error('Lane-entry delivery claim is no longer live');
    }
    // Legacy crash survivors may carry the old post-turn acknowledged phase;
    // both phases prove the same dispatch intent for the same key.
    if ((event.delivery_phase !== 'dispatch_intent' && event.delivery_phase !== 'dispatch_acknowledged') || !event.dispatch_key) {
      throw new Error('Lane-entry delivery has no dispatch intent to acknowledge');
    }
    // A recorded acceptance must refer to this exact dispatch. Absence of a
    // record is acceptable: the owning worker observed acceptance in-process
    // (explicit signal or `{ started: true }` completion).
    if (event.accepted_dispatch_key != null && event.accepted_dispatch_key !== event.dispatch_key) {
      throw new Error('Lane-entry acceptance refers to a different dispatch');
    }
    // Verify root attachment, not run liveness: a run legitimately superseded
    // by the very child we're delivering (e.g. it moved its own card, or the
    // child already completed) is a successful delivery, not a failure.
    // Status is intentionally not checked.
    const owner = db.prepare(`SELECT 1 FROM kanban_lane_runs
      WHERE lane_entry_event_id=? AND root_session_id=?`).get(eventId, rootSessionId);
    if (!owner) throw new Error('Lane-entry delivery did not attach the expected run root');
    const completed = db.prepare(`UPDATE kanban_lane_entry_events
      SET status='completed', delivery_phase='completed',
        dispatch_acknowledged_at=COALESCE(dispatch_acknowledged_at, ?),
        accepted_at=COALESCE(accepted_at, ?),
        accepted_dispatch_key=COALESCE(accepted_dispatch_key, dispatch_key),
        completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
      WHERE id=? AND status='claimed' AND claim_token=?`).run(time, time, time, time, eventId, token);
    if (completed.changes !== 1) throw new Error('Lane-entry event could not be completed after root verification');
    return true;
  });
}

/**
 * Return a definitively pre-acceptance failure to a retryable phase under the
 * owning worker's knowledge. The worker observed its own dispatch never reach
 * acceptance, so the persisted intent must not poison the retry as permanently
 * ambiguous. The attached child is retained for reuse; only the unproven
 * intent (and any stale acceptance evidence) is cleared.
 *
 * Handles both wake orderings: normally the live claim is still owned
 * (guard-first), but when the retry poller already reclaimed the expired
 * lease the reset is fenced on the exact dispatch key this worker minted
 * instead of the lost token (poller-first). A stale worker can never clear a
 * live replacement claim or a parked needs-attention state.
 */
function resetDispatchIntentForRetry(eventId, token, { dispatchKey, backoffMs, reason }) {
  const db = databaseManager.get();
  const time = Date.now();
  const owned = db.prepare(`UPDATE kanban_lane_entry_events
    SET delivery_phase='pending', dispatch_key=NULL, accepted_at=NULL, accepted_dispatch_key=NULL, updated_at=?
    WHERE id=? AND status='claimed' AND claim_token=?`).run(time, eventId, token);
  if (owned.changes === 1) return true;
  if (!dispatchKey) return false;
  const reclaimed = db.prepare(`UPDATE kanban_lane_entry_events
    SET status='pending', delivery_phase='pending', dispatch_key=NULL, accepted_at=NULL, accepted_dispatch_key=NULL,
      next_attempt_at=?, last_error=?, updated_at=?
    WHERE id=? AND status='pending' AND claim_token IS NULL
      AND delivery_phase='dispatch_intent' AND dispatch_key=?`).run(backoffMs, String(reason).slice(0, 240), time, eventId, dispatchKey);
  return reclaimed.changes === 1;
}

/**
 * Park an uncertain dispatch for operator attention without consuming
 * attempts or dispatching again. The poller never re-drives this state;
 * only an explicit operator redrive (or a proven-acceptance reconciliation)
 * resolves it.
 */
function parkAmbiguousDispatch(eventId, reason) {
  const time = Date.now();
  const parked = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET status='needs_attention', last_error=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND status='pending'`).run(`ambiguous_dispatch: ${String(reason).slice(0, 200)}`, time, eventId);
  return parked.changes === 1;
}

/** Release a held delivery claim into the needs-attention state. */
function releaseClaimToNeedsAttention(eventId, token, reason) {
  const time = Date.now();
  const released = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET status='needs_attention', last_error=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND status='claimed' AND claim_token=?`).run(String(reason).slice(0, 240), time, eventId, token);
  return released.changes === 1;
}

/** Release a held reconciliation claim back to pending without side effects. */
function releaseReconciliationClaim(eventId, token) {
  const time = Date.now();
  const released = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET status='pending', updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND status='claimed' AND claim_token=?`).run(time, eventId, token);
  return released.changes === 1;
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
  return resolveDispatchIntent(event, run);
}

/**
 * Resolve a persisted dispatch intent. Intent without an attached child
 * means the worker that owned this dispatch is gone, so redispatching would
 * risk a duplicate provider execution — this stays parked for explicit
 * operator redrive, which can verify settlement first.
 */
function resolveDispatchIntent(event, run) {
  if (!run.root_session_id) {
    return { state: 'ambiguous_dispatch', reason: 'dispatch intent exists without an attached child session' };
  }
  return resolveAcceptedDispatch(event, run)
    // We deliberately refuse to infer acknowledgement from ownership.  This
    // leaves pre-ack crashes visible and safe instead of risking a duplicate.
    || { state: 'ambiguous_dispatch', reason: 'child ownership exists without provider dispatch acknowledgement' };
}

/**
 * Durable acceptance for this exact dispatch, with a valid attachment: the
 * provider provably took the turn, so delivery completes without starting
 * another child — regardless of later turn success or failure. Session
 * status, allocated turn tokens, and PIDs alone are not evidence; only the
 * accepted dispatch key matching the intent key counts.
 * @returns {Object|null} Delivery state, or null when no acceptance is recorded
 */
function resolveAcceptedDispatch(event, run) {
  if (event.accepted_dispatch_key == null) return null;
  if (event.accepted_dispatch_key === event.dispatch_key && run.root_session_id) {
    return { state: 'accepted_uncompleted', run, rootSessionId: run.root_session_id };
  }
  return { state: 'ambiguous_dispatch', reason: 'dispatch acceptance does not match a valid attached run' };
}

/**
 * Reconcile an event whose delivery was already proven (legacy post-turn
 * acknowledgement, or durable acceptance evidence) but never marked
 * completed — e.g. a crash between acceptance and the handoff commit.
 * Completes WITHOUT starting another child, under a reconciliation claim
 * that leaves the dispatch attempt budget unchanged.
 */
function reconcileProvenDelivery(eventId) {
  const token = claimLaneEntryTrigger(eventId, { countAttempt: false });
  if (!token) return false;
  const db = databaseManager.get();
  try {
    const event = db.prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
    const fresh = resolveDeliveryState(event);
    if (fresh.state !== 'already_delivered' && fresh.state !== 'accepted_uncompleted') {
      releaseReconciliationClaim(eventId, token);
      if (fresh.state === 'ambiguous_dispatch') parkAmbiguousDispatch(eventId, fresh.reason);
      return false;
    }
    return completeAcceptedLaneEntry(eventId, fresh.rootSessionId, token);
  } catch (error) {
    releaseClaimToNeedsAttention(eventId, token, error.message || 'proven-delivery reconciliation failed');
    return false;
  }
}

/** Mark a definitively exhausted delivery failed without another dispatch. */
function markExhaustedLaneEntryEvent(db, eventId) {
  const time = Date.now();
  db.prepare(`UPDATE kanban_lane_entry_events SET status='failed',
    last_error=COALESCE(last_error, 'delivery attempts exhausted'),
    completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND status='pending'`).run(time, time, eventId);
}

/**
 * Peek WITHOUT claiming: proof and uncertainty are resolved BEFORE the
 * dispatch budget is applied, so the last allowed attempt can still be
 * reconciled (or parked) after a crash. Uncertainty and prior proof never
 * burn dispatch attempts, and the poller does not spin on them.
 * @returns {{action:'skip'}|{action:'done',result:boolean}|{action:'reconcile'}|{action:'deliver'}}
 */
function preclaimLaneEntryEvent(eventId) {
  const db = databaseManager.get();
  const peeked = db.prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
  if (!peeked || peeked.status !== 'pending') return { action: 'skip' };
  if (peeked.next_attempt_at != null && peeked.next_attempt_at > Date.now()) return { action: 'skip' };
  const resolved = resolveDeliveryState(peeked);
  if (resolved.state === 'ownership_conflict') {
    const time = Date.now();
    db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid', last_error=?,
      completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
      WHERE id=? AND status='pending'`).run(resolved.reason, time, time, eventId);
    return { action: 'done', result: false };
  }
  // An intent without acknowledgement is uncertainty, not failure: park it
  // for attention instead of spending attempts rethrowing the same ambiguity.
  if (resolved.state === 'ambiguous_dispatch') {
    parkAmbiguousDispatch(eventId, resolved.reason);
    return { action: 'done', result: false };
  }
  if (resolved.state === 'already_delivered' || resolved.state === 'accepted_uncompleted') {
    return { action: 'reconcile' };
  }
  // Dispatch budget exhaustion prevents NEW dispatches, not reconciliation
  // of the last dispatch (handled above). needs_delivery at the cap means no
  // unacknowledged intent exists — every attempt was a definitive rejection —
  // so only this definitive exhaustion becomes failed. Unknown states were
  // parked above and stay visible.
  if (peeked.attempt_count >= MAX_ENTRY_EVENT_ATTEMPTS) {
    markExhaustedLaneEntryEvent(db, eventId);
    return { action: 'done', result: false };
  }
  return { action: 'deliver' };
}

/**
 * Check the delivery target under a held claim. A completion handoff is
 * valid only if its source run actually performed this exact guarded
 * transition — this prevents an old outbox event from spawning work after a
 * manual move or a superseded source worker.
 * @returns {string|null} Invalid reason, or null when the target is valid
 */
function checkDeliveryTarget(db, event) {
  const valid = event && db.prepare('SELECT 1 FROM kanban_cards WHERE id=?').get(event.card_id);
  const sourceValid = !event?.caused_by_run_id || db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE id=? AND status='succeeded' AND transition_applied_at IS NOT NULL`).get(event.caused_by_run_id);
  if (valid && sourceValid) return null;
  return !valid ? 'target card no longer exists' : 'source run no longer owns a completed transition';
}

function markEventInvalidUnderClaim(db, eventId, token, reason) {
  const time = Date.now();
  db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid', last_error=?,
    completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL
    WHERE id=? AND claim_token=?`).run(reason, time, time, eventId, token);
}

/**
 * Run one dispatch attempt under a held claim. Resolves (never dispatches)
 * when proof appeared between peek and claim; otherwise triggers lane-entry
 * automation and resolves once the provider accepts.
 * Progress travels on the thrown error so the failure path can reset the
 * exact intent this attempt minted and revive the exact run/root it closed.
 * @returns {Promise<{outcome:'parked'}|{outcome:'reconciled',result:boolean}|{outcome:'delivered',delivery:Object}>}
 */
async function attemptLaneEntryDispatch({ event, eventId, token, claim, executionController, detachDeliveryForwarding }) {
  claim.assertCurrent();
  const resolved = resolveDeliveryState(event);
  if (resolved.state === 'ownership_conflict') throw new Error(resolved.reason);
  if (resolved.state === 'ambiguous_dispatch') {
    releaseClaimToNeedsAttention(eventId, token, `ambiguous_dispatch: ${resolved.reason}`);
    return { outcome: 'parked' };
  }
  if (resolved.state !== 'needs_delivery') {
    // Proof appeared between peek and claim (e.g. a racing reconciliation
    // completed the picture): reconcile under this claim, never dispatch.
    if (resolved.state === 'already_delivered' || resolved.state === 'accepted_uncompleted') {
      return { outcome: 'reconciled', result: completeAcceptedLaneEntry(eventId, resolved.rootSessionId, token) };
    }
    throw new Error(resolved.reason || 'lane-entry event is not deliverable');
  }
  const progress = { dispatchKey: null, runId: resolved.run.id, childSessionId: resolved.rootSessionId };
  let delivery;
  try {
    delivery = await triggerLaneEntryAutomation(event.workspace_id, event.lane_id, {
      runOnEnterTemplate: true, laneRunId: resolved.run.id,
      childSessionId: resolved.rootSessionId,
      abortController: executionController,
      beforeDispatch: () => {
        claim.assertCurrent();
        progress.dispatchKey = markDispatchIntent(event.id, token);
        return progress.dispatchKey;
      },
      onAccepted: () => {
        // Synchronous handoff, part 1: from this point the delivery lease no
        // longer governs the accepted turn, and its acceptance is durably
        // evidenced for any later reconciliation.
        detachDeliveryForwarding();
        recordDispatchAcceptance(event.id, token);
      },
    });
  } catch (error) {
    error.laneEntryAttempt = progress;
    throw error;
  }
  return { outcome: 'delivered', delivery };
}

/** Terminal outbox states: failure bookkeeping must never touch these. */
function isTerminalLaneEntryStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'invalid';
}

/**
 * Acceptance proof for the dispatch this attempt minted: a recorded
 * accepted key matching the intent key, or a legacy acknowledgement. Proof
 * is never cleared or revived over — the attempt failure is preserved as-is
 * and the next drain reconciles it without another dispatch.
 */
function hasAcceptedDispatchProof(live, dispatchKey) {
  if (live.dispatch_acknowledged_at != null) return true;
  if (live.accepted_dispatch_key == null) return false;
  if (!dispatchKey) return true;
  return live.accepted_dispatch_key === dispatchKey;
}

/**
 * The retry target (event/run/card) is still owned by this delivery: the
 * run belongs to the event, and the card — when it tracks pointers — still
 * points at this event/run rather than a replacement. Null pointers are
 * legacy rows and do not veto; a non-null pointer at different work does.
 */
function retryTargetStillOurs(db, live, runId, eventId) {
  const run = runId ? db.prepare('SELECT id, lane_entry_event_id FROM kanban_lane_runs WHERE id=?').get(runId) : null;
  if (!run || run.lane_entry_event_id !== eventId) return false;
  const card = db.prepare('SELECT active_lane_run_id, lane_entry_event_id FROM kanban_cards WHERE id=?').get(live.card_id);
  if (!card) return false;
  if (card.active_lane_run_id != null && card.active_lane_run_id !== runId) return false;
  if (card.lane_entry_event_id != null && card.lane_entry_event_id !== eventId) return false;
  return true;
}

/**
 * Bookkeep an attempt that died before minting dispatch progress (state
 * resolution or a lost guard). Never resets intent or revives work: an
 * ownership conflict is marked invalid under the held claim, anything else
 * releases the held claim into needs-attention for reconciliation.
 */
function failUndispatchedAttempt(db, eventId, token, error) {
  const live = db.prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
  if (live && live.status === 'claimed' && live.claim_token === token) {
    const resolved = resolveDeliveryState(live);
    if (resolved.state === 'ownership_conflict') {
      markEventInvalidUnderClaim(db, eventId, token, resolved.reason);
      return;
    }
  }
  releaseClaimToNeedsAttention(eventId, token,
    `attempt failed before dispatch: ${String(error?.message || 'delivery failed').slice(0, 200)}`);
}

/** Park an uncertain dispatch: keep intent and evidence, release the claim. */
function parkUncertainDispatch(eventId, token, error) {
  releaseClaimToNeedsAttention(eventId, token,
    `ambiguous_dispatch: ${String(error?.message || 'delivery failed').slice(0, 200)}`);
}

/**
 * Bookkeep a definitive pre-acceptance failure under fenced ownership.
 * Reset, revival, backoff, and claim release commit as ONE transaction:
 * a worker that lost its claim (or whose event was parked, completed, or
 * superseded by a replacement) revives nothing and mutates nothing.
 */
function failDefinitiveAttempt(db, eventId, { live, token, dispatchKey, runId, childSessionId }, error) {
  const time = Date.now();
  const reason = String(error?.message || 'delivery failed').slice(0, 240);
  const exhausted = live.attempt_count >= MAX_ENTRY_EVENT_ATTEMPTS;
  const nextAttemptAt = exhausted ? null : time + laneEntryRetryDelay(live.attempt_count);
  const reset = resetDispatchIntentForRetry(eventId, token, { dispatchKey, backoffMs: nextAttemptAt, reason });
  // A refused reset means another worker owns, parked, completed, or
  // replaced this delivery: revive nothing and leave every row untouched.
  if (!reset) return;
  // The failed turn closed its run and obligation without provider
  // acceptance, so no lane work started. Revive both for the retry while the
  // event stays retryable and still targets this delivery; a terminally
  // exhausted event keeps its terminal state and never silently revives
  // work. The child may have been allocated inside the failed trigger, so
  // fall back to the run's attached root when the pre-trigger resolution had
  // none yet.
  if (!exhausted && retryTargetStillOurs(db, live, runId, eventId)) {
    const failedChildId = childSessionId
      ?? db.prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?').get(runId)?.root_session_id;
    if (failedChildId) reviveLaneEntryWorkerForRetryInTx(db, runId, failedChildId);
  }
  db.prepare(`UPDATE kanban_lane_entry_events
    SET status=CASE WHEN ? THEN 'failed' ELSE 'pending' END,
      claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=?, last_error=?, updated_at=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END
    WHERE id=? AND (claim_token=? OR (claim_token IS NULL AND status='pending'))`)
    .run(exhausted ? 1 : 0, nextAttemptAt, reason, time, exhausted ? 1 : 0, time, eventId, token);
}

/**
 * Bookkeep a pre-acceptance attempt failure: route by structured outcome.
 * A definitive rejection returns the event to a retryable phase under fenced
 * ownership; any uncertainty parks the event for reconciliation without
 * resetting intent, reviving work, or dispatching again. Terminal events are
 * never touched. Retry authorization, intent reset, run/root revival,
 * backoff, and claim release commit as ONE transaction, so a stale worker
 * that lost its claim cannot reopen workflow state. Always throws the
 * original error.
 */
function failDeliveryAttempt(db, { eventId, token, dispatchKey, runId, childSessionId, attempted }, error) {
  const outcome = error?.deliveryOutcome === 'rejected' ? 'rejected' : 'unknown';
  databaseManager.transaction(() => {
    const live = databaseManager.get().prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
    if (!live || isTerminalLaneEntryStatus(live.status)) return;
    if (!attempted) {
      failUndispatchedAttempt(databaseManager.get(), eventId, token, error);
      return;
    }
    // Conflicting acceptance proof: never reset or revive over it. The next
    // drain reconciles the proven delivery without another dispatch.
    if (hasAcceptedDispatchProof(live, dispatchKey)) return;
    if (outcome === 'unknown') {
      parkUncertainDispatch(eventId, token, error);
      return;
    }
    failDefinitiveAttempt(databaseManager.get(), eventId, { live, token, dispatchKey, runId, childSessionId }, error);
  });
  throw error;
}

/**
 * Post-acceptance handoff commit: the provider owns the turn from here. A
 * commit failure after acceptance preserves uncertainty for reconciliation —
 * it never replays the provider call and never reports successful delivery
 * without durable evidence.
 */
function commitAcceptedHandoff({ eventId, token, claim, rootSessionId }) {
  try {
    const completed = completeAcceptedLaneEntry(eventId, rootSessionId, token);
    claim.stop();
    return completed;
  } catch (error) {
    releaseClaimToNeedsAttention(eventId, token,
      `delivery handoff could not commit after provider acceptance: ${error.message || error}`);
    throw error;
  } finally {
    claim.stop();
  }
}

/** Drain one committed completion handoff. Safe to call repeatedly. */
async function drainLaneEntryTriggerImpl(eventId) {
  const preclaim = preclaimLaneEntryEvent(eventId);
  if (preclaim.action === 'skip' || preclaim.action === 'done') return preclaim.result ?? false;
  if (preclaim.action === 'reconcile') return reconcileProvenDelivery(eventId);
  return deliverClaimedLaneEntry(eventId);
}

/** Claim a pending event and drive it through one dispatch attempt plus the
 * acceptance handoff, with separated delivery/execution cancellation. */
async function deliverClaimedLaneEntry(eventId) {
  const db = databaseManager.get();
  const token = claimLaneEntryTrigger(eventId);
  if (!token) return false;
  // Separate cancellation ownership. The delivery controller owns the lease
  // guard; the session-owned execution controller runs the turn. Delivery
  // cancellation forwards to execution ONLY until the acceptance handoff —
  // after that, lease expiry, polling, and worker shutdown cannot abort the
  // accepted turn. User-stop, workflow ownership, and session shutdown
  // controls are unaffected (they target execution directly).
  const deliveryController = new AbortController();
  const executionController = new AbortController();
  const forwarding = { observed: false };
  const detachDeliveryForwarding = () => {
    forwarding.observed = true;
    deliveryController.signal.removeEventListener('abort', forwardDeliveryAbort);
  };
  const forwardDeliveryAbort = () => {
    if (!forwarding.observed) executionController.abort(deliveryController.signal.reason);
  };
  deliveryController.signal.addEventListener('abort', forwardDeliveryAbort);
  const claim = createLaneEntryClaimGuard(eventId, token, deliveryController);
  const event = db.prepare(SELECT_LANE_ENTRY_EVENT_BY_ID).get(eventId);
  const invalidReason = checkDeliveryTarget(db, event);
  if (invalidReason) {
    markEventInvalidUnderClaim(db, eventId, token, invalidReason);
    claim.stop();
    return false;
  }
  let attempt;
  try {
    attempt = await attemptLaneEntryDispatch({
      event, eventId, token, claim, executionController, detachDeliveryForwarding,
    });
  } catch (error) {
    // A throw here is always pre-acceptance (acceptance resolves the trigger
    // instead of throwing): setup errors and definitive provider rejections
    // stay retryable on the same child via the intent reset.
    detachDeliveryForwarding();
    const { dispatchKey = null, runId = null, childSessionId = null } = error.laneEntryAttempt ?? {};
    return failDeliveryAttempt(db, {
      eventId, token, dispatchKey, runId, childSessionId, attempted: Boolean(error.laneEntryAttempt),
    }, error);
  } finally {
    claim.stop();
  }
  if (attempt.outcome !== 'delivered') return attempt.outcome === 'reconciled' ? attempt.result : false;
  return commitAcceptedHandoff({ eventId, token, claim, rootSessionId: attempt.delivery.rootSessionId });
}

/**
 * Drain one event while registering it with the shared delivery lifecycle.
 * This public boundary is intentionally used by HTTP, completion, and retry
 * callers alike so graceful shutdown cannot miss a source of side effects.
 */
export function drainLaneEntryTrigger(eventId) {
  if (isLaneEntryDeliveryStopping()) return Promise.resolve(false);
  return trackLaneEntryDelivery(drainLaneEntryTriggerImpl(eventId));
}

/** Reclaim only leases that have actually expired (shared by startup and polling). */
export function reclaimExpiredLaneEntryClaims(time = Date.now()) {
  return databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET status='pending', claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, updated_at=?
    WHERE status='claimed' AND claim_expires_at <= ?`).run(time, time).changes;
}

export async function drainPendingLaneEntryTriggers() {
  const time = Date.now();
  reclaimExpiredLaneEntryClaims(time);
  // Capped events are NOT blanket-failed here: each pending event drains
  // through classified recovery (proven deliveries reconcile, uncertain ones
  // park, only definitive exhaustion fails). Pending event age/attempt_count/
  // last_error remain directly queryable through the durable outbox table
  // for operations visibility.
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
 * Remove a workspace's card from the board, superseding its active lane run.
 *
 * Called when a workspace root session is deleted. The card's project is
 * resolved from the card itself, so the KANBAN_CARD_REMOVED broadcast fires
 * even when this runs after the session row is already gone.
 *
 * @param {string} sessionId - Any session id in the workspace (root or child)
 * @returns {Object|null} the removal descriptor from removeCard, or null when
 *   the workspace had no card
 */
export function removeSessionFromBoard(sessionId) {
  // Normalize to workspace root — cards are keyed to the root.
  const workspaceId = resolveWorkspaceId(sessionId);
  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return null; // Workspace wasn't on the board
  }
  return removeCard(card);
}
