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
 * Resolve template settings, using template overrides where set, falling back to parent session.
 * @param {Object} template - The template object
 * @param {Object} session - The parent session
 * @returns {{ thinkingEnabled: boolean, gitBranch: string, gitMode: string|null, model: string, mode: string }}
 */
function resolveTemplateSettings(template, session) {
  return {
    thinkingEnabled: template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled,
    gitBranch: template.gitBranch || session.gitBranch,
    gitMode: template.gitMode || null,
    model: template.model || session.model,
    mode: template.mode || session.mode,
  };
}

/**
 * Resolve git working directory for a new child session, setting up worktree if needed.
 * @param {Object} options
 * @param {Object} options.parentSession - The parent session
 * @param {Object} options.project - The project
 * @param {string} options.gitMode - Git mode for the new session
 * @param {string} options.gitBranch - Git branch for the new session
 * @param {string} options.newSessionId - The new session ID
 * @returns {Promise<{ workingDirectory: string, gitWorktree: string|null }>}
 */
async function resolveGitWorkingDirectory({ parentSession, project, gitMode, gitBranch, newSessionId }) {
  if (parentSession.gitWorktree) {
    console.log(`Kanban: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree };
  }
  const gitSetup = await setupGitForSession({
    projectDir: project.workingDirectory,
    gitMode: gitMode,
    gitBranch: gitBranch,
    sessionId: newSessionId,
  });
  return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree };
}

/**
 * Broadcast the creation of a new session and start it, handling errors.
 * @param {Object} options
 * @param {Object} options.newSession - The newly created session
 * @param {string} options.projectId - The project ID
 * @param {string} options.renderedPrompt - The rendered prompt
 * @param {string} options.workingDirectory - The working directory
 * @param {string} options.systemPrompt - Project system prompt
 * @param {string} options.model - Model to use
 * @param {string} options.logPrefix - Log prefix for error messages
 */
function broadcastAndStartSession({ newSession, projectId, renderedPrompt, workingDirectory, systemPrompt, model, logPrefix }) {
  const updatedSession = sessions.getById(newSession.id);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
    projectId,
    session: updatedSession,
  });

  runSession(newSession.id, renderedPrompt, workingDirectory, {
    systemPrompt,
    model,
  }).catch((error) => {
    console.error(`${logPrefix}: Error running session ${newSession.id}:`, error);
    const errorSession = sessions.update(newSession.id, {
      status: 'error',
      error: error.message,
    });
    broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId,
      sessionId: newSession.id,
      session: errorSession,
    });
  });

  console.log(`${logPrefix}: Created and started session ${newSession.id}`);
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

  if (depth >= MAX_LANE_TRIGGER_DEPTH) {
    console.warn(
      `Lane trigger depth limit (${MAX_LANE_TRIGGER_DEPTH}) reached for session ${sessionId} in lane ${lane.id}. Skipping template execution.`
    );
    return;
  }

  const template = sessionTemplates.getById(lane.onEnterTemplateId);
  if (!template) {
    console.warn(`Kanban: On-enter template ${lane.onEnterTemplateId} not found for lane ${lane.id}`);
    return;
  }

  const context = validateLaneTriggerContext(sessionId, 'template');
  if (!context) return;
  const { session, project } = context;

  console.log(
    `Kanban: Triggering on-enter template "${template.name}" for session "${session.name}" entering lane "${lane.name}"`
  );

  try {
    const parentSummary = sessionSummaries.getBySessionId(sessionId);
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    const renderedPrompt = await renderTemplatePrompt(
      template.prompt,
      { parentSession: session, parentSummary, rootSession, rootSummary }
    );

    const settings = resolveTemplateSettings(template, session);
    const newSessionName = `${template.name} (lane: ${lane.name})`;

    const newSession = sessions.create(session.projectId, newSessionName, renderedPrompt, {
      mode: settings.mode,
      thinkingEnabled: settings.thinkingEnabled,
      gitBranch: settings.gitBranch,
      status: 'starting',
      model: settings.model,
    });

    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
      targetLaneId: template.targetLaneId || null,
      laneTriggerDepth: depth + 1,
    });

    const { workingDirectory, gitWorktree } = await resolveGitWorkingDirectory({
      parentSession: session, project, gitMode: settings.gitMode, gitBranch: settings.gitBranch, newSessionId: newSession.id,
    });

    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    broadcastAndStartSession({ newSession, projectId: session.projectId, renderedPrompt, workingDirectory, systemPrompt: project.systemPrompt, model: settings.model, logPrefix: 'Kanban' });
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter template for session ${sessionId}:`, error);
  }
}

/**
 * Resolve the working directory for a child session, inheriting worktree from parent if set.
 * @param {Object} parentSession - The parent session
 * @param {Object} project - The project
 * @returns {{ workingDirectory: string, gitWorktree: string|null }}
 */
function resolveWorkingDirectory(parentSession, project) {
  if (parentSession.gitWorktree) {
    console.log(`Kanban: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree };
  }
  return { workingDirectory: project.workingDirectory, gitWorktree: null };
}

/**
 * Apply auto-reschedule settings from a lane to a session, if configured.
 * @param {string} sessionId - The session to update
 * @param {Object} lane - The lane with auto-reschedule settings
 */
function applyAutoRescheduleSettings(sessionId, lane) {
  if (!lane.onEnterAutoRescheduleEnabled) return;
  sessions.update(sessionId, {
    autoRescheduleEnabled: true,
    rescheduleDelayMinutes: lane.onEnterRescheduleDelayMinutes || 15,
    rescheduleOnTokenLimit: lane.onEnterRescheduleOnTokenLimit ?? true,
    rescheduleOnServiceError: lane.onEnterRescheduleOnServiceError ?? true,
    maxRescheduleCount: lane.onEnterMaxRescheduleCount || null,
    maxTotalTokens: lane.onEnterMaxTotalTokens || null,
    rescheduleAtTokenCount: lane.onEnterRescheduleAtTokenCount || null,
  });
}

/**
 * Validate session and project exist for a lane trigger, returning null if invalid.
 * @param {string} sessionId
 * @param {string} triggerType - 'prompt' or 'template' for logging
 * @returns {{ session: Object, project: Object }|null}
 */
function validateLaneTriggerContext(sessionId, triggerType) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Kanban: Session ${sessionId} not found for on-enter ${triggerType} trigger`);
    return null;
  }
  const project = projects.getById(session.projectId);
  if (!project) {
    console.warn(`Kanban: Project ${session.projectId} not found for session ${sessionId}`);
    return null;
  }
  return { session, project };
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

  const context = validateLaneTriggerContext(sessionId, 'prompt');
  if (!context) return;
  const { session, project } = context;

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
      { parentSession: session, parentSummary, rootSession, rootSummary }
    );

    // Lane overrides take precedence; fall back to parent session's settings
    const model = lane.onEnterModel || session.model;
    const mode = lane.onEnterMode || session.mode;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      `Lane prompt (lane: ${lane.name})`,
      renderedPrompt,
      {
        mode,
        thinkingEnabled: lane.onEnterThinkingEnabled ?? session.thinkingEnabled,
        gitBranch: session.gitBranch,
        status: 'starting',
        model,
        effortLevel: lane.onEnterEffortLevel || session.effortLevel || null,
      }
    );

    // Set the parent session reference and depth
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      laneTriggerDepth: depth + 1,
    });

    applyAutoRescheduleSettings(newSession.id, lane);

    // Determine working directory: inherit from parent if it has a worktree
    const { workingDirectory, gitWorktree } = resolveWorkingDirectory(session, project);

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
    runSession(newSession.id, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model,
    }).catch(
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
