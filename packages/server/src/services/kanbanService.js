import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  sessions,
  sessionTemplates,
  sessionSummaries,
  projects,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { renderTemplatePrompt, getRootSession } from './templateTriggerService.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';

// Maximum depth for recursive lane-entry template triggers
const MAX_LANE_TRIGGER_DEPTH = 5;

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
 * Trigger the on-enter template for a lane.
 *
 * @param {string} sessionId - The session that entered the lane
 * @param {Object} lane - The lane with template info
 * @param {Object} [options] - Options
 * @param {number} [options.depth=0] - Current recursion depth
 */
async function triggerOnEnterTemplate(sessionId, lane, options = {}) {
  const { depth = 0 } = options;

  // Check depth limit to prevent infinite loops
  if (depth >= MAX_LANE_TRIGGER_DEPTH) {
    console.warn(
      `Lane trigger depth limit (${MAX_LANE_TRIGGER_DEPTH}) reached for session ${sessionId} in lane ${lane.id}. Skipping template execution.`
    );
    return;
  }

  const template = sessionTemplates.getById(lane.onEnterTemplateId);
  if (!template) {
    console.warn(
      `Kanban: On-enter template ${lane.onEnterTemplateId} not found for lane ${lane.id}`
    );
    return;
  }

  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Kanban: Session ${sessionId} not found for on-enter trigger`);
    return;
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    console.warn(`Kanban: Project ${session.projectId} not found for session ${sessionId}`);
    return;
  }

  console.log(
    `Kanban: Triggering on-enter template "${template.name}" for session "${session.name}" entering lane "${lane.name}"`
  );

  try {
    // Get the parent session's summary for the template context
    const parentSummary = sessionSummaries.getBySessionId(sessionId);

    // Get the root session and its summary
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    // Render the template prompt with parent and root session context
    const renderedPrompt = await renderTemplatePrompt(
      template.prompt,
      session,
      parentSummary,
      rootSession,
      rootSummary
    );

    // Determine settings: use template overrides if set, otherwise inherit from parent session
    const thinkingEnabled =
      template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled;
    const gitBranch = template.gitBranch || session.gitBranch;
    const gitMode = template.gitMode || null;
    const model = template.model || session.model;
    const mode = template.mode || session.mode;

    // Generate a name for the new session
    const newSessionName = `${template.name} (lane: ${lane.name})`;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      newSessionName,
      renderedPrompt,
      mode,
      thinkingEnabled,
      gitBranch,
      null, // parentSessionId - will be set below
      'starting',
      model
    );

    // Set the parent session reference, template chaining, target lane, and depth
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
      targetLaneId: template.targetLaneId || null, // If template has a target lane
      laneTriggerDepth: depth + 1, // Track depth for child sessions
    });

    // Determine working directory: inherit from parent if it has a worktree
    let workingDirectory;
    let gitWorktree = null;

    if (session.gitWorktree) {
      // Parent is in a worktree - child should run in the same worktree
      workingDirectory = session.gitWorktree;
      gitWorktree = session.gitWorktree;
      console.log(`Kanban: Inheriting parent worktree: ${gitWorktree}`);
    } else {
      // Parent is not in a worktree - set up git environment normally
      const gitSetup = await setupGitForSession({
        projectDir: project.workingDirectory,
        gitMode: gitMode,
        gitBranch: gitBranch,
        sessionId: newSession.id,
      });
      workingDirectory = gitSetup.workingDirectory;
      gitWorktree = gitSetup.gitWorktree;
    }

    // Update session with worktree path if set
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Get the fully updated session and broadcast to project subscribers
    const updatedSession = sessions.getById(newSession.id);
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: updatedSession,
    });

    // Start the new session (non-blocking)
    runSession(newSession.id, renderedPrompt, workingDirectory, project.systemPrompt, [], model).catch(
      (error) => {
        console.error(`Kanban: Error running on-enter session ${newSession.id}:`, error);
        const errorSession = sessions.update(newSession.id, {
          status: 'error',
          error: error.message,
        });
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId: newSession.id,
          session: errorSession,
        });
      }
    );

    console.log(`Kanban: Created and started on-enter session ${newSession.id}`);
  } catch (error) {
    console.error(
      `Kanban: Failed to trigger on-enter template for session ${sessionId}:`,
      error
    );
  }
}

/**
 * Trigger a custom prompt for a lane when a session enters it.
 *
 * @param {string} sessionId - The session that entered the lane
 * @param {Object} lane - The lane with prompt info
 * @param {Object} [options] - Options
 * @param {number} [options.depth=0] - Current recursion depth
 */
async function triggerOnEnterPrompt(sessionId, lane, options = {}) {
  const { depth = 0 } = options;

  // Check depth limit to prevent infinite loops
  if (depth >= MAX_LANE_TRIGGER_DEPTH) {
    console.warn(
      `Lane trigger depth limit (${MAX_LANE_TRIGGER_DEPTH}) reached for session ${sessionId} in lane ${lane.id}. Skipping prompt execution.`
    );
    return;
  }

  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Kanban: Session ${sessionId} not found for on-enter prompt trigger`);
    return;
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    console.warn(`Kanban: Project ${session.projectId} not found for session ${sessionId}`);
    return;
  }

  console.log(
    `Kanban: Triggering on-enter prompt for session "${session.name}" entering lane "${lane.name}"`
  );

  try {
    // Get the parent session's summary for the prompt context
    const parentSummary = sessionSummaries.getBySessionId(sessionId);

    // Get the root session and its summary
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    // Render the custom prompt with parent and root session context (same as templates)
    const renderedPrompt = await renderTemplatePrompt(
      lane.onEnterPrompt,
      session,
      parentSummary,
      rootSession,
      rootSummary
    );

    // Use parent session's settings since there's no template to inherit from
    const thinkingEnabled = session.thinkingEnabled;
    const gitBranch = session.gitBranch;
    const model = session.model;
    const mode = session.mode;

    // Generate a name for the new session
    const newSessionName = `Lane prompt (lane: ${lane.name})`;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      newSessionName,
      renderedPrompt,
      mode,
      thinkingEnabled,
      gitBranch,
      null, // parentSessionId - will be set below
      'starting',
      model
    );

    // Set the parent session reference and depth
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      laneTriggerDepth: depth + 1, // Track depth for child sessions
    });

    // Determine working directory: inherit from parent if it has a worktree
    let workingDirectory;
    let gitWorktree = null;

    if (session.gitWorktree) {
      // Parent is in a worktree - child should run in the same worktree
      workingDirectory = session.gitWorktree;
      gitWorktree = session.gitWorktree;
      console.log(`Kanban: Inheriting parent worktree: ${gitWorktree}`);
    } else {
      // Parent is not in a worktree - use project's working directory
      workingDirectory = project.workingDirectory;
    }

    // Update session with worktree path if set
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Get the fully updated session and broadcast to project subscribers
    const updatedSession = sessions.getById(newSession.id);
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: updatedSession,
    });

    // Start the new session (non-blocking)
    runSession(newSession.id, renderedPrompt, workingDirectory, project.systemPrompt, [], model).catch(
      (error) => {
        console.error(`Kanban: Error running on-enter prompt session ${newSession.id}:`, error);
        const errorSession = sessions.update(newSession.id, {
          status: 'error',
          error: error.message,
        });
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId: newSession.id,
          session: errorSession,
        });
      }
    );

    console.log(`Kanban: Created and started on-enter prompt session ${newSession.id}`);
  } catch (error) {
    console.error(
      `Kanban: Failed to trigger on-enter prompt for session ${sessionId}:`,
      error
    );
  }
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
