import { sessions, projectDefaults } from '../database.js';
import { ProjectDefaultsRepository } from '../db/ProjectDefaultsRepository.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  generateInitialName,
  prepareSessionConfig,
  applyTemplateOverrides,
  resolveNextTemplateId,
  buildSchedulingUpdate,
  setupAndStartSession,
} from './projects-session-helpers.js';
import { validateGitSettings } from './projects-helpers.js';
import { validateModelId } from './model-validation.js';
import { withTimeout, TimeoutError } from '../services/promiseUtils.js';
import { classifyGitError } from '../services/gitService.js';

/**
 * Run post-preparation validation on session config (parent session,
 * template resolution, and git settings).
 * Returns { nextTemplateId } on success, or { error, status } on failure.
 */
async function validatePreparedConfig(config, reqBody, projectId, project) {
  if (config.parentSessionId) {
    const parentSession = sessions.getById(config.parentSessionId);
    if (!parentSession) {
      return { error: 'Parent session not found', status: 404 };
    }
    if (parentSession.projectId !== projectId) {
      return { error: 'Parent session does not belong to this project', status: 400 };
    }
  }

  // Apply template overrides and resolve nextTemplateId
  applyTemplateOverrides(config);
  const { nextTemplateId, error: nextTemplateError } = resolveNextTemplateId(reqBody, config.nextTemplateId || null);
  if (nextTemplateError) {
    return { error: nextTemplateError, status: 400 };
  }

  const finalModelResult = validateModelId(config.model);
  if (finalModelResult.error) {
    return { error: finalModelResult.error, status: 400 };
  }

  // Validate git settings for git repos
  const { config: updatedConfig, error: gitError } = await validateGitSettings(config, project);
  if (gitError) {
    return { error: gitError, status: 400 };
  }
  Object.assign(config, updatedConfig);

  return { nextTemplateId };
}

/**
 * Validate and prepare the session configuration from the request body.
 * Returns { config, nextTemplateId } on success, or { error, status } on failure.
 */
export async function validateAndPrepareSessionConfig(reqBody, reqFiles, projectId, project) {
  // Validate the explicitly requested model only — never the resolved default —
  // so project/system defaults are never blocked.
  if (Object.hasOwn(reqBody, 'model') && reqBody.model !== '') {
    const modelResult = validateModelId(reqBody.model);
    if (modelResult.error) {
      return { error: modelResult.error, status: 400 };
    }
  }

  const projectDefs = projectDefaults.getByProjectId(projectId);
  const systemDefaults = ProjectDefaultsRepository.getSystemDefaults();
  const config = prepareSessionConfig(reqBody, projectDefs, systemDefaults);
  config.files = reqFiles || [];

  if (!config.prompt) {
    return { error: 'Prompt is required', status: 400 };
  }

  if (config.schedulingError) {
    return { error: config.schedulingError, status: 400 };
  }

  const result = await validatePreparedConfig(config, reqBody, projectId, project);
  if (result.error) {
    return { error: result.error, status: result.status };
  }

  config.nextTemplateId = result.nextTemplateId;
  return { config, nextTemplateId: result.nextTemplateId };
}

/**
 * Create the session row and apply any post-create updates.
 * Returns the created session (already persisted in DB).
 */
export function createSessionRow(projectId, config, nextTemplateId, initialStatus) {
  const sessionName = config.name || generateInitialName(config.prompt);
  const session = sessions.create(projectId, sessionName, config.prompt, {
    mode: config.mode,
    thinkingEnabled: config.thinkingEnabled,
    gitBranch: config.gitBranch,
    parentSessionId: config.parentSessionId,
    status: initialStatus,
    model: config.model,
    providerId: config.providerId,
    effortLevel: config.effortLevel,
    agentType: config.agentType,
  });

  const postCreateUpdate = {
    ...(nextTemplateId ? { nextTemplateId } : {}),
    ...buildSchedulingUpdate(config, initialStatus),
  };
  if (Object.keys(postCreateUpdate).length > 0) {
    sessions.update(session.id, postCreateUpdate);
  }
  return session;
}

/**
 * Build the user-facing message and structured git error (if any) for a
 * session-startup failure. Timeouts get a plain message; other errors are
 * classified via classifyGitError so actionable categories (credential,
 * permission, remote unreachable) get a richer message. Unknown git errors keep
 * their original message so raw detail is not hidden behind a generic wrapper.
 * @returns {{ userMessage: string, structuredError: object|null }}
 */
function enrichStartupError(error, isTimeout) {
  if (isTimeout) {
    return { userMessage: error.message, structuredError: null };
  }
  // Real git subprocess errors carry .stderr; GIT_TIMEOUT carries .code.
  const looksLikeGitError =
    error.code === 'GIT_TIMEOUT' ||
    error.stderr !== undefined ||
    (error.message && error.message.includes('timed out'));
  if (!looksLikeGitError) {
    return { userMessage: error.message, structuredError: null };
  }
  const structuredError = classifyGitError(error, error.message);
  if (structuredError.code === 'git_unknown') {
    return { userMessage: error.message, structuredError };
  }
  const userMessage = structuredError.remediation
    ? `${structuredError.message} ${structuredError.remediation}`
    : structuredError.message;
  return { userMessage, structuredError };
}

/** JSON body for a startup-failure response (includes gitError when known). */
function buildStartupErrorBody(error, isTimeout, startupTimeoutMs, structuredError) {
  return {
    error: isTimeout
      ? `Session startup timed out after ${startupTimeoutMs}ms`
      : `Git setup failed: ${error.message}`,
    ...(structuredError ? { gitError: structuredError } : {}),
  };
}

/**
 * Translate a session-startup failure into the error response. If the session is
 * still 'starting', mark it errored and broadcast SESSION_UPDATED; either way,
 * send the appropriate response (504 on timeout, 500 otherwise). Returns the
 * Express response (already sent).
 */
function handleStartupFailure(res, error, {
  session, resolvedProjectId, isTimeout, startupTimeoutMs, userMessage, structuredError,
}) {
  // Guard: skip the update if the session already moved out of 'starting'
  // (e.g. via a concurrent recovery sweep or a previous error handler).
  const current = sessions.getById(session.id);
  if (current && current.status !== 'starting') {
    return res.status(isTimeout ? 504 : 500).json(
      buildStartupErrorBody(error, isTimeout, startupTimeoutMs, structuredError)
    );
  }

  const updatedSession = sessions.update(session.id, {
    status: 'error',
    error: isTimeout
      ? `Session startup timed out after ${startupTimeoutMs}ms`
      : userMessage,
  });
  broadcastToProject(resolvedProjectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: resolvedProjectId,
    sessionId: session.id,
    session: updatedSession,
    ...(structuredError ? { gitError: structuredError } : {}),
  });

  if (isTimeout) {
    return res.status(504).json({
      error: `Session startup timed out after ${startupTimeoutMs}ms`,
    });
  }

  return res.status(500).json(
    buildStartupErrorBody(error, isTimeout, startupTimeoutMs, structuredError)
  );
}

/**
 * Run setupAndStartSession and translate any failure into an error response,
 * marking the session as errored and broadcasting the update.
 *
 * Wraps setup in a startup timeout (SESSION_STARTUP_TIMEOUT_MS, default 60 s)
 * and returns 504 on timeout vs 500 on other failures.
 *
 * @param {object} req - Express request (used for res only; projectId must be explicit)
 * @param {object} res - Express response
 * @param {object} params
 * @param {object} params.session - Created session row
 * @param {object} params.config - Session config
 * @param {object} params.project - Project record
 * @param {string} params.projectId - Explicit project ID (do NOT read from req.params)
 */
export async function startSessionOrFail(req, res, { session, config, project, projectId }) {
  // Fall back to req.params.id for backward-compat callers that haven't yet
  // been updated to pass projectId explicitly.
  const resolvedProjectId = projectId ?? req.params.id;

  const startupTimeoutMs =
    Number(process.env.SESSION_STARTUP_TIMEOUT_MS) || 60_000;

  // Keep a reference to the underlying promise so we can attach a no-op .catch()
  // after withTimeout rejects — this prevents an unhandled rejection if the orphaned
  // promise settles later with an error.
  const setupPromise = setupAndStartSession({
    session, config, project, projectId: resolvedProjectId, files: config.files,
  });

  try {
    const { updatedSession } = await withTimeout(
      setupPromise,
      startupTimeoutMs,
      `Session startup timed out during git/setup phase after ${startupTimeoutMs}ms`
    );
    return res.status(201).json(updatedSession);
  } catch (error) {
    // Prevent unhandled rejection from orphaned promise after a timeout
    setupPromise.catch(() => {});

    const isTimeout = error instanceof TimeoutError;
    console.error(isTimeout ? 'Session startup timeout:' : 'Session startup error:', error);

    const { userMessage, structuredError } = enrichStartupError(error, isTimeout);
    return handleStartupFailure(res, error, {
      session, resolvedProjectId, isTimeout, startupTimeoutMs, userMessage, structuredError,
    });
  }
}
