import { sessions, sessionTemplates, attachments } from '../database.js';
import * as slashCommandService from '../services/slashCommandService.js';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { executeHookAsync } from '../services/hookService.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Generate an initial session name from the prompt
 * This will be replaced by a better name when the summary is generated
 * @param {string} prompt - The user's initial prompt
 * @returns {string} A truncated version of the prompt (max 50 chars)
 */
export function generateInitialName(prompt) {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 50) return cleaned;
  const truncated = cleaned.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + '...';
}

/**
 * Parse a boolean-like value from a request body field.
 * Handles true, false, 'true', 'false', and undefined/null.
 * @param {*} value - The raw value from request body
 * @returns {{ explicit: boolean, provided: boolean }} parsed result
 */
export function parseBooleanField(value) {
  if (value === true || value === 'true') return { explicit: true, provided: true };
  if (value === false || value === 'false') return { explicit: false, provided: true };
  return { explicit: undefined, provided: false };
}

/**
 * Resolve a value with cascading defaults: explicit > project default > system default
 * @param {*} explicit - Explicitly provided value
 * @param {*} projectDefault - Project-level default
 * @param {*} systemDefault - System-level default
 * @returns {*} The resolved value
 */
export function resolveDefault(explicit, projectDefault, systemDefault) {
  if (explicit) return explicit;
  if (projectDefault) return projectDefault;
  return systemDefault;
}

/**
 * Resolve thinkingEnabled with special boolean handling.
 * @param {object} body - Request body
 * @param {object|null} projectDefs - Project defaults
 * @param {object} systemDefaults - System defaults
 * @returns {boolean}
 */
export function resolveThinkingEnabled(body, projectDefs, systemDefaults) {
  const thinkingParsed = parseBooleanField(body.thinkingEnabled);
  if (thinkingParsed.provided) {
    return thinkingParsed.explicit;
  }
  if (projectDefs?.thinkingEnabled !== undefined && projectDefs?.thinkingEnabled !== null) {
    return projectDefs.thinkingEnabled;
  }
  return systemDefaults.thinkingEnabled;
}

/**
 * Parse scheduling fields from request body.
 * @param {object} body - Request body
 * @returns {object} Scheduling configuration
 */
export function parseSchedulingConfig(body) {
  return {
    scheduledAt: body.scheduledAt ? parseInt(body.scheduledAt, 10) : undefined,
    autoRescheduleEnabled: body.autoRescheduleEnabled === true || body.autoRescheduleEnabled === 'true',
    rescheduleDelayMinutes: body.rescheduleDelayMinutes ? parseInt(body.rescheduleDelayMinutes, 10) : 15,
    rescheduleOnTokenLimit: body.rescheduleOnTokenLimit !== false && body.rescheduleOnTokenLimit !== 'false',
    rescheduleOnServiceError: body.rescheduleOnServiceError !== false && body.rescheduleOnServiceError !== 'false',
    maxRescheduleCount: body.maxRescheduleCount ? parseInt(body.maxRescheduleCount, 10) : null,
    maxTotalTokens: body.maxTotalTokens ? parseInt(body.maxTotalTokens, 10) : null,
    rescheduleAtTokenCount: body.rescheduleAtTokenCount ? parseInt(body.rescheduleAtTokenCount, 10) : null,
  };
}

/**
 * Resolve startImmediately with special boolean handling.
 * Default is true unless overridden by project/system defaults.
 * @param {object} body - Request body
 * @param {object|null} projectDefs - Project defaults
 * @param {object} systemDefaults - System defaults
 * @returns {boolean}
 */
export function resolveStartImmediately(body, projectDefs, systemDefaults) {
  let startImmediately = body.startImmediately !== false && body.startImmediately !== 'false';
  if (body.startImmediately === undefined || body.startImmediately === null) {
    if (projectDefs?.startImmediately !== undefined && projectDefs?.startImmediately !== null) {
      startImmediately = projectDefs.startImmediately;
    } else {
      startImmediately = systemDefaults.startImmediately;
    }
  }
  return startImmediately;
}

/**
 * Build session configuration from request body, project defaults, and system defaults.
 * @param {object} body - The request body
 * @param {object|null} projectDefs - Project-level defaults
 * @param {object} systemDefaults - System-level defaults
 * @returns {object} Session configuration
 */
export function prepareSessionConfig(body, projectDefs, systemDefaults) {
  let effortLevel = resolveDefault(body.effortLevel || null, projectDefs?.effortLevel, systemDefaults.effortLevel);
  // Normalize 'auto' to null
  if (effortLevel === 'auto') {
    effortLevel = null;
  }

  return {
    prompt: body.prompt,
    name: body.name,
    mode: resolveDefault(body.mode, projectDefs?.mode, systemDefaults.mode),
    model: resolveDefault(body.model, projectDefs?.model, systemDefaults.model || null),
    effortLevel,
    gitBranch: resolveDefault(body.gitBranch, projectDefs?.gitBranch, null),
    gitMode: resolveDefault(body.gitMode, projectDefs?.gitMode, null),
    templateId: body.templateId,
    parentSessionId: body.parentSessionId || null,
    files: [],
    thinkingEnabled: resolveThinkingEnabled(body, projectDefs, systemDefaults),
    startImmediately: resolveStartImmediately(body, projectDefs, systemDefaults),
    ...parseSchedulingConfig(body),
  };
}

/**
 * Apply template overrides to session config.
 * Mutates the config object in place.
 * @param {object} config - Session config to modify
 */
export function applyTemplateOverrides(config) {
  if (!config.templateId) return;

  const template = sessionTemplates.getById(config.templateId);
  if (!template) return;

  if (template.thinkingEnabled !== null && template.thinkingEnabled !== undefined) {
    config.thinkingEnabled = template.thinkingEnabled;
  }
  if (template.gitBranch) {
    config.gitBranch = template.gitBranch;
  }
  if (template.gitMode) {
    config.gitMode = template.gitMode;
  }
  if (template.effortLevel !== null && template.effortLevel !== undefined) {
    config.effortLevel = template.effortLevel;
    // Normalize 'auto' to null (same as prepareSessionConfig)
    if (config.effortLevel === 'auto') {
      config.effortLevel = null;
    }
  }
  config.nextTemplateId = config.templateId;
}

/**
 * Resolve the nextTemplateId from explicit body value or template-derived value.
 * @param {object} body - Request body
 * @param {string|null} derivedNextTemplateId - nextTemplateId derived from templateId
 * @returns {{ nextTemplateId: string|null, error: string|null }}
 */
export function resolveNextTemplateId(body, derivedNextTemplateId) {
  if (body.nextTemplateId === undefined) {
    return { nextTemplateId: derivedNextTemplateId, error: null };
  }

  if (body.nextTemplateId === null) {
    return { nextTemplateId: null, error: null };
  }

  const nextTemplate = sessionTemplates.getById(body.nextTemplateId);
  if (!nextTemplate) {
    return { nextTemplateId: null, error: 'nextTemplateId references a non-existent template' };
  }
  return { nextTemplateId: body.nextTemplateId, error: null };
}

/**
 * Determine the initial session status based on config.
 * @param {object} config - Session config
 * @returns {string|undefined} Initial status, or undefined for default
 */
export function determineInitialStatus(config) {
  if (config.scheduledAt && config.scheduledAt > Date.now()) return 'scheduled';
  if (!config.startImmediately) return 'waiting';
  return undefined;
}

/**
 * Build the scheduling update object from config.
 * @param {object} config - Session config
 * @param {string|undefined} initialStatus - Initial session status
 * @returns {object} Fields to update on the session for scheduling
 */
export function buildSchedulingUpdate(config, initialStatus) {
  const update = {};
  if (config.scheduledAt !== undefined) update.scheduledAt = config.scheduledAt;
  if (config.autoRescheduleEnabled !== undefined) update.autoRescheduleEnabled = config.autoRescheduleEnabled;
  if (config.rescheduleDelayMinutes !== undefined) update.rescheduleDelayMinutes = config.rescheduleDelayMinutes;
  if (config.rescheduleOnTokenLimit !== undefined) update.rescheduleOnTokenLimit = config.rescheduleOnTokenLimit;
  if (config.rescheduleOnServiceError !== undefined) update.rescheduleOnServiceError = config.rescheduleOnServiceError;
  if (config.maxRescheduleCount !== undefined) update.maxRescheduleCount = config.maxRescheduleCount;
  if (config.maxTotalTokens !== undefined) update.maxTotalTokens = config.maxTotalTokens;
  if (config.rescheduleAtTokenCount !== undefined) update.rescheduleAtTokenCount = config.rescheduleAtTokenCount;

  if (initialStatus === 'waiting' || initialStatus === 'scheduled') {
    update.pendingPrompt = config.prompt;
    update.pendingModel = config.model;
  }

  return update;
}

/**
 * Handle git setup, session start, broadcasts, and hooks after session creation.
 * @param {object} params
 * @param {object} params.session - The created session record
 * @param {object} params.config - Session config
 * @param {object} params.project - Project record
 * @param {string} params.projectId - Project ID
 * @param {Array} params.files - Uploaded files
 * @returns {Promise<{ updatedSession: object }>}
 */
export async function setupAndStartSession({ session, config, project, projectId, files }) {
  let workingDirectory;
  let gitWorktree = null;

  // If this is a child session and the parent has a worktree, inherit it
  // (mirrors templateTriggerService behavior)
  const parentSession = config.parentSessionId ? sessions.getById(config.parentSessionId) : null;
  if (parentSession?.gitWorktree) {
    workingDirectory = parentSession.gitWorktree;
    gitWorktree = parentSession.gitWorktree;
  } else {
    const gitSetup = await setupGitForSession({
      projectDir: project.workingDirectory,
      gitMode: config.gitMode || null,
      gitBranch: config.gitBranch || null,
      sessionId: session.id,
    });
    workingDirectory = gitSetup.workingDirectory;
    gitWorktree = gitSetup.gitWorktree;
  }

  if (gitWorktree) {
    sessions.update(session.id, { gitWorktree });
  }

  const sessionAttachments = attachments.createBatch(session.id, null, files, workingDirectory);

  const isScheduled = config.scheduledAt && config.scheduledAt > Date.now();
  if (config.startImmediately && !isScheduled) {
    const resolved = await slashCommandService.resolvePromptSkillOrCommand(
      workingDirectory, config.prompt, project.systemPrompt
    );
    const finalPrompt = resolved ? resolved.userMessage : config.prompt;
    const finalSystemPrompt = resolved ? resolved.systemPrompt : project.systemPrompt;

    const { runSession } = await import('../services/sessionManager.js');
    runSession(session.id, finalPrompt, workingDirectory, {
      systemPrompt: finalSystemPrompt,
      fileAttachments: sessionAttachments,
      model: config.model,
    }).catch((error) => {
      console.error('Session error:', error);
      sessions.update(session.id, { status: 'error', error: error.message });
    });
  }

  const updatedSession = sessions.getById(session.id);

  broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
    projectId,
    session: updatedSession,
  });

  if (project.onSessionCreated) {
    executeHookAsync(project.onSessionCreated, workingDirectory, {
      sessionId: session.id,
      projectId: project.id,
      sessionName: session.name,
    });
  }

  return { updatedSession };
}
