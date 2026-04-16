import { Liquid } from 'liquidjs';
import { sessions, sessionTemplates, sessionSummaries, projects } from '../database.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

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
 * Build a template context object for a session and its summary.
 */
function buildSessionContext(session, summary) {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    summary: summary?.fullSummary || summary?.shortSummary || 'No summary available',
    shortSummary: summary?.shortSummary || 'No summary available',
    fullSummary: summary?.fullSummary || 'No summary available',
    keyActions: summary?.keyActions || [],
    filesModified: summary?.filesModified || [],
    outcome: summary?.outcome || session.status,
  };
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
    parentSession: buildSessionContext(parentSession, parentSummary),
    rootSession: buildSessionContext(rootSession, rootSummary),
  };

  return liquid.parseAndRender(templatePrompt, context);
}

/**
 * Derive session settings from template and root session.
 * Template values take precedence if set, otherwise inherit from root.
 */
function deriveSessionSettings(template, rootSession) {
  return {
    thinkingEnabled: template.thinkingEnabled !== null ? template.thinkingEnabled : rootSession.thinkingEnabled,
    gitBranch: template.gitBranch || rootSession.gitBranch,
    gitMode: template.gitMode || null,
    model: template.model !== null ? template.model : rootSession.model,
    mode: template.mode !== null ? template.mode : rootSession.mode,
    effortLevel: template.effortLevel !== null ? template.effortLevel : rootSession.effortLevel,
    // Inherit rescheduling settings from root session
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
 * Resolve the working directory for a new template-triggered session.
 * Inherits the parent worktree if available, otherwise sets up git normally.
 * @param {Object} parentSession - The parent session
 * @param {Object} project - The project
 * @param {Object} settings - Derived session settings
 * @param {string} newSessionId - The new session ID
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null}>}
 */
async function resolveWorkingDirectory(parentSession, project, settings, newSessionId) {
  if (parentSession.gitWorktree) {
    console.log(`Template trigger: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree };
  }

  const gitSetup = await setupGitForSession({
    projectDir: project.workingDirectory,
    gitMode: settings.gitMode,
    gitBranch: settings.gitBranch,
    sessionId: newSessionId,
  });
  return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree };
}

/**
 * Check if a session should trigger its next template and do so
 * Called when a session completes (status changes to completed, error, or stopped)
 * @param {string} sessionId - The session that just completed
 */
/**
 * Fetch the trigger context (session, template, project) with early-exit on missing data.
 * @param {string} sessionId
 * @returns {{ session: Object, template: Object, project: Object }|null} null if any lookup fails
 */
function fetchTriggerContext(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`Template trigger: Session ${sessionId} not found`);
    return null;
  }

  if (!session.nextTemplateId) {
    return null;
  }

  const template = sessionTemplates.getById(session.nextTemplateId);
  if (!template) {
    console.warn(`Template trigger: Template ${session.nextTemplateId} not found for session ${sessionId}`);
    return null;
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    console.warn(`Template trigger: Project ${session.projectId} not found for session ${sessionId}`);
    return null;
  }

  return { session, template, project };
}

/**
 * Build the child session creation options and post-create update fields.
 * @param {Object} template
 * @param {Object} parentSession
 * @param {Object} rootSession
 * @param {Object} settings - Derived session settings
 * @param {string} renderedPrompt
 * @returns {{ createOpts: Object, postCreateUpdate: Object }}
 */
function buildChildSessionOptions(template, parentSession, settings) {
  const createOpts = {
    mode: settings.mode,
    thinkingEnabled: settings.thinkingEnabled,
    gitBranch: settings.gitBranch,
    parentSessionId: null,
    status: 'starting',
    model: settings.model,
    effortLevel: settings.effortLevel,
  };

  const postCreateUpdate = {
    parentSessionId: parentSession.id,
    nextTemplateId: template.nextTemplateId || null,
    autoRescheduleEnabled: settings.autoRescheduleEnabled,
    rescheduleOnTokenLimit: settings.rescheduleOnTokenLimit,
    rescheduleOnServiceError: settings.rescheduleOnServiceError,
    rescheduleDelayMinutes: settings.rescheduleDelayMinutes,
    rescheduleAtTokenCount: settings.rescheduleAtTokenCount,
    maxRescheduleCount: settings.maxRescheduleCount,
    maxTotalTokens: settings.maxTotalTokens,
  };

  return { createOpts, postCreateUpdate };
}

export async function checkAndTriggerNextTemplate(sessionId) {
  const ctx = fetchTriggerContext(sessionId);
  if (!ctx) return;

  const { session, template, project } = ctx;

  console.log(`Template trigger: Triggering template "${template.name}" after session "${session.name}"`);

  try {
    const parentSummary = sessionSummaries.getBySessionId(sessionId);
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    const renderedPrompt = await renderTemplatePrompt(template.prompt, { parentSession: session, parentSummary, rootSession, rootSummary });
    const settings = deriveSessionSettings(template, rootSession);
    const newSessionName = `${template.name} (from: ${session.name})`;

    const { createOpts, postCreateUpdate } = buildChildSessionOptions(template, session, settings);

    const newSession = sessions.create(session.projectId, newSessionName, renderedPrompt, createOpts);
    sessions.update(newSession.id, postCreateUpdate);

    const { workingDirectory, gitWorktree } = await resolveWorkingDirectory(session, project, settings, newSession.id);

    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    const updatedSession = sessions.getById(newSession.id);
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: updatedSession,
    });

    runSession(newSession.id, renderedPrompt, workingDirectory, { systemPrompt: project.systemPrompt, model: settings.model }).catch((error) => {
      console.error(`Template trigger: Error running session ${newSession.id}:`, error);
      const errorSession = sessions.update(newSession.id, { status: 'error', error: error.message });
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: session.projectId,
        sessionId: newSession.id,
        session: errorSession,
      });
    });

    console.log(`Template trigger: Created and started session ${newSession.id}`);
  } catch (error) {
    console.error(`Template trigger: Failed to trigger template for session ${sessionId}:`, error);
  }
}
