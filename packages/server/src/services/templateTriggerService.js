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

  // Only trigger if session has a next template configured
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
    // Get the parent session's summary for the template context
    const parentSummary = sessionSummaries.getBySessionId(sessionId);

    // Get the root session and its summary
    const rootSession = getRootSession(session);
    const rootSummary = sessionSummaries.getBySessionId(rootSession.id);

    // Render the template prompt with parent and root session context
    const renderedPrompt = await renderTemplatePrompt(template.prompt, { parentSession: session, parentSummary, rootSession, rootSummary });
    const settings = deriveSessionSettings(template, rootSession);

    // Generate a name for the new session
    const newSessionName = `${template.name} (from: ${session.name})`;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      newSessionName,
      renderedPrompt,
      {
        mode: settings.mode,
        thinkingEnabled: settings.thinkingEnabled,
        gitBranch: settings.gitBranch,
        parentSessionId: null, // Will be set below
        status: 'starting',
        model: settings.model,
        effortLevel: settings.effortLevel,
      }
    );

    // Set the parent session reference and inherit the template's next template for chaining
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
      autoRescheduleEnabled: settings.autoRescheduleEnabled,
      rescheduleOnTokenLimit: settings.rescheduleOnTokenLimit,
      rescheduleOnServiceError: settings.rescheduleOnServiceError,
      rescheduleDelayMinutes: settings.rescheduleDelayMinutes,
      rescheduleAtTokenCount: settings.rescheduleAtTokenCount,
      maxRescheduleCount: settings.maxRescheduleCount,
      maxTotalTokens: settings.maxTotalTokens,
    });

    // Determine working directory: inherit from parent if it has a worktree
    let workingDirectory;
    let gitWorktree = null;

    if (session.gitWorktree) {
      // Parent is in a worktree - child should run in the same worktree
      workingDirectory = session.gitWorktree;
      gitWorktree = session.gitWorktree;
      console.log(`Template trigger: Inheriting parent worktree: ${gitWorktree}`);
    } else {
      // Parent is not in a worktree - set up git environment normally
      const gitSetup = await setupGitForSession({
        projectDir: project.workingDirectory,
        gitMode: settings.gitMode,
        gitBranch: settings.gitBranch,
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
    runSession(newSession.id, renderedPrompt, workingDirectory, { systemPrompt: project.systemPrompt, model: settings.model }).catch((error) => {
      console.error(`Template trigger: Error running session ${newSession.id}:`, error);
      const errorSession = sessions.update(newSession.id, { status: 'error', error: error.message });
      // Broadcast error status to project subscribers for session list updates
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
