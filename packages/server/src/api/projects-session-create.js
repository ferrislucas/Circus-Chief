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
 */
export async function startSessionOrFail(req, res, { session, config, project }) {
  try {
    const { updatedSession } = await setupAndStartSession({
      session, config, project, projectId: req.params.id, files: config.files,
    });
    return res.status(201).json(updatedSession);
  } catch (error) {
    console.error('Git setup error:', error);
    const updatedSession = sessions.update(session.id, { status: 'error', error: error.message });
    broadcastToProject(req.params.id, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: req.params.id,
      sessionId: session.id,
      session: updatedSession,
    });
    return res.status(500).json({ error: `Git setup failed: ${error.message}` });
  }
}
