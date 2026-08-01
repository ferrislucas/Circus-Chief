import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  sessions,
  projects,
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

  if (!runOnEnterTemplate) {
    return;
  }

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  if (lane?.onEnterTemplateId) {
    await triggerOnEnterTemplate(sessionId, lane, { depth, laneRunId });
  } else if (lane?.onEnterPrompt) {
    await triggerOnEnterPrompt(sessionId, lane, { depth, laneRunId });
  }
}

/**
 * F1 (PR #1066 remediation): a lane run's root is only ever attached from
 * inside triggerOnEnterTemplate/triggerOnEnterPrompt (kanbanTriggers.js) —
 * i.e. only when the lane actually spawns an on-entry worker. A lane whose
 * completionMode auto-derived to 'structured' purely from having a
 * completionTargetLaneId (KanbanLaneRepository#update) but with NO on-enter
 * automation would otherwise still get a lane run opened for it here, whose
 * root_session_id can never be attached — an orphaned run that (a) never
 * succeeds and (b) permanently blocks the legacy handleCompletionMove
 * fallback via the card's activeLaneRunId guard. "Just move this card when
 * its own session finishes here, no spawned worker" is a legitimate,
 * pre-existing configuration (see kanban-completion-move.spec.ts), so a
 * structured lane run is only opened when there is an on-entry automation to
 * actually own it; otherwise completion continues through the always-present
 * legacy per-session path.
 * @param {Object|null} lane
 * @returns {boolean}
 */
function hasOnEnterAutomation(lane) {
  return Boolean(lane?.onEnterTemplateId || lane?.onEnterPrompt);
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
    const laneRun = isStructured(lane) && hasOnEnterAutomation(lane)
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
    await triggerLaneEntryAutomation(workspaceId, laneId, {
      runOnEnterTemplate,
      depth: depth || rootDepth,
      laneRunId: laneRun?.id,
    });
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
    const laneRun = isStructured(lane) && hasOnEnterAutomation(lane)
      ? createLaneRunForEntry({ projectId: session.projectId, workspaceId: resolveWorkspaceId(session.id), cardId, lane, cause: 'manual_move' })
      : null;
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    await triggerLaneEntryAutomation(sessionId, targetLaneId, { runOnEnterTemplate, depth, laneRunId: laneRun?.id });
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
 * the necessarily-async remainder: creating (for a structured/shadow target
 * lane) the next lane run and starting its on-enter session.
 *
 * @param {{ workspaceSessionId: string, targetLaneId: string, cardId: string, sourceRunId: string }} pending
 */
export async function triggerStructuredTransitionAutomation(pending) {
  const { workspaceSessionId, targetLaneId, cardId, sourceRunId } = pending;
  const workspaceSession = sessions.getById(workspaceSessionId);
  if (!workspaceSession) return;

  const lane = kanbanLanes.getById(targetLaneId);
  const laneRun = isStructured(lane) && hasOnEnterAutomation(lane)
    ? createLaneRunForEntry({
        projectId: workspaceSession.projectId,
        workspaceId: workspaceSessionId,
        cardId,
        lane,
        cause: 'completion',
        priorLaneRunId: sourceRunId,
      })
    : null;

  await triggerLaneEntryAutomation(workspaceSessionId, targetLaneId, {
    runOnEnterTemplate: true,
    depth: workspaceSession.laneTriggerDepth || 0,
    laneRunId: laneRun?.id,
  });
}

async function moveExistingSessionCard(session, card, targetLaneId) {
  if (card.laneId === targetLaneId) {
    return card;
  }

  return moveCard(card.id, targetLaneId, {
    runOnEnterTemplate: true,
    depth: session.laneTriggerDepth || 0,
  });
}

/**
 * Check whether a workspace root has any incomplete lane-triggered descendants.
 *
 * A lane-triggered descendant is a session with laneTriggerDepth > 0 (set by
 * triggerOnEnterPrompt / triggerOnEnterTemplate when spawning on-enter children).
 * "Incomplete" means the session is still in a pending/active state: starting,
 * running, or scheduled.
 *
 * @param {string} rootId - Workspace root session ID
 * @returns {boolean} True if any incomplete lane-triggered descendant exists
 */
function hasIncompleteLaneTriggeredDescendant(rootId) {
  const INCOMPLETE_STATUSES = new Set(['starting', 'running', 'scheduled']);
  const descendantIds = sessions.getAllDescendantIds(rootId);
  for (const id of descendantIds) {
    const s = sessions.getById(id);
    if (s && s.laneTriggerDepth > 0 && INCOMPLETE_STATUSES.has(s.status)) {
      return true;
    }
  }
  return false;
}

/**
 * Move an existing card based on the current lane's completion target.
 *
 * When the completing session has no card (e.g. it was spawned by a lane's
 * on-enter prompt), the full ancestor chain is walked to find the session
 * that owns the card so that the parent's card is still advanced.
 *
 * Guard: if the workspace root is completing in a lane with on-enter automation
 * (onEnterPrompt or onEnterTemplateId) and there is still an incomplete
 * lane-triggered descendant, the completion move is deferred. The move will
 * fire later when the lane-created child (representing the lane's actual work)
 * completes. A non-root (child) completing always proceeds — the child IS the
 * lane work, so its completion should advance the card.
 *
 * @param {string} sessionId - The session that just completed its turn
 */
export async function handleCompletionMove(sessionId) {
  // Resolve to workspace root — the card is keyed to the root.
  const workspaceId = resolveWorkspaceId(sessionId);
  const rootSession = sessions.getById(workspaceId);
  if (!rootSession) {
    return;
  }

  const card = kanbanCards.getBySessionId(workspaceId);

  if (!card) {
    return;
  }

  // Structured/shadow runs own completion. The legacy completion hook must
  // never race a persisted run into moving a card.
  if (card.activeLaneRunId) return;

  const currentLane = kanbanLanes.getById(card.laneId);
  // A shadow run clears activeLaneRunId after evaluation, so it needs an
  // explicit guard against the legacy hook reopening the card. Structured
  // runs retain the active-run guard until their server-driven transition.
  const targetLaneId = legacyCompletionTarget(currentLane);
  if (!targetLaneId) return;
  if (targetLaneId === currentLane.id) {
    return;
  }

  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane || targetLane.boardId !== currentLane.boardId) {
    return;
  }

  // Guard: if the workspace root is completing in an automation lane and a
  // lane-triggered descendant is still incomplete, defer the move. The card
  // will advance once the lane's actual work (the child session) completes.
  const isRootCompleting = sessionId === workspaceId;
  if (
    isRootCompleting &&
    (currentLane.onEnterPrompt || currentLane.onEnterTemplateId) &&
    hasIncompleteLaneTriggeredDescendant(workspaceId)
  ) {
    return;
  }

  await moveExistingSessionCard(rootSession, card, targetLaneId);
}

function legacyCompletionTarget(lane) {
  return lane?.completionMode === 'shadow' ? null : lane?.completionTargetLaneId;
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
