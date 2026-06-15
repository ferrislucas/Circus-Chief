import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  sessions,
  sessionTemplates,
  projects,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { triggerOnEnterTemplate, triggerOnEnterPrompt } from './kanbanTriggers.js';

/**
 * Helper to build full board response with lanes and cards
 */
function buildFullBoardResponse(board) {
  if (!board) return null;

  const lanes = kanbanLanes.getByBoardId(board.id);
  const allCards = kanbanCards.getByBoardId(board.id);

  // Group cards by lane
  const cardsByLane = {};
  for (const lane of lanes) {
    cardsByLane[lane.id] = [];
  }
  for (const card of allCards) {
    if (cardsByLane[card.laneId]) {
      cardsByLane[card.laneId].push(card);
    }
  }

  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map((lane) => ({
      ...lane,
      cards: cardsByLane[lane.id] || [],
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

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

async function triggerLaneEntryAutomation(sessionId, laneId, options = {}) {
  const { runOnEnterTemplate = true, depth = 0 } = options;

  if (!runOnEnterTemplate) {
    return;
  }

  const lane = kanbanLanes.getByIdWithTemplate(laneId);
  if (lane?.onEnterTemplateId) {
    await triggerOnEnterTemplate(sessionId, lane, { depth });
  } else if (lane?.onEnterPrompt) {
    await triggerOnEnterPrompt(sessionId, lane, { depth });
  }
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

  // Move the card
  const movedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);

  // Get session for project ID and broadcast
  const sessionId = card.sessions?.[0]?.id;
  const session = sessionId ? sessions.getById(sessionId) : null;

  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: session.projectId,
      cardId,
      fromLaneId,
      toLaneId: targetLaneId,
      card: movedCard,
    });

    await triggerLaneEntryAutomation(sessionId, targetLaneId, { runOnEnterTemplate, depth });
  }

  return movedCard;
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
 * Handle turn completion for a session.
 * If the session has a target_lane_id set, move its card to that lane.
 *
 * @param {string} sessionId - The session that just completed its turn
 */
export async function handleTurnCompletion(sessionId) {
  // Read targetLaneId and clear it from the session that actually completed
  // (this may be a child session, not the workspace root).
  const session = sessions.getById(sessionId);
  if (!session) {
    return;
  }

  // Check if session has a target lane
  if (!session.targetLaneId) {
    return;
  }

  console.log(
    `Kanban: Handling turn completion for session ${sessionId}, target lane: ${session.targetLaneId}`
  );

  // Resolve the workspace root — card lookups and moves operate on the root.
  const workspaceId = resolveWorkspaceId(sessionId);
  const rootSession = sessions.getById(workspaceId);

  // Find or create the card for the workspace root
  let card = kanbanCards.getBySessionId(workspaceId);

  if (!card) {
    // Workspace doesn't have a card yet, create one in the target lane
    const lane = kanbanLanes.getById(session.targetLaneId);
    if (!lane) {
      console.warn(`Kanban: Target lane ${session.targetLaneId} not found for session ${sessionId}`);
      // Clear the invalid target lane on the session that set it
      sessions.update(sessionId, { targetLaneId: null });
      return;
    }

    card = await addSessionToBoard(workspaceId, session.targetLaneId, {
      runOnEnterTemplate: true,
      depth: (rootSession?.laneTriggerDepth) || 0,
    });
  } else {
    // Move the workspace card to target lane
    await moveExistingSessionCard(rootSession || session, card, session.targetLaneId);
  }

  // Clear the target lane on the session that set it (may be a child)
  sessions.update(sessionId, { targetLaneId: null });
}

/**
 * Move an existing card based on the current lane's completion target.
 *
 * When the completing session has no card (e.g. it was spawned by a lane's
 * on-enter prompt), the full ancestor chain is walked to find the session
 * that owns the card so that the parent's card is still advanced.
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

  const currentLane = kanbanLanes.getById(card.laneId);
  if (!currentLane?.completionTargetLaneId) {
    return;
  }

  const targetLaneId = currentLane.completionTargetLaneId;
  if (targetLaneId === currentLane.id) {
    return;
  }

  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane || targetLane.boardId !== currentLane.boardId) {
    return;
  }

  await moveExistingSessionCard(rootSession, card, targetLaneId);
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

  kanbanCards.delete(card.id);

  if (projectId) {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
      projectId,
      cardId: card.id,
      laneId,
    });
  }
}

/**
 * Add a session to its template's target lane if configured.
 * Called after session creation from a template.
 *
 * @param {string} sessionId - The newly created session ID
 * @param {string} templateId - The template ID used to create the session
 */
export async function addSessionToTemplateTargetLane(sessionId, templateId) {
  const template = sessionTemplates.getById(templateId);
  if (!template?.targetLaneId) {
    return;
  }

  const lane = kanbanLanes.getById(template.targetLaneId);
  if (!lane) {
    console.warn(
      `Kanban: Template target lane ${template.targetLaneId} not found for session ${sessionId}`
    );
    return;
  }

  // Normalize to workspace root — addSessionToBoard will also normalize, but
  // being explicit here keeps the log message accurate.
  const workspaceId = resolveWorkspaceId(sessionId);

  try {
    await addSessionToBoard(workspaceId, template.targetLaneId);
    console.log(
      `Kanban: Added workspace ${workspaceId} to lane "${lane.name}" based on template target`
    );
  } catch (error) {
    console.warn(`Kanban: Failed to add workspace ${workspaceId} to board:`, error.message);
  }
}
