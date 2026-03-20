import { Liquid } from 'liquidjs';
import { sessions, sessionTemplates, sessionSummaries, projects } from '../database.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

const liquid = new Liquid();

/**
 * Get the root session (the original session that started a template chain)
 * @param {Object} session - The current session
 * @returns {Object} The root session (or the current session if it has no parent)
 */
export function getRootSession(session) {
  let current = session;
  while (current.parentSessionId) {
    const parent = sessions.getById(current.parentSessionId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/**
 * Render a template prompt with parent session and root session context
 * @param {string} templatePrompt - The Liquid template string
 * @param {{ parentSession: Object, parentSummary: Object|null, rootSession: Object, rootSummary: Object|null }} sessionContext - Session context objects
 * @returns {Promise<string>} The rendered prompt
 */
export async function renderTemplatePrompt(templatePrompt, sessionContext) {
  const { parentSession, parentSummary, rootSession, rootSummary } = sessionContext;
  const context = {
    parentSession: {
      id: parentSession.id,
      name: parentSession.name,
      status: parentSession.status,
      summary: parentSummary?.fullSummary || parentSummary?.shortSummary || 'No summary available',
      shortSummary: parentSummary?.shortSummary || 'No summary available',
      fullSummary: parentSummary?.fullSummary || 'No summary available',
      keyActions: parentSummary?.keyActions || [],
      filesModified: parentSummary?.filesModified || [],
      outcome: parentSummary?.outcome || parentSession.status,
    },
    rootSession: {
      id: rootSession.id,
      name: rootSession.name,
      status: rootSession.status,
      summary: rootSummary?.fullSummary || rootSummary?.shortSummary || 'No summary available',
      shortSummary: rootSummary?.shortSummary || 'No summary available',
      fullSummary: rootSummary?.fullSummary || 'No summary available',
      keyActions: rootSummary?.keyActions || [],
      filesModified: rootSummary?.filesModified || [],
      outcome: rootSummary?.outcome || rootSession.status,
    },
  };

  return liquid.parseAndRender(templatePrompt, context);
}

/**
 * Resolve template settings, using template overrides where set, falling back to root session.
 * @param {Object} template - The template object
 * @param {Object} rootSession - The root session to inherit from
 * @returns {Object} Resolved settings
 */
function resolveTemplateSettings(template, rootSession) {
  return {
    thinkingEnabled: template.thinkingEnabled !== null ? template.thinkingEnabled : rootSession.thinkingEnabled,
    gitBranch: template.gitBranch || rootSession.gitBranch,
    gitMode: template.gitMode || null,
    model: template.model !== null ? template.model : rootSession.model,
    mode: template.mode !== null ? template.mode : rootSession.mode,
    effortLevel: template.effortLevel !== null ? template.effortLevel : rootSession.effortLevel,
  };
}

/**
 * Extract rescheduling settings from the root session to inherit on child sessions.
 * @param {Object} rootSession - The root session
 * @returns {Object} Rescheduling settings
 */
function extractRescheduleSettings(rootSession) {
  return {
    autoRescheduleEnabled: rootSession.autoRescheduleEnabled,
    rescheduleOnTokenLimit: rootSession.rescheduleOnTokenLimit,
    rescheduleOnServiceError: rootSession.rescheduleOnServiceError,
    rescheduleDelayMinutes: rootSession.rescheduleDelayMinutes,
    rescheduleAtTokenCount: rootSession.rescheduleAtTokenCount,
    maxRescheduleCount: rootSession.maxRescheduleCount,
    maxTotalTokens: rootSession.maxTotalTokens,
  };
}

/**
 * Resolve the git working directory for a child session, inheriting worktree from parent if set.
 * @param {Object} options
 * @param {Object} options.parentSession - The parent session
 * @param {Object} options.project - The project
 * @param {string} options.gitMode - Git mode
 * @param {string} options.gitBranch - Git branch
 * @param {string} options.newSessionId - New session ID
 * @returns {Promise<{ workingDirectory: string, gitWorktree: string|null }>}
 */
async function resolveChildWorkingDirectory({ parentSession, project, gitMode, gitBranch, newSessionId }) {
  if (parentSession.gitWorktree) {
    console.log(`Template trigger: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree };
  }
  const gitSetup = await setupGitForSession({
    projectDir: project.workingDirectory,
    gitMode,
    gitBranch,
    sessionId: newSessionId,
  });
  return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree };
}

/**
 * Broadcast a newly created session and start it, with error handling.
 * @param {Object} options
 * @param {string} options.newSessionId - The new session ID
 * @param {string} options.projectId - The project ID
 * @param {string} options.renderedPrompt - The rendered prompt
 * @param {string} options.workingDirectory - The working directory
 * @param {string} options.systemPrompt - Project system prompt
 * @param {string} options.model - Model to use
 */
function broadcastAndStartChildSession({ newSessionId, projectId, renderedPrompt, workingDirectory, systemPrompt, model }) {
  const updatedSession = sessions.getById(newSessionId);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
    projectId,
    session: updatedSession,
  });

  runSession(newSessionId, renderedPrompt, workingDirectory, { systemPrompt, model }).catch((error) => {
    console.error(`Template trigger: Error running session ${newSessionId}:`, error);
    const errorSession = sessions.update(newSessionId, { status: 'error', error: error.message });
    broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId,
      sessionId: newSessionId,
      session: errorSession,
    });
  });

  console.log(`Template trigger: Created and started session ${newSessionId}`);
}

/**
 * Check if a session should trigger its next template and do so
 * Called when a session completes (status changes to completed, error, or stopped)
 * @param {string} sessionId - The session that just completed
 */
export async function checkAndTriggerNextTemplate(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Template trigger: Session ${sessionId} not found`);
    return;
  }

  if (!session.nextTemplateId) {
    return;
  }

  const template = sessionTemplates.getById(session.nextTemplateId);
  if (!template) {
    console.warn(`Template trigger: Template ${session.nextTemplateId} not found for session ${sessionId}`);
    return;
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    console.warn(`Template trigger: Project ${session.projectId} not found for session ${sessionId}`);
    return;
  }

  console.log(`Template trigger: Triggering template "${template.name}" after session "${session.name}"`);

  try {
    const parentSummary = sessionSummaries.getBySessionId(sessionId);
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    const renderedPrompt = await renderTemplatePrompt(template.prompt, {
      parentSession: session, parentSummary, rootSession, rootSummary,
    });

    const settings = resolveTemplateSettings(template, rootSession);
    const rescheduleSettings = extractRescheduleSettings(rootSession);

    const newSession = sessions.create(session.projectId, `${template.name} (from: ${session.name})`, renderedPrompt, {
      mode: settings.mode, thinkingEnabled: settings.thinkingEnabled,
      gitBranch: settings.gitBranch, parentSessionId: null, status: 'starting', model: settings.model,
      effortLevel: settings.effortLevel,
    });

    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
      ...rescheduleSettings,
    });

    const { workingDirectory, gitWorktree } = await resolveChildWorkingDirectory({
      parentSession: session, project, gitMode: settings.gitMode, gitBranch: settings.gitBranch, newSessionId: newSession.id,
    });

    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    broadcastAndStartChildSession({ newSessionId: newSession.id, projectId: session.projectId, renderedPrompt, workingDirectory, systemPrompt: project.systemPrompt, model: template.model });
  } catch (error) {
    console.error(`Template trigger: Failed to trigger template for session ${sessionId}:`, error);
  }
}
