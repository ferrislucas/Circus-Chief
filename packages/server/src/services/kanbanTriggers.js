import {
  sessions,
  sessionTemplates,
  sessionSummaries,
  projects,
  kanbanLanes,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  buildLaneRescheduleUpdates, refreshPreservedChildSettings,
} from './kanbanChildSettings.js';

export { buildLaneRescheduleUpdates };
import { renderTemplatePrompt, getRootSession } from './templateTriggerService.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { abandonPausedTriggerChild } from './kanbanAbandon.js';
import * as gitService from './gitService.js';
import { resolveAgentTypeFromModel, resolveProviderMetadataFromModel } from './sessionProvider.js';
import { attachRootSession, isAutomationActive, isStructured } from './workflowSessionService.js';

export const LANE_AUTOMATION_DISABLED_CODE = 'LANE_AUTOMATION_DISABLED';

/** Thrown when a lane is disabled mid-dispatch. The outbox parks the entry. */
export function createLaneAutomationDisabledError() {
  const error = new Error('Lane automation was disabled during entry dispatch; entry will be parked');
  error.code = LANE_AUTOMATION_DISABLED_CODE;
  return error;
}

export function isLaneAutomationDisabledError(error) {
  return error?.code === LANE_AUTOMATION_DISABLED_CODE;
}

/**
 * Re-read the lane's persisted kill-switch. Throws LaneAutomationDisabledError
 * when a structured lane is currently disabled. Callers in the delivery path
 * treat this as "park the entry", never as a delivery failure.
 */
export function assertLaneAutomationActive(laneId) {
  const lane = kanbanLanes.getById(laneId);
  if (lane && isStructured(lane) && !isAutomationActive(lane)) throw createLaneAutomationDisabledError();
}

/**
 * Broadcast a prepared child and start its provider dispatch. Fence 2 runs
 * first: a disable that landed during working-directory setup prevents
 * broadcast and dispatch. The lane kill-switch is re-checked at the actual
 * provider boundary (after runSession's async model/env setup), and the
 * per-lane slot releases at dispatch initiation — not at dispatch call —
 * so later arrivals keep FIFO start order while runs proceed concurrently.
 */
async function broadcastAndStartChild({ session, project, newSession, renderedPrompt, settings, workingDirectory,
  beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated }) {
  await assertLaneEnabled?.();

  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
    projectId: session.projectId,
    session: sessions.getById(newSession.id),
  });

  if (beforeDispatch) await beforeDispatch(newSession.id);
  throwIfAborted(abortController);
  // Initiation and acknowledgement are separate: the dispatcher releases its
  // per-lane slot as soon as the provider call starts (signalled back through
  // runSession), never before async provider setup has completed.
  const dispatchPromise = startChildSession(newSession, renderedPrompt, workingDirectory, {
    systemPrompt: project.systemPrompt,
    model: settings.model,
    ...(abortController ? { abortController } : {}),
    ...(assertLaneEnabled ? { beforeProviderExecute: () => assertLaneEnabled() } : {}),
    ...(onDispatchInitiated ? { onProviderDispatchInitiated: onDispatchInitiated } : {}),
  });
  const accepted = await dispatchPromise;
  if (!accepted) return undelivered('provider dispatch was not accepted');
  return { delivered: true, rootSessionId: newSession.id };
}

function throwIfAborted(controller) {
  if (controller?.signal.aborted) throw controller.signal.reason || new Error('Lane-entry delivery was aborted');
}

/**
 * Re-check the abort signal after git setup completed. Setup may have
 * allocated a worktree for a child that will now never run: release it before
 * the abort propagates, since no session row records it yet and nothing
 * downstream could clean it up (it would leak and pin its branch against the
 * resume retry).
 */
async function assertSetupNotAborted(project, gitSetup, gitOptions) {
  try {
    throwIfAborted(gitOptions.abortController);
  } catch (abortError) {
    if (gitSetup.gitWorktree) {
      try {
        await gitService.removeWorktree(project.workingDirectory, gitSetup.gitWorktree, true);
      } catch (error) {
        console.warn(`Kanban: Failed to remove worktree after aborted setup for session ${gitOptions.sessionId}:`, error.message);
      }
    }
    throw abortError;
  }
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
 * Resolve the working directory for a lane-entry child. A redelivery reuses
 * its existing child's worktree (no fresh allocation); only a first delivery
 * allocates via determineWorkingDirectory, whose `allocatedWorktree` tracks
 * exactly what pause-abandon must release. Shared by both trigger paths so
 * allocation tracking cannot drift between template and prompt delivery.
 */
function resolveTriggerWorkingDirectory(existingChild, parentSession, project, gitOptions) {
  if (existingChild?.gitWorktree) {
    return Promise.resolve({
      workingDirectory: existingChild.gitWorktree,
      gitWorktree: existingChild.gitWorktree,
      allocatedWorktree: null,
    });
  }
  return determineWorkingDirectory(parentSession, project, gitOptions);
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
 * `allocatedWorktree` is the worktree path freshly allocated for this child
 * (null when inheriting the parent's, sharing the project directory, or when
 * no git isolation applies) so pause-abandon can release exactly what setup
 * created without touching shared state.
 * @param {Object} parentSession
 * @param {Object} project
 * @param {Object} [gitOptions]
 * @param {string} [gitOptions.gitMode]
 * @param {string} [gitOptions.gitBranch]
 * @param {string} [gitOptions.sessionId]
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null, allocatedWorktree: string|null}>}
 */
export async function determineWorkingDirectory(parentSession, project, gitOptions = {}) {
  throwIfAborted(gitOptions.abortController);
  if (parentSession.gitWorktree) {
    console.log(`Kanban: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree, allocatedWorktree: null };
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
    await assertSetupNotAborted(project, gitSetup, gitOptions);
    return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree, allocatedWorktree: gitSetup.gitWorktree };
  }

  return { workingDirectory: project.workingDirectory, gitWorktree: null, allocatedWorktree: null };
}

/**
 * Start a child session and handle errors via broadcast.
 * @param {Object} newSession
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} options
 */
export function startChildSession(newSession, prompt, workingDirectory, options = {}) {
  const { beforeProviderExecute, onProviderDispatchInitiated, ...runOptions } = options;
  return runSession(newSession.id, prompt, workingDirectory, {
    ...runOptions,
    ...(beforeProviderExecute ? { beforeProviderExecute } : {}),
    ...(onProviderDispatchInitiated ? { onProviderDispatchInitiated } : {}),
  }).then((result) =>
    // Older in-process adapters returned undefined. Keep that narrow
    // compatibility path, but never coerce arbitrary resolved values (in
    // particular `{ started: false }`) into a provider acknowledgement.
    result === undefined || result?.started === true).catch((error) => {
    // A provider-boundary park is not a dispatch failure: it must propagate
    // so the outbox parks the entry instead of failing the delivery.
    if (isLaneAutomationDisabledError(error)) throw error;
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
  const { laneRunId = null, childSessionId = null, assertLaneEnabled } = options;
  // Render prompt with workspace context
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    template.prompt,
    { rootSession, rootSummary }
  );

  // Kill-switch fence 1: a disable that landed during prompt rendering must
  // prevent child allocation entirely (FR-2, AC-5).
  await assertLaneEnabled?.();

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
  if (childSessionId) {
    // Redelivery reuses its existing child: replay the latest execution and
    // retry settings onto the same row (PR Review issue 13).
    refreshPreservedChildSettings(newSession.id, settings, lane);
  } else {
    if (laneRunId) attachRootSession(laneRunId, newSession.id);

    // Configure remaining fields not supported by create()
    sessions.update(newSession.id, {
      nextTemplateId: template.nextTemplateId || null,
      ...buildLaneRescheduleUpdates(lane),
    });
  }

  return { newSession, renderedPrompt, settings };
}

// eslint-disable-next-line max-statements, complexity -- capability, cancellation, setup, and dispatch fences form one boundary
export async function triggerOnEnterTemplate(sessionId, lane, options = {}) {
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated } = options;

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

  let createdChildId = null;
  let allocatedWorktree = null;
  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromTemplate(
      template, session, lane, { laneRunId, childSessionId, assertLaneEnabled }
    );
    if (!childSessionId) createdChildId = newSession.id;

    // Determine working directory
    const existingChild = childSessionId ? sessions.getById(childSessionId) : null;
    const { workingDirectory, gitWorktree, allocatedWorktree: freshAllocation } =
      await resolveTriggerWorkingDirectory(existingChild, session, project, {
        gitMode: settings.gitMode,
        gitBranch: settings.gitBranch,
        sessionId: newSession.id,
        model: settings.model,
        abortController,
      });
    allocatedWorktree = freshAllocation;
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    // Record dispatch intent after setup/broadcast but immediately before the
    // provider boundary. A crash after this point remains an ambiguous dispatch
    // and is not replayed automatically.
    const result = await broadcastAndStartChild({
      session, project, newSession, renderedPrompt, settings, workingDirectory,
      beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated,
    });
    if (!result?.delivered) return undelivered('provider dispatch was not accepted');

    console.log(`Kanban: Created and started on-enter session ${newSession.id}`);
    return result;
  } catch (error) {
    if (isLaneAutomationDisabledError(error)) {
      await abandonPausedTriggerChild({ laneRunId, childSessionId, createdChildId, allocatedWorktree });
      throw error;
    }
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
  const { laneRunId = null, childSessionId = null, assertLaneEnabled } = options;
  // Render prompt with workspace context
  const rootSession = getRootSession(session);
  const rootSummary = sessionSummaries.getBySessionId(rootSession.id);
  const renderedPrompt = await renderTemplatePrompt(
    lane.onEnterPrompt,
    { rootSession, rootSummary }
  );

  // Kill-switch fence 1: a disable that landed during prompt rendering must
  // prevent child allocation entirely (FR-2, AC-5).
  await assertLaneEnabled?.();

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
  if (childSessionId) {
    // Redelivery reuses its existing child: replay the latest execution and
    // retry settings onto the same row (PR Review issue 13).
    refreshPreservedChildSettings(newSession.id, settings, lane);
  } else {
    if (laneRunId) attachRootSession(laneRunId, newSession.id);

    // Configure remaining fields not supported by create()
    const sessionUpdates = buildLaneRescheduleUpdates(lane);
    sessions.update(newSession.id, sessionUpdates);
  }

  return { newSession, renderedPrompt, settings };
}

export async function triggerOnEnterPrompt(sessionId, lane, options = {}) {
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated } = options;

  const context = getSessionAndProjectForTrigger(sessionId);
  if (!context) return undelivered('workspace session or project not found');
  const { session, project } = context;
  throwIfAborted(abortController);

  console.log(`Kanban: Triggering on-enter prompt for session "${session.name}" entering lane "${lane.name}"`);

  let createdChildId = null;
  let allocatedWorktree = null;
  try {
    const { newSession, renderedPrompt, settings } = await buildChildSessionFromPrompt(
      lane, session, { laneRunId, childSessionId, assertLaneEnabled }
    );
    if (!childSessionId) createdChildId = newSession.id;

    // Determine working directory
    const existingChild = childSessionId ? sessions.getById(childSessionId) : null;
    const { workingDirectory, gitWorktree, allocatedWorktree: freshAllocation } =
      await resolveTriggerWorkingDirectory(existingChild, session, project, { abortController });
    allocatedWorktree = freshAllocation;
    if (gitWorktree) {
      sessions.update(newSession.id, { gitWorktree });
    }

    const result = await broadcastAndStartChild({
      session, project, newSession, renderedPrompt, settings, workingDirectory,
      beforeDispatch, abortController, assertLaneEnabled, onDispatchInitiated,
    });
    if (!result?.delivered) return undelivered('provider dispatch was not accepted');

    console.log(`Kanban: Created and started on-enter prompt session ${newSession.id}`);
    return result;
  } catch (error) {
    if (isLaneAutomationDisabledError(error)) {
      await abandonPausedTriggerChild({ laneRunId, childSessionId, createdChildId, allocatedWorktree });
      throw error;
    }
    console.error(`Kanban: Failed to trigger on-enter prompt for session ${sessionId}:`, error);
    return undelivered(error instanceof Error ? error.message : 'prompt delivery failed');
  }
}
