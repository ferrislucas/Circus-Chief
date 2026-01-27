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
 * @param {Object} parentSession - The parent session object
 * @param {Object|null} parentSummary - The parent session's summary
 * @param {Object} rootSession - The root session object
 * @param {Object|null} rootSummary - The root session's summary
 * @returns {Promise<string>} The rendered prompt
 */
export async function renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary) {
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
    const renderedPrompt = await renderTemplatePrompt(template.prompt, session, parentSummary, rootSession, rootSummary);

    // Determine settings: use template overrides if set, otherwise inherit from parent session
    const thinkingEnabled = template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled;
    const gitBranch = template.gitBranch || session.gitBranch;
    const gitMode = template.gitMode || null;
    const model = template.model || session.model;
    const mode = template.mode || session.mode;

    // Generate a name for the new session
    const newSessionName = `${template.name} (from: ${session.name})`;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      newSessionName,
      renderedPrompt,
      mode, // Use mode from template or parent
      thinkingEnabled,
      gitBranch
    );

    // Set the parent session reference and inherit the template's next template for chaining
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
      model, // Set model from template
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
    runSession(newSession.id, renderedPrompt, workingDirectory, project.systemPrompt, [], template.model).catch((error) => {
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
