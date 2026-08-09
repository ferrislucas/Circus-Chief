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
import { createLaneRunForEntry, supersedeRunForCard, isStructured } from './workflowSessionService.js';
import { buildFullBoardResponse } from './kanbanBoardResponse.js';

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
  const { runOnEnterTemplate = true, depth = 0, laneRunId = null } = options;

  if (!runOnEnterTemplate) return { delivered: true, rootSessionId: null };

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  let result = { delivered: true, rootSessionId: null };
  if (lane?.onEnterTemplateId) {
    result = await triggerOnEnterTemplate(sessionId, lane, { depth, laneRunId });
  } else if (lane?.onEnterPrompt) {
    result = await triggerOnEnterPrompt(sessionId, lane, { depth, laneRunId });
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
  const { sortOrder, runOnEnterTemplate = true, depth = 0 } = options;

  // Normalize to workspace root — all cards are keyed to the root session.
  const workspaceId = resolveWorkspaceId(sessionId);

  // Check if session already has a card
  const existingCard = kanbanCards.getBySessionId(workspaceId);
  if (existingCard) {
    throw new Error('Session already has a card on the board');
  }

  const card = kanbanCards.create(laneId, workspaceId, { sortOrder });

  // Get root session to find project ID for broadcast and lane entry automation.
  const rootSession = sessions.getById(workspaceId);
  if (rootSession) {
    const lane = kanbanLanes.getById(laneId);
    const laneRun = runOnEnterTemplate && isStructured(lane)
      ? createLaneRunForEntry({ projectId: rootSession.projectId, workspaceId, cardId: card.id, lane })
      : null;
    broadcastToProject(rootSession.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
      projectId: rootSession.projectId,
      card,
      laneId,
    });

    // Lane entry automation fires on the workspace root (consistent with
    // "all sessions in a workspace move together").
    const rootDepth = rootSession.laneTriggerDepth || 0;
    const delivery = await triggerLaneEntryAutomation(workspaceId, laneId, {
      runOnEnterTemplate,
      depth: depth || rootDepth,
      laneRunId: laneRun?.id,
    });
    completeVerifiedLaneEntry(laneRun?.laneEntryEventId, delivery.rootSessionId);
  }

  return card;
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
 * @returns {Promise<Object>} The moved card
 */
export async function moveCard(cardId, targetLaneId, options = {}) {
  const { sortOrder, runOnEnterTemplate = true, depth = 0 } = options;

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    throw new Error('Card not found');
  }

  const fromLaneId = card.laneId;

  // A human/API move revokes an open run before changing lanes. Completion
  // transitions use their own guarded SQL path and never call this service.
  supersedeRunForCard(cardId, 'manual_move');

  // Move the card
  const movedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);

  // Get session for project ID and broadcast
  const sessionId = card.sessions?.[0]?.id;
  const session = sessionId ? sessions.getById(sessionId) : null;

  if (session) {
    const lane = kanbanLanes.getById(targetLaneId);
    const laneRun = runOnEnterTemplate && isStructured(lane)
      ? createLaneRunForEntry({ projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause: 'manual_move' })
      : null;
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    const delivery = await triggerLaneEntryAutomation(sessionId, targetLaneId, { runOnEnterTemplate, depth, laneRunId: laneRun?.id });
    completeVerifiedLaneEntry(laneRun?.laneEntryEventId, delivery.rootSessionId);
  }

  return movedCard;
}

/**
 * W6 (FRD: Kanban Lane-Run Structured Completion, FR-8): finish a
 * structured lane-run's transition into the target lane's on-enter
 * automation.
 *
 * The DB transition itself (marking the run succeeded, moving the card,
 * assigning sort_order, broadcasting KANBAN_CARD_MOVED) already happened
 * synchronously and atomically inside workflowSessionService.js's
 * attemptLaneRunTransition — that module cannot import this one (kanbanService
 * -> kanbanTriggers -> sessionManager -> sessionExecution -> workflowSessionService
 * would cycle), so it hands back a `pendingTargetLaneTrigger` descriptor for
 * the necessarily-async remainder: creating the target lane's next run and
 * starting its on-enter session.
 *
 * @param {{ workspaceSessionId: string, targetLaneId: string, cardId: string, sourceRunId: string }} pending
 */
export async function triggerStructuredTransitionAutomation(pending) {
  const { workspaceSessionId, targetLaneId, cardId, sourceRunId } = pending;
  const workspaceSession = sessions.getById(workspaceSessionId);
  if (!workspaceSession) return;

  const lane = kanbanLanes.getById(targetLaneId);
  const laneRun = isStructured(lane)
    ? createLaneRunForEntry({
        projectId: workspaceSession.projectId,
        workspaceId: workspaceSessionId,
        cardId,
        lane,
        cause: 'completion',
        priorLaneRunId: sourceRunId,
        entryEventId: pending.laneEntryEventId,
      })
    : null;

  return triggerLaneEntryAutomation(workspaceSessionId, targetLaneId, {
    runOnEnterTemplate: true,
    depth: workspaceSession.laneTriggerDepth || 0,
    laneRunId: laneRun?.id,
  });
}

const ENTRY_EVENT_LEASE_MS = 5 * 60 * 1000;
const MAX_ENTRY_EVENT_ATTEMPTS = 8;

function claimLaneEntryTrigger(eventId) {
  const token = crypto.randomUUID();
  const time = Date.now();
  const claimed = databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
    SET claim_token=?, claimed_at=?, attempt_count=attempt_count+1, updated_at=?
    WHERE id=? AND status='pending' AND claim_token IS NULL AND attempt_count < ?`).run(token, time, time, eventId, MAX_ENTRY_EVENT_ATTEMPTS);
  return claimed.changes ? token : null;
}

function completeVerifiedLaneEntry(eventId, rootSessionId) {
  if (!eventId || !rootSessionId) return;
  const db = databaseManager.get();
  const owner = db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE lane_entry_event_id=? AND status='open' AND root_session_id=?`).get(eventId, rootSessionId);
  if (!owner) throw new Error('Lane-entry delivery did not attach the expected run root');
  const time = Date.now();
  const completed = db.prepare(`UPDATE kanban_lane_entry_events SET status='completed', completed_at=?, updated_at=?
    WHERE id=? AND status='pending' AND claim_token IS NULL`).run(time, time, eventId);
  if (completed.changes !== 1) throw new Error('Lane-entry event could not be completed after root verification');
}

/** Drain one committed completion handoff. Safe to call repeatedly. */
export async function drainLaneEntryTrigger(eventId) {
  const token = claimLaneEntryTrigger(eventId);
  if (!token) return false;
  const db = databaseManager.get();
  const event = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  const valid = event && db.prepare(`SELECT 1 FROM kanban_cards c JOIN kanban_lanes l ON l.id=c.lane_id
    WHERE c.id=? AND c.lane_id=?`).get(event.card_id, event.lane_id);
  // A completion handoff is valid only if its source run actually performed
  // this exact guarded transition. This prevents an old outbox event from
  // spawning work after a manual move or a superseded source worker.
  const sourceValid = !event?.caused_by_run_id || db.prepare(`SELECT 1 FROM kanban_lane_runs
    WHERE id=? AND status='succeeded' AND transition_applied_at IS NOT NULL`).get(event.caused_by_run_id);
  if (!valid || !sourceValid) {
    const reason = !valid ? 'card no longer belongs to entry lane' : 'source run no longer owns a completed transition';
    const time = Date.now();
    db.prepare(`UPDATE kanban_lane_entry_events SET status='invalid', last_error=?,
      completed_at=?, updated_at=? WHERE id=? AND claim_token=?`).run(reason, time, time, eventId, token);
    return false;
  }
  try {
    const delivery = await triggerStructuredTransitionAutomation({
      workspaceSessionId: event.workspace_id, targetLaneId: event.lane_id,
      cardId: event.card_id, sourceRunId: event.caused_by_run_id, laneEntryEventId: event.id,
    });
    const ownsExpectedRoot = !event.caused_by_run_id || db.prepare(`SELECT 1 FROM kanban_lane_runs
      WHERE lane_entry_event_id=? AND status='open' AND root_session_id=?`).get(event.id, delivery.rootSessionId);
    if (!ownsExpectedRoot) throw new Error('Lane-entry delivery did not attach the expected run root');
    const time = Date.now();
    db.prepare(`UPDATE kanban_lane_entry_events
      SET status='completed', completed_at=?, updated_at=? WHERE id=? AND claim_token=?`)
      .run(time, time, eventId, token);
    return true;
  } catch (error) {
    const time = Date.now();
    const exhausted = event.attempt_count >= MAX_ENTRY_EVENT_ATTEMPTS;
    db.prepare(`UPDATE kanban_lane_entry_events
      SET status=CASE WHEN ? THEN 'failed' ELSE 'pending' END,
        claim_token=NULL, claimed_at=NULL, last_error=?, updated_at=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END
      WHERE id=? AND claim_token=?`)
      .run(exhausted ? 1 : 0, error.message, time, exhausted ? 1 : 0, time, eventId, token);
    throw error;
  }
}

/** Recover completion handoffs persisted before an unexpected process exit. */
export async function drainPendingLaneEntryTriggers() {
  const leaseExpiry = Date.now() - ENTRY_EVENT_LEASE_MS;
  databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET claim_token=NULL, claimed_at=NULL, updated_at=?
    WHERE status='pending' AND claim_token IS NOT NULL AND claimed_at < ?`).run(Date.now(), leaseExpiry);
  // Terminally expose exhausted deliveries instead of endlessly spinning a
  // startup loop. Pending event age/attempt_count/last_error remain directly
  // queryable through the durable outbox table for operations visibility.
  databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET status='failed', last_error=COALESCE(last_error, 'delivery attempts exhausted'),
    completed_at=?, updated_at=? WHERE status='pending' AND attempt_count >= ?`).run(Date.now(), Date.now(), MAX_ENTRY_EVENT_ATTEMPTS);
  const events = databaseManager.get().prepare(`SELECT id FROM kanban_lane_entry_events
    WHERE status='pending' ORDER BY created_at`).all();
  for (const { id } of events) {
    try { await drainLaneEntryTrigger(id); } catch (error) { console.error('Kanban lane-entry recovery failed:', error); }
  }
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
