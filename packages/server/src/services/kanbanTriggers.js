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
 *
 * Every undelivered result carries a structured outcome for downstream
 * bookkeeping: `rejected` (definitively never started — safe to retry) or
 * `unknown` (acceptance unproven — park for reconciliation, never replay).
 * Setup failures that throw before any dispatch default to `rejected`.
 */
function undelivered(reason, outcome = 'rejected') {
  return { delivered: false, reason, outcome };
}

/**
 * Error codes proving the provider was never reached (missing executables,
 * missing credentials, spawn-level OS refusals). Adapters map their
 * pre-start failures to these stable codes; anything else is uncertainty.
 */
const DEFINITIVE_PRE_START_CODES = new Set([
  'ENOENT',
  'CODEX_CLI_NOT_FOUND',
  'GEMINI_CLI_NOT_FOUND',
  'MUSE_CLI_NOT_FOUND',
  'OPENAI_API_KEY_MISSING',
]);

/**
 * Classify a pre-acceptance execution failure as definitively rejected
 * (safe to retry under the owning token) or unknown (park for
 * reconciliation). Only positively known pre-start failures are rejected;
 * absence of evidence is never evidence of non-start.
 * @param {unknown} error
 * @returns {boolean} True when the error proves the provider never started
 */
export function isDefinitivePreStartError(error) {
  return Boolean(error && DEFINITIVE_PRE_START_CODES.has(error.code));
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
 * Start a child session and resolve once provider acceptance is known.
 *
 * Acceptance (the adapter handed execution to the provider runner) settles
 * this promise WITHOUT waiting for the potentially long turn to complete, so
 * durable delivery can be acknowledged while the child keeps running. The
 * turn's completion continues in the background under session ownership.
 *
 * @param {Object} newSession
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} options - runSession options plus `onAccepted` (fired with
 *   the acceptance detail, synchronously after the promise settles).
 * @returns {Promise<{accepted:boolean,reason:string|null,outcome:string}>}
 *   `accepted` is true only on a positively observed provider-acceptance
 *   signal for this dispatch. A `{ started: true }` completion alone proves
 *   nothing — reschedules, user stops, and error-result streams all
 *   synthesize it without provider handoff — so it resolves unaccepted with
 *   outcome `unknown`. `{ started: false }` is a definitive pre-start
 *   rejection (`rejected`); any other resolution (notably `undefined` from
 *   legacy wrappers) is `unknown`. Thrown errors are `rejected` only for
 *   positively known pre-start failures (see {@link isDefinitivePreStartError}),
 *   otherwise `unknown`. `reason` carries the original cause for diagnostics
 *   (never a generic placeholder). Post-acceptance turn failures still
 *   resolve accepted: they are logged, never reported as delivery failures,
 *   and never overwrite the execution layer's own outcome bookkeeping.
 */
export function startChildSession(newSession, prompt, workingDirectory, options) {
  const { onAccepted, ...runOptions } = options ?? {};
  return new Promise((resolve) => {
    let settled = false;
    const settle = (accepted, reason = null, outcome = null) => {
      if (!settled) {
        settled = true;
        resolve({ accepted, reason, outcome: outcome ?? (accepted ? 'accepted' : 'unknown') });
      }
    };
    const failBeforeAcceptance = (error) => {
      console.error(`Kanban: Error running on-enter session ${newSession.id}:`, error);
      const errorSession = sessions.update(newSession.id, { status: 'error', error: error.message });
      broadcastToProject(newSession.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: newSession.projectId,
        sessionId: newSession.id,
        session: errorSession,
      });
      settle(false, error?.message || 'child session execution failed',
        isDefinitivePreStartError(error) ? 'rejected' : 'unknown');
    };
    let completion;
    try {
      completion = runSession(newSession.id, prompt, workingDirectory, {
        ...runOptions,
        onProviderAccepted: (detail) => {
          settle(true, null, 'accepted');
          try {
            onAccepted?.(detail);
          } catch (error) {
            console.error(`Kanban: onAccepted hook failed for session ${newSession.id}:`, error?.message || error);
          }
        },
      });
    } catch (error) {
      failBeforeAcceptance(error);
      return;
    }
    Promise.resolve(completion).then(
      (result) => {
        if (settled) {
          // A prior acceptance signal wins over this late completion.
          return;
        }
        if (result?.started === false) {
          // Definitive pre-start rejection: the execution fence refused
          // before any provider call. Safe to retry under the owner.
          settle(false, result?.reason || 'provider dispatch was rejected before start', 'rejected');
          return;
        }
        // `{ started: true }` without an acceptance signal, or an unknown
        // legacy resolution (`undefined`): the provider never demonstrably
        // accepted this turn. Park for reconciliation — never replay.
        settle(false, result?.reason || 'turn finished without provider acceptance', 'unknown');
      },
      (error) => {
        if (settled) {
          // The turn was already accepted and delivered; its failure belongs
          // to session execution (which already recorded it). Log without
          // overwriting that outcome.
          console.error(`Kanban: Accepted on-enter session ${newSession.id} failed after delivery:`, error?.message || error);
          return;
        }
        failBeforeAcceptance(error);
      },
    );
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
 * Build the reschedule policy update for a lane-entry child session.
 * Returns an empty object when the lane does not enable auto-reschedule,
 * leaving the child's default scheduling untouched.
 * @param {Object} lane
 * @returns {Object}
 */
export function buildLaneRescheduleUpdates(lane) {
  if (!lane.onEnterAutoRescheduleEnabled) return {};
  return {
    autoRescheduleEnabled: true,
    rescheduleDelayMinutes: lane.onEnterRescheduleDelayMinutes || DEFAULT_RESCHEDULE_DELAY_MINUTES,
    rescheduleOnTokenLimit: lane.onEnterRescheduleOnTokenLimit ?? true,
    rescheduleOnServiceError: lane.onEnterRescheduleOnServiceError ?? true,
    maxRescheduleCount: lane.onEnterMaxRescheduleCount || null,
    maxTotalTokens: lane.onEnterMaxTotalTokens || null,
    rescheduleAtTokenCount: lane.onEnterRescheduleAtTokenCount || null,
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
    ...buildLaneRescheduleUpdates(lane),
  });

  return { newSession, renderedPrompt, settings };
}

/**
 * Dispatch an attached lane-entry child after setup/broadcast, resolving
 * once provider acceptance is known. Shared by the template and prompt
 * triggers so both carry the same acceptance/outcome contract.
 */
async function dispatchLaneEntryChild(newSession, renderedPrompt, workingDirectory,
  { systemPrompt, model, beforeDispatch, abortController, onAccepted, logLabel }) {
  // Record dispatch intent after setup/broadcast but immediately before the
  // provider boundary. A crash after this point remains an ambiguous dispatch
  // and is not replayed automatically.
  if (beforeDispatch) await beforeDispatch(newSession.id);
  throwIfAborted(abortController);
  const accepted = await startChildSession(newSession, renderedPrompt, workingDirectory, {
    systemPrompt,
    model,
    ...(abortController ? { abortController } : {}),
    ...(onAccepted ? { onAccepted } : {}),
  });
  if (!accepted.accepted) {
    return undelivered(accepted.reason || 'provider dispatch was not accepted', accepted.outcome || 'unknown');
  }

  console.log(`Kanban: Created and started ${logLabel} session ${newSession.id}`);
  return { delivered: true, rootSessionId: newSession.id };
}

// eslint-disable-next-line max-statements, complexity -- capability, cancellation, setup, and dispatch fences form one boundary
export async function triggerOnEnterTemplate(sessionId, lane, options = {}) {
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController, onAccepted } = options;

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

    return dispatchLaneEntryChild(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
      beforeDispatch,
      abortController,
      onAccepted,
      logLabel: 'on-enter',
    });
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
  const sessionUpdates = buildLaneRescheduleUpdates(lane);
  sessions.update(newSession.id, sessionUpdates);

  return { newSession, renderedPrompt, settings };
}

export async function triggerOnEnterPrompt(sessionId, lane, options = {}) {
  const { laneRunId = null, childSessionId = null, beforeDispatch, abortController, onAccepted } = options;

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

    return dispatchLaneEntryChild(newSession, renderedPrompt, workingDirectory, {
      systemPrompt: project.systemPrompt,
      model: settings.model,
      beforeDispatch,
      abortController,
      onAccepted,
      logLabel: 'on-enter prompt',
    });
  } catch (error) {
    console.error(`Kanban: Failed to trigger on-enter prompt for session ${sessionId}:`, error);
    return undelivered(error instanceof Error ? error.message : 'prompt delivery failed');
  }
}
