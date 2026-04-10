import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  sessions,
  sessionTemplates,
  projects,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
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
 * @returns {Object|null} Full board with lanes and cards, or null if kanban is disabled
 */
export function getFullBoard(projectId) {
  const project = projects.getById(projectId);
  if (!project) {
    return null;
  }

  // If kanban is disabled, return null
  if (!project.kanbanEnabled) {
    return null;
  }

  const board = kanbanBoards.getOrCreateForProject(projectId);
  return buildFullBoardResponse(board);
}

/**
 * Add a session to the kanban board.
 *
 * @param {string} sessionId - The session ID
 * @param {string} laneId - The lane to add the session to
 * @param {Object} [options] - Options
 * @param {number} [options.sortOrder] - Optional sort order
 * @returns {Object} The created card
 * @throws {Error} If session already has a card on the board
 */
export function addSessionToBoard(sessionId, laneId, options = {}) {
  // Check if session already has a card
  const existingCard = kanbanCards.getBySessionId(sessionId);
  if (existingCard) {
    throw new Error('Session already has a card on the board');
  }

  const card = kanbanCards.create(laneId, sessionId, options);

  // Get session to find project ID for broadcast
  const session = sessions.getById(sessionId);
  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
      projectId: session.projectId,
      card,
      laneId,
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

    // Trigger on-enter automation if configured (template or custom prompt)
    if (runOnEnterTemplate) {
      const targetLane = kanbanLanes.getByIdWithTemplate(targetLaneId);
      if (targetLane?.onEnterTemplateId) {
        await triggerOnEnterTemplate(sessionId, targetLane, { depth });
      } else if (targetLane?.onEnterPrompt) {
        await triggerOnEnterPrompt(sessionId, targetLane, { depth });
      }
    }
  }

  return movedCard;
}

/**
 * Handle turn completion for a session.
 * If the session has a target_lane_id set, move its card to that lane.
 *
 * @param {string} sessionId - The session that just completed its turn
 */
export async function handleTurnCompletion(sessionId) {
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

  // Find or create the card for this session
  let card = kanbanCards.getBySessionId(sessionId);

  if (!card) {
    // Session doesn't have a card yet, create one in the target lane
    const lane = kanbanLanes.getById(session.targetLaneId);
    if (!lane) {
      console.warn(`Kanban: Target lane ${session.targetLaneId} not found for session ${sessionId}`);
      // Clear the invalid target lane
      sessions.update(sessionId, { targetLaneId: null });
      return;
    }

    card = kanbanCards.create(session.targetLaneId, sessionId);

    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
      projectId: session.projectId,
      card,
      laneId: session.targetLaneId,
    });
  } else {
    // Move existing card to target lane
    const fromLaneId = card.laneId;

    if (fromLaneId !== session.targetLaneId) {
      await moveCard(card.id, session.targetLaneId, {
        runOnEnterTemplate: true,
        depth: session.laneTriggerDepth || 0,
      });
    }
  }

  // Clear the target lane now that we've processed it
  sessions.update(sessionId, { targetLaneId: null });
}

/**
 * Remove a session from the board (called when session is deleted).
 *
 * @param {string} sessionId - The session ID
 */
export function removeSessionFromBoard(sessionId) {
  const card = kanbanCards.getBySessionId(sessionId);
  if (!card) {
    return; // Session wasn't on the board
  }

  const laneId = card.laneId;
  const session = sessions.getById(sessionId);
  const projectId = session?.projectId;

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
export function addSessionToTemplateTargetLane(sessionId, templateId) {
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

  try {
    addSessionToBoard(sessionId, template.targetLaneId);
    console.log(
      `Kanban: Added session ${sessionId} to lane "${lane.name}" based on template target`
    );
  } catch (error) {
    console.warn(`Kanban: Failed to add session ${sessionId} to board:`, error.message);
  }
}
