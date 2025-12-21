import { Liquid } from 'liquidjs';
import { sessions, sessionTemplates, sessionSummaries, projects } from '../database.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';

const liquid = new Liquid();

/**
 * Render a template prompt with parent session context
 * @param {string} templatePrompt - The Liquid template string
 * @param {Object} parentSession - The parent session object
 * @param {Object|null} summary - The parent session's summary
 * @returns {Promise<string>} The rendered prompt
 */
export async function renderTemplatePrompt(templatePrompt, parentSession, summary) {
  const context = {
    parentSession: {
      id: parentSession.id,
      name: parentSession.name,
      status: parentSession.status,
      summary: summary?.fullSummary || summary?.shortSummary || 'No summary available',
      shortSummary: summary?.shortSummary || 'No summary available',
      fullSummary: summary?.fullSummary || 'No summary available',
      keyActions: summary?.keyActions || [],
      filesModified: summary?.filesModified || [],
      outcome: summary?.outcome || parentSession.status,
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
    const summary = sessionSummaries.getBySessionId(sessionId);

    // Render the template prompt with parent session context
    const renderedPrompt = await renderTemplatePrompt(template.prompt, session, summary);

    // Determine settings: use template overrides if set, otherwise inherit from parent session
    const thinkingEnabled = template.thinkingEnabled !== null ? template.thinkingEnabled : session.thinkingEnabled;
    const gitBranch = template.gitBranch || session.gitBranch;
    const gitMode = template.gitMode || null;

    // Generate a name for the new session
    const newSessionName = `${template.name} (from: ${session.name})`;

    // Create the new session
    const newSession = sessions.create(
      session.projectId,
      newSessionName,
      renderedPrompt,
      session.mode, // Inherit mode from parent
      thinkingEnabled,
      gitBranch
    );

    // Set the parent session reference and inherit the template's next template for chaining
    sessions.update(newSession.id, {
      parentSessionId: session.id,
      nextTemplateId: template.nextTemplateId || null,
    });

    // Setup git environment (branch checkout or worktree creation)
    const { workingDirectory, gitWorktree } = await setupGitForSession({
      projectDir: project.workingDirectory,
      gitMode: gitMode,
      gitBranch: gitBranch,
      sessionId: newSession.id,
    });

    // Update session with worktree path if created
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Start the new session (non-blocking)
    runSession(newSession.id, renderedPrompt, workingDirectory, project.systemPrompt).catch((error) => {
      console.error(`Template trigger: Error running session ${newSession.id}:`, error);
      sessions.update(newSession.id, { status: 'error', error: error.message });
    });

    console.log(`Template trigger: Created and started session ${newSession.id}`);
  } catch (error) {
    console.error(`Template trigger: Failed to trigger template for session ${sessionId}:`, error);
  }
}
