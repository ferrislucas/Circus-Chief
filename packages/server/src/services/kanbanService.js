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
import {
  triggerOnEnterTemplate, triggerOnEnterPrompt,
  assertLaneAutomationActive, isLaneAutomationDisabledError, createLaneAutomationDisabledError,
} from './kanbanTriggers.js';
import { abandonUndispatchedChild } from './kanbanAbandon.js';
import {
  createLaneRunForEntry, supersedeLaneRun, supersedeLaneRunAuthorityOnly,
  supersedeRunForCard, isStructured, isAutomationActive, getRun,
  enqueueDisabledEntry,
} from './workflowSessionService.js';
import { broadcastQueuedEntryEvent } from './workflowLaneTransition.js';
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

  // Leaving a lane abandons that lane's queued intent for the card; the
  // destination lane's own enabled/disabled logic applies below.
  dequeueSourceLaneEntries(db, card.id, card.laneId);
  const moved = kanbanCards.moveToLane(card.id, targetLane.id);
  let laneRun = null;
  let queuedEntry = null;
  if (isStructured(targetLane)) {
    if (isAutomationActive(targetLane)) {
      laneRun = createLaneRunForEntry({
        projectId: workspace.projectId, workspaceId: workspace.id, cardId: card.id, lane: targetLane, cause: 'workspace_route',
      });
      if (!laneRun) throw new Error('Structured lane entry run was not created');
    } else {
      queuedEntry = enqueueDisabledEntry(db, {
        projectId: workspace.projectId, workspaceId: workspace.id, cardId: card.id, lane: targetLane, cause: 'workspace_route',
      });
    }
  }
  if (!laneRun && !queuedEntry) db.prepare('UPDATE kanban_cards SET active_lane_run_id=NULL, lane_entry_event_id=NULL, updated_at=? WHERE id=?')
    .run(Date.now(), card.id);
  return { moved, laneRun, queuedEntry, supersededRunId: openRun?.id || null };
}

/** Emit the post-commit queued-entry broadcast for a descriptor from enqueueDisabledEntry. */
function broadcastQueuedEntry(projectId, cardId, laneId, queuedEntry) {
  broadcastQueuedEntryEvent({
    projectId,
    cardId,
    laneId,
    queuePosition: queuedEntry.queuePosition,
    queueDepth: queuedEntry.queueDepth,
  });
}

/**
 * Drop a card's queued entries for the lane it is leaving. The destination
 * lane's own enabled/disabled logic then applies. Queued entries have no
 * lane run, so there is no run-audit row to write (the audit table requires
 * a lane_run_id); the queue-depth broadcasts already reflect the removal.
 */
function dequeueSourceLaneEntries(db, cardId, sourceLaneId) {
  db.prepare(`DELETE FROM kanban_lane_entry_events WHERE card_id=? AND lane_id=? AND status='queued'`)
    .run(cardId, sourceLaneId);
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
  const { moved, laneRun, queuedEntry, supersededRunId } = repairStaleRunAndMoveCard(db, {
    card, targetLane, workspace, supersessionReason: manualMove ? 'manual_card_move' : 'workspace_routed',
    preserveMemberSessions: manualMove,
  });
  return createRouteOutcome('moved', laneId, finalizeMutation, {
    eventId: laneRun?.laneEntryEventId || queuedEntry?.eventId || null,
    moved: { card, moved, laneRun, queuedEntry }, projectId: workspace.projectId,
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
    beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated } = options;

  if (!runOnEnterTemplate) return { delivered: true, rootSessionId: null };

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  // Disabled lanes never dispatch: outbox workers skip without marking
  // failure, and queued entries replay on re-enable instead.
  if (lane && !isAutomationActive(lane)) return { delivered: false, reason: 'lane_automation_disabled' };
  let result = { delivered: true, rootSessionId: null };
  if (lane?.onEnterTemplateId) {
    result = await triggerOnEnterTemplate(sessionId, lane, {
      laneRunId, childSessionId, beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated,
    });
  } else if (lane?.onEnterPrompt) {
    result = await triggerOnEnterPrompt(sessionId, lane, {
      laneRunId, childSessionId, beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated,
    });
  }
  if (!result?.delivered) {
    // A disable that landed between the claim-time settle check and the final
    // dispatch boundary parks the entry instead of failing the delivery.
    if (result?.reason === 'lane_automation_disabled') throw createLaneAutomationDisabledError();
    throw new Error(`Lane-entry delivery failed: ${result?.reason || 'unknown error'}`);
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
  const { card, laneRun, queuedEntry, finalizedResult } = databaseManager.transaction(() => {
    if (kanbanCards.getBySessionId(workspaceId)) {
      throw new Error('Session already has a card on the board');
    }
    const createdCard = kanbanCards.create(laneId, workspaceId, { sortOrder });
    let createdRun = null;
    let createdQueuedEntry = null;
    if (rootSession && runOnEnterTemplate && isStructured(lane)) {
      if (isAutomationActive(lane)) {
        createdRun = createLaneRunForEntry({ projectId: rootSession.projectId, workspaceId, cardId: createdCard.id, lane });
      } else {
        createdQueuedEntry = enqueueDisabledEntry(databaseManager.get(), {
          projectId: rootSession.projectId, workspaceId, cardId: createdCard.id, lane, cause: 'card_added',
        });
      }
    }
    const result = finalizeMutation?.({ card: createdCard, eventId: createdRun?.laneEntryEventId || createdQueuedEntry?.eventId || null });
    return { card: createdCard, laneRun: createdRun, queuedEntry: createdQueuedEntry, finalizedResult: result };
  });

  // Delivery remains detached from the committed mutation. It only wakes the
  // durable worker and therefore cannot invalidate a successful transition.
  if (rootSession) {
    broadcastToProject(rootSession.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
      projectId: rootSession.projectId,
      card,
      laneId,
    });

    if (queuedEntry) {
      broadcastQueuedEntry(rootSession.projectId, card.id, laneId, queuedEntry);
    }

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
  const { movedCard, laneRun, queuedEntry, finalizedResult } = databaseManager.transaction(() => {
    supersedeRunForCard(cardId, 'card_moved');
    dequeueSourceLaneEntries(databaseManager.get(), cardId, fromLaneId);
    const updatedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);
    let createdRun = null;
    let createdQueuedEntry = null;
    if (session && runOnEnterTemplate && isStructured(lane)) {
      if (isAutomationActive(lane)) {
        createdRun = createLaneRunForEntry({ projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause: 'manual_move' });
      } else {
        createdQueuedEntry = enqueueDisabledEntry(databaseManager.get(), {
          projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause: 'manual_move',
        });
      }
    }
    const result = finalizeMutation?.({ card: updatedCard, eventId: createdRun?.laneEntryEventId || createdQueuedEntry?.eventId || null });
    return { movedCard: updatedCard, laneRun: createdRun, queuedEntry: createdQueuedEntry, finalizedResult: result };
  });

  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    if (queuedEntry) {
      broadcastQueuedEntry(session.projectId, cardId, targetLaneId, queuedEntry);
    }

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
    } else if (outcome.moved.queuedEntry) {
      broadcastQueuedEntry(outcome.projectId, outcome.moved.card.id, outcome.moved.moved.laneId, outcome.moved.queuedEntry);
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
/**
 * Delete every lane-entry event for a card, of any status. Queued entries
 * have no run, so supersession alone leaves them orphaned (FR-3).
 */
function deleteEntryEventsForCard(db, cardId) {
  db.prepare('DELETE FROM kanban_lane_entry_events WHERE card_id=?').run(cardId);
}

export function removeCard(card) {
  const projectId = kanbanCards.getProjectId(card.id);
  const laneId = card.laneId;
  databaseManager.transaction(() => {
    supersedeRunForCard(card.id, 'card_removed');
    deleteEntryEventsForCard(databaseManager.get(), card.id);
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
    const db = databaseManager.get();
    for (const card of kanbanCards.getByLaneId(lane.id)) {
      supersedeRunForCard(card.id, 'card_removed');
      deleteEntryEventsForCard(db, card.id);
    }
    db.prepare('DELETE FROM kanban_lane_entry_events WHERE lane_id=?').run(lane.id);
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
    const db = databaseManager.get();
    for (const card of kanbanCards.getByBoardId(board.id)) {
      supersedeRunForCard(card.id, 'card_removed');
      deleteEntryEventsForCard(db, card.id);
    }
    db.prepare('DELETE FROM kanban_lane_entry_events WHERE lane_id IN (SELECT id FROM kanban_lanes WHERE board_id=?)')
      .run(board.id);
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
  // Verify root attachment, not run liveness: a run legitimately superseded
  // by the very child we're delivering (e.g. it moved its own card) is a
  // successful delivery, not a failure. Status is intentionally not checked.
  const owner = db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE lane_entry_event_id=? AND root_session_id=?`).get(eventId, rootSessionId);
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

/**
 * Drop a terminal run husk left behind an undelivered entry by an older
 * recovery that superseded paused rootless runs. Applies only when nothing
 * ever spawned (no root) and the card is still waiting in a structured lane;
 * rooted terminal runs are never touched. Returns null when the husk was
 * dropped so the caller creates a valid replacement.
 */
/** The structured lane a husk repair would deliver into, or null. */
function huskRepairLane(db, event) {
  const card = db.prepare('SELECT lane_id FROM kanban_cards WHERE id=?').get(event.card_id);
  if (!card || card.lane_id !== event.lane_id) return null;
  const lane = kanbanLanes.getById(event.lane_id);
  return lane && isStructured(lane) ? lane : null;
}

function dropTerminalHuskRun(db, event, run) {
  if (!run || run.status === 'open' || run.root_session_id) return run;
  // Deliberate supersession is never legacy damage: a run whose persisted
  // reason marks an intentional move-out/removal/automation change is kept
  // for the superseded-entry consumer above, never dropped for repair.
  if (isIntentionallySupersededRun(run)) return run;
  // Husk repair is limited to positively identified recovery damage: the run
  // must belong to this exact card/event arrival. A run attached to another
  // card's arrival is never this entry's husk.
  if (run.card_id !== event.card_id || run.lane_entry_event_id !== event.id) return run;
  if (!huskRepairLane(db, event)) return run;
  // Entry-identity gate (PR #1166 finding 7): only repair a husk that the
  // card did not intentionally leave behind. A move-out supersedes the run
  // while its pending entry survives (only queued entries are dequeued), so a
  // terminal rootless run paired with newer card work is an obsolete arrival,
  // not legacy damage — dropping it would recreate the run, overwrite the
  // newer entry's ownership pointers, and dispatch a duplicate session.
  if (isSupersededEntryRetry(db, event, run)) return run;
  db.prepare('DELETE FROM kanban_lane_runs WHERE id=?').run(run.id);
  return null;
}

/**
 * Failure reasons that mark a run as deliberately superseded by an operator
 * or automation-config change (move-out, removal, automation cleared). A run
 * carrying one of these was intentionally left behind: its arrival must never
 * be revived, independently of whether newer work exists. Rows with any other
 * reason (including the NULL left by legacy recovery damage) stay on the
 * husk-repair path below.
 */
const INTENTIONAL_SUPERSESSION_REASONS = new Set([
  'card_moved',
  'manual_move',
  'manual_card_move',
  'workspace_routed',
  'card_removed',
  'automation_removed',
]);

/** True when the run's persisted reason marks deliberate supersession. */
function isIntentionallySupersededRun(run) {
  return Boolean(run && run.status !== 'open' && run.failure_reason
    && INTENTIONAL_SUPERSESSION_REASONS.has(run.failure_reason));
}

/**
 * Detect an obsolete retry for an entry the card intentionally left behind.
 * True for a terminal rootless run the card moved on from: it carries an
 * intentional-supersession reason, points at a different entry, or a newer
 * entry/run owns the card. The reason check is first and needs no newer rows:
 * a card moved out and back through an unautomated configuration leaves no
 * successor entry, yet its old arrival is still cancelled. Legacy husk damage
 * (no intentional reason, no newer work for the card) returns false so repair
 * still applies.
 */
function isSupersededEntryRetry(db, event, run) {
  if (!run || run.status === 'open' || run.root_session_id) return false;
  if (isIntentionallySupersededRun(run)) return true;
  const card = db.prepare('SELECT lane_entry_event_id FROM kanban_cards WHERE id=?')
    .get(event.card_id);
  if (!card) return false;
  if (card.lane_entry_event_id && card.lane_entry_event_id !== event.id) return true;
  const selfEventRowid = db.prepare('SELECT rowid FROM kanban_lane_entry_events WHERE id=?').get(event.id)?.rowid;
  if (selfEventRowid != null && db.prepare('SELECT 1 FROM kanban_lane_entry_events WHERE card_id=? AND rowid > ?')
    .get(event.card_id, selfEventRowid)) return true;
  const selfRunRowid = db.prepare('SELECT rowid FROM kanban_lane_runs WHERE id=?').get(run.id)?.rowid;
  if (selfRunRowid != null && db.prepare('SELECT 1 FROM kanban_lane_runs WHERE card_id=? AND rowid > ?')
    .get(event.card_id, selfRunRowid)) return true;
  return false;
}

/**
 * Terminally consume an obsolete superseded arrival without dispatch.
 * @returns {boolean} true when the entry was consumed and the caller must stop
 */
function consumeSupersededEntryIfObsolete(db, { eventId, token, claim, event }) {
  const entryRun = event && db.prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(event.id);
  if (!entryRun || !isSupersededEntryRetry(db, event, entryRun)) return false;
  invalidateSupersededEntryDelivery(db, { eventId, token, event, reason: 'lane entry was superseded by a newer card move' });
  claim.stop();
  return true;
}

/**
 * Invalidate an obsolete superseded entry: the card intentionally moved on, so
 * this arrival is terminally consumed without dispatch. The card pointer is
 * cleared only if it still references this event (a newer entry owns it).
 */
function invalidateSupersededEntryDelivery(db, { eventId, token, event, reason }) {
  const time = Date.now();
  db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid', last_error=?,
    completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=NULL
    WHERE id=? AND claim_token=?`).run(reason, time, time, eventId, token);
  clearConsumedEntryPointer(db, event.card_id, eventId);
}

/**
 * Clear a card's entry pointer when it references a consumed intent. A card
 * with a newer pending intent keeps pointing at it.
 */
function clearConsumedEntryPointer(db, cardId, eventId) {
  db.prepare(`UPDATE kanban_cards SET lane_entry_event_id=NULL, updated_at=?
    WHERE id=? AND lane_entry_event_id=?`).run(Date.now(), cardId, eventId);
}

/**
 * Supersede a card's open run when it never spawned (no root): no dangling
 * open obligation may remain on an automation-less lane. A rooted run —
 * already-spawned work — is deliberately left alone to finish.
 */
function supersedeRootlessOpenRun(db, cardId) {
  const openRun = db.prepare(`SELECT id, root_session_id FROM kanban_lane_runs
    WHERE card_id=? AND status='open'`).get(cardId);
  if (openRun && !openRun.root_session_id) {
    supersedeLaneRun(openRun.id, 'automation_removed');
  }
}

/**
 * Complete a claimed entry as a successful no-op: the lane no longer has
 * automation, so the intent replays the latest config to empty (FR-1).
 */
function completeNoopDelivery(db, { eventId, token, event, run }) {
  const time = Date.now();
  db.prepare(`UPDATE kanban_lane_entry_events SET status='completed', delivery_phase='completed',
    completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL,
    next_attempt_at=NULL, last_error=NULL
    WHERE id=? AND claim_token=?`).run(time, time, eventId, token);
  clearConsumedEntryPointer(db, event.card_id, eventId);
  if (run && !run.root_session_id) {
    supersedeLaneRun(run.id, 'automation_removed');
  }
}

/** Ordered queued entries for a lane: the single queue projection behind every queue broadcast. */
function getQueuedLaneEntries(db, laneId) {
  return db.prepare(`SELECT id, card_id FROM kanban_lane_entry_events
    WHERE lane_id=? AND status='queued' ORDER BY created_at, rowid`).all(laneId);
}

/** Complete a drain as a no-op and converge live queue state (FR-1, FR-3). */
function completeDrainAsNoop(db, claim, { eventId, token, event, run }) {
  completeNoopDelivery(db, { eventId, token, event, run });
  claim.stop();
  broadcastQueueSettledState(db, { projectId: event.project_id, laneId: event.lane_id });
  return true;
}

/** Broadcast the settled queue state after a drain-path no-op (badge/chips converge without refetch). */
function broadcastQueueSettledState(db, { projectId, laneId }) {
  const remaining = getQueuedLaneEntries(db, laneId);
  if (!remaining.length) {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_QUEUE_DRAINED, {
      projectId, laneId, drainedCount: 0,
    });
    return;
  }
  const last = remaining[remaining.length - 1];
  broadcastQueuedEntry(projectId, last.card_id, laneId, {
    queuePosition: remaining.length, queueDepth: remaining.length,
  });
}

/**
 * Rebuild the target run for a durable event written before its run existed.
 * Never creates a replacement once a run exists.
 */
function createMissingDeliveryRun(db, event, lane) {
  if (!lane || !isStructured(lane)) return { state: 'ownership_conflict', reason: 'target lane run is missing' };
  const created = createLaneRunForEntry({ projectId: event.project_id, workspaceId: event.workspace_id,
    cardId: event.card_id, lane, cause: event.cause, priorLaneRunId: event.caused_by_run_id, entryEventId: event.id });
  const run = created && db.prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(created.id);
  if (!run) return { state: 'ownership_conflict', reason: 'target lane run is missing' };
  return { state: 'created', run };
}

function resolveDeliveryState(event) {
  const db = databaseManager.get();
  let run = db.prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(event.id);
  run = dropTerminalHuskRun(db, event, run);
  // The lane's automation was cleared after this entry was committed. Queued
  // work replays the latest config, and an automation-less lane is a valid
  // no-op (FR-1) — never an ownership conflict. A missing lane keeps the
  // established conflict path below.
  const lane = kanbanLanes.getById(event.lane_id);
  if (lane && !isStructured(lane)) return { state: 'no_automation_noop', run };

  // Compatibility for durable events written by versions which committed the
  // event before creating its target run. New entry sources create both in one
  // transaction; this branch never creates a replacement once a run exists.
  if (!run) {
    const created = createMissingDeliveryRun(db, event, lane);
    if (created.state !== 'created') return created;
    run = created.run;
  }
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

/**
 * Park a claimed entry whose lane was disabled mid-flight back to queued: no
 * spawn, no attempt-count increment, no failure audit. The open run (when one
 * exists) is deliberately left alone — already-spawned work continues, and a
 * rootless run keeps the durable paused shape (card pointers intact) that
 * startup recovery preserves and re-enable resumes. Idempotent: entries
 * already parked match zero rows.
 */
function parkClaimedEntryForDisabledLane(db, { eventId, token }) {
  const time = Date.now();
  // A park is always pre-acknowledgement (the lane-disabled error can only
  // arise before the provider call). A dispatch-intent marker recorded before
  // the parked setup must be withdrawn, or the retry would misread a
  // never-dispatched entry as an ambiguous dispatch. Acknowledged entries are
  // never parked, so the acknowledged timestamp is left untouched.
  const parked = db.prepare(`UPDATE kanban_lane_entry_events SET status='queued',
    attempt_count=CASE WHEN attempt_count > 0 THEN attempt_count-1 ELSE 0 END,
    delivery_phase=CASE WHEN dispatch_acknowledged_at IS NULL THEN 'pending' ELSE delivery_phase END,
    claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=NULL, updated_at=?
    WHERE id=? AND claim_token=?`).run(time, eventId, token);
  // The disable PATCH snapshot went out while this entry was still claimed,
  // so mounted clients hold stale counts/chips until this authoritative
  // post-commit queue update lands (FR-3 live queue UX, no refetch).
  if (parked.changes === 1) {
    const entry = db.prepare('SELECT project_id, card_id, lane_id FROM kanban_lane_entry_events WHERE id=?')
      .get(eventId);
    if (entry) {
      const queue = getQueuedLaneEntries(db, entry.lane_id);
      broadcastQueuedEntry(entry.project_id, entry.card_id, entry.lane_id, {
        queuePosition: queue.findIndex((row) => row.id === eventId) + 1,
        queueDepth: queue.length,
      });
    }
  }
}

/**
 * Release a claimed entry back to retryable pending: the lane is enabled, so
 * the pause costs no attempt and a woken delivery resumes automatically.
 * Guarded on the claim token; the caller owns waking delivery.
 * @returns {boolean} true when this token holder released the entry
 */
function releaseClaimedEntryToPending(db, { eventId, token }) {
  const time = Date.now();
  return db.prepare(`UPDATE kanban_lane_entry_events SET status='pending',
    attempt_count=CASE WHEN attempt_count > 0 THEN attempt_count-1 ELSE 0 END,
    delivery_phase=CASE WHEN dispatch_acknowledged_at IS NULL THEN 'pending' ELSE delivery_phase END,
    claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=NULL, updated_at=?
    WHERE id=? AND claim_token=?`).run(time, eventId, token).changes === 1;
}

/**
 * Settle a claimed entry against the CURRENT lane config after async pause
 * cleanup (FR-4, AC-5): the lane may have been re-enabled — or its automation
 * cleared — while abandonment was in flight, so a stale disabled error must
 * not park unconditionally. Only the token holder settles; every branch keeps
 * the no-attempt-penalty behavior.
 * @returns {'queued'|'pending'|'consumed'|'unclaimed'} the settlement outcome
 */
function settleClaimedEntryAgainstLaneConfig(db, { eventId, token }) {
  const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  if (!event || event.claim_token !== token) return 'unclaimed';
  const lane = kanbanLanes.getById(event.lane_id);
  if (lane && isStructured(lane) && !isAutomationActive(lane)) {
    parkClaimedEntryForDisabledLane(db, { eventId, token });
    const after = db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?').get(eventId);
    return after?.status === 'queued' ? 'queued' : 'unclaimed';
  }
  if (lane && isAutomationActive(lane)) {
    return releaseClaimedEntryToPending(db, { eventId, token }) ? 'pending' : 'unclaimed';
  }
  // Automation was cleared mid-cleanup: consume the intent as a no-op rather
  // than leaving a queued row the no-op consumption transaction already ran past.
  const run = db.prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(eventId);
  completeNoopDelivery(db, { eventId, token, event, run });
  broadcastQueueSettledState(db, { projectId: event.project_id, laneId: event.lane_id });
  const after = db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  return after?.status === 'completed' ? 'consumed' : 'unclaimed';
}

/**
 * Settle a claimed entry before dispatch: reject entries whose card or source
 * transition is gone, and park entries whose structured lane was disabled
 * after they were committed. Entries for lanes whose automation was cleared
 * settle through resolveDeliveryState's no-op path in the caller.
 * @returns {boolean} true when the entry was settled and the caller must stop
 */
function settleClaimedEntryBeforeDispatch(db, { eventId, token, claim, event }) {
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
    return true;
  }
  // An obsolete arrival the card intentionally left behind (a move-out
  // supersedes the run while its pending entry survives) is terminally
  // consumed without dispatch — never dropped + recreated (finding 7).
  if (consumeSupersededEntryIfObsolete(db, { eventId, token, claim, event })) return true;
  // A structured lane disabled after its entries were committed parks them
  // back to queued: no spawn, no attempt-count increment, no failure audit.
  // Settlement re-reads the lane so a toggle that landed during async setup
  // converges instead of stranding the entry.
  const entryLane = event && kanbanLanes.getById(event.lane_id);
  if (entryLane && isStructured(entryLane) && !isAutomationActive(entryLane)) {
    const outcome = settleClaimedEntryAgainstLaneConfig(db, { eventId, token });
    if (outcome === 'pending') scheduleLaneEntryDelivery(eventId);
    claim.stop();
    return true;
  }
  return false;
}

/**
 * Bounded per-lane dispatcher (FR-4, AC-3): at most one entry per lane is
 * inside claim → async setup → provider-dispatch-initiation at a time, so
 * arrival order is dispatch order and a large queue cannot launch unbounded
 * concurrent setup work in the HTTP drain path. Waiters are granted the slot
 * in durable arrival order (outbox rowid), not in waiter-queueing order, so a
 * pause/resume attempt re-takes its arrival position instead of joining behind
 * entries that arrived later; the slot always releases (failures never block
 * later items); the pause state is re-checked after acquiring, between
 * entries. The slot releases as soon as the provider call starts — runs then
 * proceed concurrently.
 */
const laneDispatchStates = new Map();

async function withLaneDispatchSlot(laneId, work, orderKey = 0) {
  const state = laneDispatchStates.get(laneId) || { busy: false, waiters: [] };
  laneDispatchStates.set(laneId, state);
  if (state.busy) {
    const key = orderKey;
    await new Promise((resolve) => { state.waiters.push({ orderKey: key, grant: resolve }); });
  } else {
    state.busy = true;
  }
  let slotHeld = true;
  const release = () => {
    if (!slotHeld) return;
    slotHeld = false;
    // Grant the slot to the earliest-arrived waiter, or park the lane idle.
    // A pause/resume attempt carries its original arrival key, so it re-takes
    // its position instead of joining behind later arrivals.
    if (!state.waiters.length) {
      state.busy = false;
      if (laneDispatchStates.get(laneId) === state) laneDispatchStates.delete(laneId);
      return;
    }
    let next = 0;
    for (let i = 1; i < state.waiters.length; i += 1) {
      if (state.waiters[i].orderKey < state.waiters[next].orderKey) next = i;
    }
    const [waiter] = state.waiters.splice(next, 1);
    waiter.grant();
  };
  try {
    return await work(release);
  } finally {
    release();
  }
}

/** Record a per-item delivery failure without breaking the failure path. */
function auditDeliveryFailure(db, runId, event, error) {
  if (!runId) return;
  try {
    db.prepare(`INSERT INTO kanban_lane_run_audit_events
      (id, operation_key, lane_run_id, session_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, NULL, 'delivery_failed', ?, ?)
      ON CONFLICT(operation_key) DO NOTHING`)
      .run(crypto.randomUUID(), `${runId}:delivery_failed:${event.id}:${event.attempt_count}`, runId,
        JSON.stringify({ eventId: event.id, error: String(error?.message || 'delivery failed').slice(0, 240) }),
        Date.now());
  } catch {
    // Audit must never break the failure path it observes.
  }
}

/** Write a delivery failure back to the outbox for retry. */
function failClaimedEntryDelivery(db, { eventId, token, event, error }) {
  const time = Date.now();
  const exhausted = event.attempt_count >= MAX_ENTRY_EVENT_ATTEMPTS;
  const nextAttemptAt = exhausted ? null : time + laneEntryRetryDelay(event.attempt_count);
  db.prepare(`UPDATE kanban_lane_entry_events
    SET status=CASE WHEN ? THEN 'failed' ELSE 'pending' END,
      claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, next_attempt_at=?, last_error=?, updated_at=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END
    WHERE id=? AND claim_token=?`)
    .run(exhausted ? 1 : 0, nextAttemptAt, String(error.message || 'delivery failed').slice(0, 240), time, exhausted ? 1 : 0, time, eventId, token);
}

/**
 * Single dispatch-allowed check shared by the render fence, the final
 * dispatch boundary, and the provider-boundary fence inside runSession: the
 * claim must still be ours and the lane kill-switch still on.
 */
function assertDispatchAllowed(claim, laneId) {
  claim.assertCurrent();
  assertLaneAutomationActive(laneId);
}

/** Drain one committed completion handoff. Safe to call repeatedly. */
// eslint-disable-next-line complexity -- deliberately linear durable state machine
// eslint-disable-next-line max-statements, complexity -- durable transition boundaries are intentionally linear
async function drainLaneEntryTriggerImpl(eventId) {
  const db = databaseManager.get();
  const pre = db.prepare('SELECT lane_id, rowid AS arrivalSeq FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  if (!pre) return false;
  // Synchronous prefix preserves the established drain timing: every drained
  // entry is claimed, settled, and resolved (run created) before detached
  // delivery resumes. Only the async setup → provider-dispatch section below
  // is serialized per lane through the dispatch slot.
  const token = claimLaneEntryTrigger(eventId);
  if (!token) return false;
  const abortController = new AbortController();
  const claim = createLaneEntryClaimGuard(eventId, token, abortController);
  try {
    const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
    if (settleClaimedEntryBeforeDispatch(db, { eventId, token, claim, event })) return false;
    claim.assertCurrent();
    const resolved = resolveDeliveryState(event);
    // The lane's automation was cleared after this entry was committed: a
    // successful no-op, not a delivery (FR-1).
    if (resolved.state === 'no_automation_noop') {
      return completeDrainAsNoop(db, claim, { eventId, token, event, run: resolved.run });
    }
    if (resolved.state === 'ownership_conflict' || resolved.state === 'ambiguous_dispatch') {
      const error = new Error(resolved.reason);
      auditDeliveryFailure(db, resolved.run?.id || null, event, error);
      failClaimedEntryDelivery(db, { eventId, token, event, error });
      throw error;
    }
    // The waiter carries this entry's durable arrival position so a resumed
    // attempt re-takes it instead of queueing behind later arrivals (FR-4).
    return await withLaneDispatchSlot(pre.lane_id, async (releaseSlot) => {
      // Re-check between entries: the lane may have been paused, or the card
      // removed, while waiting for the slot.
      const fresh = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
      if (!fresh || fresh.status !== 'claimed' || fresh.claim_token !== token) return false;
      if (settleClaimedEntryBeforeDispatch(db, { eventId, token, claim, event: fresh })) return false;
      try {
        claim.assertCurrent();
        // A redelivery reuses its existing child; only a first delivery allocates.
        const createdChild = resolved.rootSessionId == null;
        let rootSessionId = resolved.rootSessionId;
        if (resolved.state === 'needs_delivery') {
          const delivery = await triggerLaneEntryAutomation(event.workspace_id, event.lane_id, {
            runOnEnterTemplate: true, laneRunId: resolved.run.id,
            childSessionId: resolved.rootSessionId,
            abortController,
            assertLaneEnabled: () => assertDispatchAllowed(claim, event.lane_id),
            onDispatchInitiated: releaseSlot,
            beforeDispatch: async (childSessionId) => {
              // Final dispatch boundary: re-check the persisted kill-switch after
              // the trigger's async setup. A disable here parks the entry without
              // consuming an attempt; the undispatched child is removed.
              try {
                assertDispatchAllowed(claim, event.lane_id);
              } catch (error) {
                if (isLaneAutomationDisabledError(error) && createdChild) {
                  await abandonUndispatchedChild({ laneRunId: resolved.run.id, childSessionId });
                }
                throw error;
              }
              return markDispatchIntent(event.id, token);
            },
          });
          rootSessionId = delivery?.rootSessionId;
          claim.assertCurrent();
          acknowledgeDispatch(event.id, token);
        }
        claim.assertCurrent();
        return completeVerifiedLaneEntry(event.id, rootSessionId, token);
      } catch (error) {
        // A mid-flight disable is a park, not a failure: the entry settles
        // against the CURRENT lane config — a re-enable (or automation
        // removal) may have landed during async abandonment — without
        // consuming an attempt, and the caller reports no delivery. A
        // re-enabled entry is woken so catch-up needs no further PATCH.
        if (isLaneAutomationDisabledError(error)) {
          const outcome = settleClaimedEntryAgainstLaneConfig(db, { eventId, token });
          if (outcome === 'pending') scheduleLaneEntryDelivery(eventId);
          return false;
        }
        auditDeliveryFailure(db, resolved.run?.id || null, fresh, error);
        failClaimedEntryDelivery(db, { eventId, token, event: fresh, error });
        throw error;
      }
    }, pre.arrivalSeq);
  } finally {
    claim.stop();
  }
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

/**
 * Flip a lane's queued entries to pending in FIFO (arrival) order. Runs
 * inside the caller's transaction so the flag change and the queue release
 * commit atomically (FR-4: one PATCH transaction).
 * @returns {string[]} released event ids in drain order
 */
function flipQueuedEntriesToPending(db, laneId) {
  const rows = getQueuedLaneEntries(db, laneId);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE kanban_lane_entry_events SET status='pending', updated_at=? WHERE id IN (${placeholders})`)
    .run(Date.now(), ...ids);
  return ids;
}

/** Release a lane's queued entries without scheduling their delivery. */
export function releaseQueuedEntries(laneId) {
  return databaseManager.transaction(() => flipQueuedEntriesToPending(databaseManager.get(), laneId));
}

/** Hand released entries to detached delivery; the outbox owns retry. */
export function scheduleLaneEntryDeliveries(eventIds) {
  for (const eventId of eventIds) {
    try {
      scheduleLaneEntryDelivery(eventId);
    } catch (error) {
      console.error(`Kanban queued-entry drain ${eventId} failed to schedule; outbox retry will pick it up:`, error);
    }
  }
}

/**
 * Drain a lane's queued entries back into automation in FIFO (arrival) order.
 * The `queued → pending` flip commits in one transaction; each event is then
 * handed to the existing detached delivery (same fire-and-forget pattern as
 * add/move), so PATCH callers stay synchronous while the outbox owns retry.
 * @param {string} laneId - The re-enabled lane
 * @returns {{ drainedCount: number, eventIds: string[] }}
 */
export function drainQueuedEntries(laneId) {
  const eventIds = releaseQueuedEntries(laneId);
  scheduleLaneEntryDeliveries(eventIds);
  return { drainedCount: eventIds.length, eventIds };
}

/**
 * Apply a lane update together with its automation kill-switch transition.
 * The flag change and the queued→pending release (re-enable) or the
 * pending→queued park (disable) commit in ONE transaction; delivery is
 * scheduled only after commit. Draining runs whenever the lane ends up
 * enabled, so retrying PATCH {automationEnabled:true} also heals entries
 * stranded by an older split-commit crash — no off/on cycle needed.
 * @returns {{ updated: Object, eventIds: string[] }}
 */
/**
 * Consume a lane's queued entries as a successful no-op: the lane update
 * removed its automation, so the queued intents replay the latest config to
 * empty (FR-1) instead of failing delivery against it. Returns consumed ids.
 */
function consumeQueuedEntriesAsNoop(db, laneId) {
  const rows = getQueuedLaneEntries(db, laneId);
  if (!rows.length) return [];
  const time = Date.now();
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE kanban_lane_entry_events SET status='completed', delivery_phase='completed',
    completed_at=?, updated_at=?, claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL,
    next_attempt_at=NULL, last_error=NULL
    WHERE id IN (${placeholders})`).run(time, time, ...ids);
  for (const row of rows) {
    clearConsumedEntryPointer(db, row.card_id, row.id);
  }
  for (const cardId of new Set(rows.map((row) => row.card_id))) {
    supersedeRootlessOpenRun(db, cardId);
  }
  return ids;
}

export function updateLaneWithAutomationToggle(laneId, updateData) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const before = kanbanLanes.getById(laneId);
    const updated = kanbanLanes.update(laneId, updateData);
    let eventIds = [];
    if (updated && !isStructured(updated)) {
      // Automation was cleared (or never configured): queued intents replay
      // the latest config to empty and resolve as a successful no-op (FR-1).
      // The PATCH snapshot broadcast after commit carries the settled counts.
      consumeQueuedEntriesAsNoop(db, laneId);
    } else if (updated?.automationEnabled === true) {
      eventIds = flipQueuedEntriesToPending(db, laneId);
    } else if (updated?.automationEnabled === false && before?.automationEnabled !== false) {
      parkPendingEntriesForLane(laneId);
    }
    return { updated, eventIds };
  });
}

/**
 * Park a lane's undelivered entries back to queued when its automation is
 * disabled mid-flight. Open runs are untouched — only new entries are gated —
 * so already-spawned work continues while the remainder replays on re-enable.
 * Claimed entries are left to the worker park, which releases their leases.
 * @param {string} laneId - The newly disabled lane
 * @returns {{ parkedCount: number }}
 */
export function parkPendingEntriesForLane(laneId) {
  const parkedCount = databaseManager.get().prepare(
    `UPDATE kanban_lane_entry_events SET status='queued', next_attempt_at=NULL, updated_at=?
     WHERE lane_id=? AND status='pending'`
  ).run(Date.now(), laneId).changes;
  return { parkedCount };
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
