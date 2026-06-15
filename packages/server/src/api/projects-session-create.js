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

    // Classify git errors for a structured user-facing message.
    // Only enhance the stored message for recognized, actionable categories
    // (credential, permission, remote unreachable, timeout); leave unknown
    // errors with their original message so existing tests and log tooling
    // continue to see the raw error text.
    let userMessage = error.message;
    let structuredError = null;
    if (!isTimeout) {
      // Check if the error looks like a git error (code or message hints)
      const looksLikeGitError =
        error.code === 'GIT_TIMEOUT' ||
        error.stderr !== undefined ||  // real git subprocess errors carry .stderr
        (error.message && error.message.includes('timed out'));
      if (looksLikeGitError) {
        structuredError = classifyGitError(error, error.message);
        // Only substitute a richer message for specific, actionable categories.
        // For git_unknown fall back to the original message so the raw detail
        // is not hidden behind a generic wrapper.
        if (structuredError.code !== 'git_unknown') {
          userMessage = structuredError.remediation
            ? `${structuredError.message} ${structuredError.remediation}`
            : structuredError.message;
        }
      }
    }

    // Guard: skip update if session was already moved out of 'starting'
    // (e.g. by a concurrent recovery sweep or previous error handler).
    const current = sessions.getById(session.id);
    if (current && current.status !== 'starting') {
      return res.status(isTimeout ? 504 : 500).json({
        error: isTimeout ? `Session startup timed out after ${startupTimeoutMs}ms` : `Git setup failed: ${error.message}`,
        ...(structuredError ? { gitError: structuredError } : {}),
      });
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

    return res.status(500).json({
      error: `Git setup failed: ${error.message}`,
      ...(structuredError ? { gitError: structuredError } : {}),
    });
  }
}
