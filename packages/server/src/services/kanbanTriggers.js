import {
  sessions,
  sessionTemplates,
  sessionSummaries,
  projects,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { renderTemplatePrompt, getRootSession } from './templateTriggerService.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { resolveAgentTypeFromModel } from './sessionProvider.js';

// Maximum depth for recursive lane-entry template triggers
export const MAX_LANE_TRIGGER_DEPTH = 5;

/**
 * Get session and project for lane trigger, returning null if not found.
 * @param {string} sessionId
 * @returns {{session: Object, project: Object}|null}
 */
export function getSessionAndProjectForTrigger(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Kanban: Session ${sessionId} not found for on-enter trigger`);
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
 * Determine working directory for child session, inheriting parent's worktree if present.
 * @param {Object} parentSession
 * @param {Object} project
 * @param {Object} [gitOptions]
 * @param {string} [gitOptions.gitMode]
 * @param {string} [gitOptions.gitBranch]
 * @param {string} [gitOptions.sessionId]
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null}>}
 */
export async function determineWorkingDirectory(parentSession, project, gitOptions = {}) {
  if (parentSession.gitWorktree) {
    console.log(`Kanban: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree };
  }

  if (gitOptions.sessionId) {
    const gitSetup = await setupGitForSession({
      projectDir: project.workingDirectory,
      gitMode: gitOptions.gitMode || null,
      gitBranch: gitOptions.gitBranch || null,
      sessionId: gitOptions.sessionId,
      worktreeBasePath: project.worktreePath || null,
    });
    return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree };
  }

  return { workingDirectory: project.workingDirectory, gitWorktree: null };
}

/**
 * Start a child session and handle errors via broadcast.
 * @param {Object} newSession
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} options
 */
export function startChildSession(newSession, prompt, workingDirectory, options) {
  runSession(newSession.id, prompt, workingDirectory, options).catch((error) => {
    console.error(`Kanban: Error running on-enter session ${newSession.id}:`, error);
    const errorSession = sessions.update(newSession.id, { status: 'error', error: error.message });
    broadcastToProject(newSession.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: newSession.projectId,
      sessionId: newSession.id,
      session: errorSession,
    });
  });
}

/**
 * Get lane session settings from lane or inherit from parent session.
 * @param {Object} lane
 * @param {Object} session
 * @returns {Object}
 */
export function getLaneSessionSettings(lane, session) {
  return {
    thinkingEnabled: lane.onEnterThinkingEnabled ?? session.thinkingEnabled,
    model: lane.onEnterModel || session.model,
    mode: lane.onEnterMode || session.mode,
    effortLevel: lane.onEnterEffortLevel || session.effortLevel || null,
    gitBranch: session.gitBranch,
  };
}

/**
 * Get template session settings from template or inherit from parent session.
 * @param {Object} template
 * @param {Object} session
 * @returns {Object}
 */
export function getTemplateSessionSettings(template, session) {
  return {
    thinkingEnabled: template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled,
    model: template.model || session.model,
    mode: template.mode || session.mode,
    gitBranch: template.gitBranch || session.gitBranch,
    gitMode: template.gitMode || null,
  };
}

/**
 * Trigger the on-enter template for a lane.
 *
 * @param {string} sessionId - The session that entered the lane
 * @param {Object} lane - The lane with template info
 * @param {Object} [options] - Options
 * @param {number} [options.depth=0] - Current recursion depth
 */
/**
 * Create and configure a child session from a template for lane entry.
 * @param {Object} template
 * @param {Object} session - Parent session
 * @param {Object} lane
 * @param {number} depth - Current trigger depth
 * @returns {{ newSession: Object, renderedPrompt: string, settings: Object }}
 */
async function buildChildSessionFromTemplate(template, session, lane, depth) {
  // Render prompt with session context
  const parentSummary = sessionSummaries.getBySessionId(session.id);
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    template.prompt,
    { parentSession: session, parentSummary, rootSession, rootSummary }
  );

  // Get settings and create session
  const settings = getTemplateSessionSettings(template, session);
  const newSession = sessions.create(session.projectId, `${template.name} (lane: ${lane.name})`, renderedPrompt, {
    mode: settings.mode,
    thinkingEnabled: settings.thinkingEnabled,
    gitBranch: settings.gitBranch,
    status: 'starting',
    model: settings.model,
    agentType: resolveAgentTypeFromModel(settings.model),
  });

  // Configure session
  sessions.update(newSession.id, {
    parentSessionId: session.id,
    nextTemplateId: template.nextTemplateId || null,
    targetLaneId: template.targetLaneId || null,
    laneTriggerDepth: depth + 1,
  });

  return { newSession, renderedPrompt, settings };
}

export async function triggerOnEnterTemplate(sessionId, lane, options = {}) {
  const { depth = 0 } = options;

  if (depth >= MAX_LANE_TRIGGER_DEPTH) {
    console.warn(`Lane trigger depth limit reached for session ${sessionId} in lane ${lane.id}`);
    return;
  }

  const template = sessionTemplates.getById(lane.onEnterTemplateId);
  if (!template) {
    console.warn(`Kanban: On-enter template ${lane.onEnterTemplateId} not found for lane ${lane.id}`);
    return;
  }

  const context = getSessionAndProjectForTrigger(sessionId);
  if (!context) return;
  const { session, project } = context;

  console.log(`Kanban: Triggering on-enter template "${template.name}" for session "${session.name}" entering lane "${lane.name}"`);

  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromTemplate(template, session, lane, depth);

    // Determine working directory
    const { workingDirectory, gitWorktree } = await determineWorkingDirectory(session, project, {
      gitMode: settings.gitMode,
      gitBranch: settings.gitBranch,
      sessionId: newSession.id,
    });
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Broadcast and start
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: sessions.getById(newSession.id),
    });

    startChildSession(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
    });

    console.log(`Kanban: Created and started on-enter session ${newSession.id}`);
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter template for session ${sessionId}:`, error);
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
/**
 * Create and configure a child session from a lane's on-enter prompt.
 * @param {Object} lane
 * @param {Object} session - Parent session
 * @param {number} depth - Current trigger depth
 * @returns {Promise<{ newSession: Object, renderedPrompt: string, settings: Object }>}
 */
async function buildChildSessionFromPrompt(lane, session, depth) {
  // Render prompt with session context
  const parentSummary = sessionSummaries.getBySessionId(session.id);
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    lane.onEnterPrompt,
    { parentSession: session, parentSummary, rootSession, rootSummary }
  );

  // Get settings and create session
  const settings = getLaneSessionSettings(lane, session);
  const newSession = sessions.create(session.projectId, `Lane prompt (lane: ${lane.name})`, renderedPrompt, {
    ...settings,
    status: 'starting',
    agentType: resolveAgentTypeFromModel(settings.model),
  });

  // Configure session
  const sessionUpdates = { parentSessionId: session.id, laneTriggerDepth: depth + 1 };
  if (lane.onEnterAutoRescheduleEnabled) {
    Object.assign(sessionUpdates, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: lane.onEnterRescheduleDelayMinutes || 15,
      rescheduleOnTokenLimit: lane.onEnterRescheduleOnTokenLimit ?? true,
      rescheduleOnServiceError: lane.onEnterRescheduleOnServiceError ?? true,
      maxRescheduleCount: lane.onEnterMaxRescheduleCount || null,
      maxTotalTokens: lane.onEnterMaxTotalTokens || null,
      rescheduleAtTokenCount: lane.onEnterRescheduleAtTokenCount || null,
    });
  }
  sessions.update(newSession.id, sessionUpdates);

  return { newSession, renderedPrompt, settings };
}

export async function triggerOnEnterPrompt(sessionId, lane, options = {}) {
  const { depth = 0 } = options;

  if (depth >= MAX_LANE_TRIGGER_DEPTH) {
    console.warn(`Lane trigger depth limit reached for session ${sessionId} in lane ${lane.id}`);
    return;
  }

  const context = getSessionAndProjectForTrigger(sessionId);
  if (!context) return;
  const { session, project } = context;

  console.log(`Kanban: Triggering on-enter prompt for session "${session.name}" entering lane "${lane.name}"`);

  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromPrompt(lane, session, depth);

    // Determine working directory
    const { workingDirectory, gitWorktree } = await determineWorkingDirectory(session, project);
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Broadcast and start
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: sessions.getById(newSession.id),
    });

    startChildSession(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
    });

    console.log(`Kanban: Created and started on-enter prompt session ${newSession.id}`);
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter prompt for session ${sessionId}:`, error);
  }
}
