import {
  sessions,
  sessionTemplates,
  sessionSummaries,
  projects,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_RESCHEDULE_DELAY_MINUTES } from '@circuschief/shared';
import { renderTemplatePrompt, getRootSession } from './templateTriggerService.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { resolveAgentTypeFromModel, resolveProviderMetadataFromModel } from './sessionProvider.js';
import { attachRootSession } from './workflowSessionService.js';

function throwIfAborted(controller) {
  if (controller?.signal.aborted) throw controller.signal.reason || new Error('Lane-entry delivery was aborted');
}

/**
 * A lane-entry delivery must be observable by its caller.  In particular,
 * recovery must never confuse a missing configuration or a failed setup with
 * a successfully delivered outbox event.
 */
function undelivered(reason) {
  return { delivered: false, reason };
}

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
  throwIfAborted(gitOptions.abortController);
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
      commitAttributionOverride:
        resolveProviderMetadataFromModel(gitOptions.model)?.commitAttributionOverride ?? null,
    });
    throwIfAborted(gitOptions.abortController);
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
  return runSession(newSession.id, prompt, workingDirectory, options).then((result) =>
    // Older in-process adapters returned undefined. Keep that narrow
    // compatibility path, but never coerce arbitrary resolved values (in
    // particular `{ started: false }`) into a provider acknowledgement.
    result === undefined || result?.started === true).catch((error) => {
    console.error(`Kanban: Error running on-enter session ${newSession.id}:`, error);
    const errorSession = sessions.update(newSession.id, { status: 'error', error: error.message });
    broadcastToProject(newSession.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: newSession.projectId,
      sessionId: newSession.id,
      session: errorSession,
    });
    return false;
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
 * Create and configure a child session from a template for lane entry.
 * @param {Object} template
 * @param {Object} session - Parent session
 * @param {Object} lane
 * @param {Object} [options] - Options
 * @returns {{ newSession: Object, renderedPrompt: string, settings: Object }}
 */
async function buildChildSessionFromTemplate(template, session, lane, options = {}) {
  const { laneRunId = null, childSessionId = null } = options;
  // Render prompt with workspace context
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    template.prompt,
    { rootSession, rootSummary }
  );

  // Get settings and create session with its direct parent set atomically at
  // creation time — avoids a window where the new row briefly has no parent.
  const settings = getTemplateSessionSettings(template, session);
  const newSession = childSessionId ? sessions.getById(childSessionId) : sessions.create(session.projectId, `${template.name} (lane: ${lane.name})`, renderedPrompt, {
    mode: settings.mode,
    thinkingEnabled: settings.thinkingEnabled,
    gitBranch: settings.gitBranch,
    status: 'starting',
    model: settings.model,
    agentType: resolveAgentTypeFromModel(settings.model),
    parentSessionId: session.id,
  });
  if (!newSession) throw new Error('attached lane-entry child session is missing');
  if (laneRunId && !childSessionId) attachRootSession(laneRunId, newSession.id);

  // Configure remaining fields not supported by create()
  sessions.update(newSession.id, {
    nextTemplateId: template.nextTemplateId || null,
  });

  return { newSession, renderedPrompt, settings };
}

// eslint-disable-next-line max-statements, complexity -- capability, cancellation, setup, and dispatch fences form one boundary
export async function triggerOnEnterTemplate(sessionId, lane, options = {}) {
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController } = options;

  const template = sessionTemplates.getById(lane.onEnterTemplateId);
  if (!template) {
    console.warn(`Kanban: On-enter template ${lane.onEnterTemplateId} not found for lane ${lane.id}`);
    return undelivered('on-enter template not found');
  }

  const context = getSessionAndProjectForTrigger(sessionId);
  if (!context) return undelivered('workspace session or project not found');
  const { session, project } = context;
  throwIfAborted(abortController);

  console.log(`Kanban: Triggering on-enter template "${template.name}" for session "${session.name}" entering lane "${lane.name}"`);

  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromTemplate(
      template, session, lane, { laneRunId, childSessionId }
    );

    // Determine working directory
    const existingChild = childSessionId ? sessions.getById(childSessionId) : null;
    const { workingDirectory, gitWorktree } = existingChild?.gitWorktree
      ? { workingDirectory: existingChild.gitWorktree, gitWorktree: existingChild.gitWorktree }
      : await determineWorkingDirectory(session, project, {
      gitMode: settings.gitMode,
      gitBranch: settings.gitBranch,
      sessionId: newSession.id,
      model: settings.model,
      abortController,
      });
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Broadcast and start
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: sessions.getById(newSession.id),
    });

    // Record dispatch intent after setup/broadcast but immediately before the
    // provider boundary. A crash after this point remains an ambiguous dispatch
    // and is not replayed automatically.
    if (beforeDispatch) await beforeDispatch(newSession.id);
    throwIfAborted(abortController);
    const accepted = await startChildSession(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
      ...(abortController ? { abortController } : {}),
    });
    if (!accepted) return undelivered('provider dispatch was not accepted');

    console.log(`Kanban: Created and started on-enter session ${newSession.id}`);
    return { delivered: true, rootSessionId: newSession.id };
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter template for session ${sessionId}:`, error);
    return undelivered(error instanceof Error ? error.message : 'template delivery failed');
  }
}

/**
 * Create and configure a child session from a lane's on-enter prompt.
 * @param {Object} lane
 * @param {Object} session - Parent session
 * @returns {Promise<{ newSession: Object, renderedPrompt: string, settings: Object }>}
 */
async function buildChildSessionFromPrompt(lane, session, options = {}) {
  const { laneRunId = null, childSessionId = null } = options;
  // Render prompt with workspace context
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    lane.onEnterPrompt,
    { rootSession, rootSummary }
  );

  // Get settings and create session with its direct parent set atomically at
  // creation time — avoids a window where the new row briefly has no parent.
  const settings = getLaneSessionSettings(lane, session);
  const newSession = childSessionId ? sessions.getById(childSessionId) : sessions.create(session.projectId, `Lane prompt (lane: ${lane.name})`, renderedPrompt, {
    ...settings,
    status: 'starting',
    agentType: resolveAgentTypeFromModel(settings.model),
    parentSessionId: session.id,
  });
  if (!newSession) throw new Error('attached lane-entry child session is missing');
  if (laneRunId && !childSessionId) attachRootSession(laneRunId, newSession.id);

  // Configure remaining fields not supported by create()
  const sessionUpdates = {};
  if (lane.onEnterAutoRescheduleEnabled) {
    Object.assign(sessionUpdates, {
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: lane.onEnterRescheduleDelayMinutes || DEFAULT_RESCHEDULE_DELAY_MINUTES,
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
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController } = options;

  const context = getSessionAndProjectForTrigger(sessionId);
  if (!context) return undelivered('workspace session or project not found');
  const { session, project } = context;
  throwIfAborted(abortController);

  console.log(`Kanban: Triggering on-enter prompt for session "${session.name}" entering lane "${lane.name}"`);

  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromPrompt(
      lane, session, { laneRunId, childSessionId }
    );

    // Determine working directory
    const existingChild = childSessionId ? sessions.getById(childSessionId) : null;
    const { workingDirectory, gitWorktree } = existingChild?.gitWorktree
      ? { workingDirectory: existingChild.gitWorktree, gitWorktree: existingChild.gitWorktree }
      : await determineWorkingDirectory(session, project, { abortController });
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Broadcast and start
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: sessions.getById(newSession.id),
    });

    if (beforeDispatch) await beforeDispatch(newSession.id);
    throwIfAborted(abortController);
    const accepted = await startChildSession(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
      ...(abortController ? { abortController } : {}),
    });
    if (!accepted) return undelivered('provider dispatch was not accepted');

    console.log(`Kanban: Created and started on-enter prompt session ${newSession.id}`);
    return { delivered: true, rootSessionId: newSession.id };
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter prompt for session ${sessionId}:`, error);
    return undelivered(error instanceof Error ? error.message : 'prompt delivery failed');
  }
}
