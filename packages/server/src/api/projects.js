import { Router } from 'express';
import { projects, sessions, sessionTemplates, attachments, commandButtons, projectDefaults, commandRuns } from '../database.js';
import { commandRunner } from '../services/commandRunner.js';
import { CreateProjectRequest, UpdateProjectRequest, ProjectSessionDefaultsRequest } from '@claudetools/shared/contracts/projects';
import { ProjectDefaultsRepository } from '../db/ProjectDefaultsRepository.js';
import { CreateSessionTemplateRequest } from '@claudetools/shared/contracts/templates';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@claudetools/shared/contracts/commandButtons';
import * as slashCommandService from '../services/slashCommandService.js';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { isGitRepo } from '../services/gitService.js';
import { executeHookAsync } from '../services/hookService.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { handleUploadError, uploadMiddleware } from '../middleware/upload.js';
import { addSessionToTemplateTargetLane } from '../services/kanbanService.js';

const router = Router();

/**
 * Generate an initial session name from the prompt
 * This will be replaced by a better name when the summary is generated
 * @param {string} prompt - The user's initial prompt
 * @returns {string} A truncated version of the prompt (max 50 chars)
 */
function generateInitialName(prompt) {
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
function parseBooleanField(value) {
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
function resolveDefault(explicit, projectDefault, systemDefault) {
  if (explicit) return explicit;
  if (projectDefault) return projectDefault;
  return systemDefault;
}

/**
 * Build session configuration from request body, project defaults, and system defaults.
 * @param {object} body - The request body
 * @param {object|null} projectDefs - Project-level defaults
 * @param {object} systemDefaults - System-level defaults
 * @returns {object} Session configuration
 */
function prepareSessionConfig(body, projectDefs, systemDefaults) {
  const config = {};

  config.prompt = body.prompt;
  config.name = body.name;
  config.mode = resolveDefault(body.mode, projectDefs?.mode, systemDefaults.mode);
  config.model = resolveDefault(body.model, projectDefs?.model, systemDefaults.model || null);
  config.effortLevel = resolveDefault(body.effortLevel || null, projectDefs?.effortLevel, systemDefaults.effortLevel);
  // Normalize 'auto' to null
  if (config.effortLevel === 'auto') {
    config.effortLevel = null;
  }
  config.gitBranch = resolveDefault(body.gitBranch, projectDefs?.gitBranch, null);
  config.gitMode = resolveDefault(body.gitMode, projectDefs?.gitMode, null);
  config.templateId = body.templateId;
  config.parentSessionId = body.parentSessionId || null;
  config.files = [];

  // thinkingEnabled requires special boolean handling
  const thinkingParsed = parseBooleanField(body.thinkingEnabled);
  if (thinkingParsed.provided) {
    config.thinkingEnabled = thinkingParsed.explicit;
  } else if (projectDefs?.thinkingEnabled !== undefined && projectDefs?.thinkingEnabled !== null) {
    config.thinkingEnabled = projectDefs.thinkingEnabled;
  } else {
    config.thinkingEnabled = systemDefaults.thinkingEnabled;
  }

  // startImmediately requires special boolean handling (defaults to true)
  config.startImmediately = resolveStartImmediately(body, projectDefs, systemDefaults);

  // Scheduling fields
  config.scheduledAt = body.scheduledAt ? parseInt(body.scheduledAt, 10) : undefined;
  config.autoRescheduleEnabled = body.autoRescheduleEnabled === true || body.autoRescheduleEnabled === 'true';
  config.rescheduleDelayMinutes = body.rescheduleDelayMinutes ? parseInt(body.rescheduleDelayMinutes, 10) : 15;
  config.rescheduleOnTokenLimit = body.rescheduleOnTokenLimit !== false && body.rescheduleOnTokenLimit !== 'false';
  config.rescheduleOnServiceError = body.rescheduleOnServiceError !== false && body.rescheduleOnServiceError !== 'false';
  config.maxRescheduleCount = body.maxRescheduleCount ? parseInt(body.maxRescheduleCount, 10) : null;
  config.maxTotalTokens = body.maxTotalTokens ? parseInt(body.maxTotalTokens, 10) : null;
  config.rescheduleAtTokenCount = body.rescheduleAtTokenCount ? parseInt(body.rescheduleAtTokenCount, 10) : null;

  return config;
}

/**
 * Resolve startImmediately with special boolean handling.
 * Default is true unless overridden by project/system defaults.
 * @param {object} body - Request body
 * @param {object|null} projectDefs - Project defaults
 * @param {object} systemDefaults - System defaults
 * @returns {boolean}
 */
function resolveStartImmediately(body, projectDefs, systemDefaults) {
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
 * Apply template overrides to session config.
 * Mutates the config object in place.
 * @param {object} config - Session config to modify
 */
function applyTemplateOverrides(config) {
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
  config.nextTemplateId = config.templateId;
}

/**
 * Resolve the nextTemplateId from explicit body value or template-derived value.
 * @param {object} body - Request body
 * @param {string|null} derivedNextTemplateId - nextTemplateId derived from templateId
 * @returns {{ nextTemplateId: string|null, error: string|null }}
 */
function resolveNextTemplateId(body, derivedNextTemplateId) {
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
function determineInitialStatus(config) {
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
function buildSchedulingUpdate(config, initialStatus) {
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
async function setupAndStartSession({ session, config, project, projectId, files }) {
  const { workingDirectory, gitWorktree } = await setupGitForSession({
    projectDir: project.workingDirectory,
    gitMode: config.gitMode || null,
    gitBranch: config.gitBranch || null,
    sessionId: session.id,
  });

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

// GET /api/projects - List all projects
router.get('/', (_req, res) => {
  const allProjects = projects.getAll();
  res.json(allProjects);
});

// POST /api/projects - Create project
router.post('/', (req, res) => {
  const result = CreateProjectRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { name, workingDirectory, systemPrompt, onSessionCreated, onSessionDeleted } = result.data;
  const project = projects.create(name, workingDirectory, systemPrompt || null, {
    onSessionCreated: onSessionCreated || null,
    onSessionDeleted: onSessionDeleted || null,
  });
  res.status(201).json(project);
});

// GET /api/projects/:id - Get project
router.get('/:id', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

// PUT /api/projects/:id - Update project
router.put('/:id', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = UpdateProjectRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const updated = projects.update(req.params.id, result.data);
  res.json(updated);
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  projects.delete(req.params.id);
  res.status(204).send();
});

// GET /api/projects/:id/sessions - List project sessions
// Supports ?archived=true|false to filter by archive status
// Supports ?starred=true|false to filter by starred status
// Supports ?limit=N&offset=M for pagination (returns pagination metadata when limit is specified)
// Each session includes latestCommandRuns (merged from DB completed runs + in-memory running commands)
router.get('/:id/sessions', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Parse archived query param: undefined = all, 'true' = archived only, 'false' = non-archived only
  const { archived, starred, limit, offset } = req.query;
  let archivedFilter = null;
  if (archived === 'true') archivedFilter = true;
  else if (archived === 'false') archivedFilter = false;

  let starredFilter = null;
  if (starred === 'true') starredFilter = true;
  else if (starred === 'false') starredFilter = false;

  // Parse pagination params
  const parsedLimit = limit ? parseInt(limit, 10) : null;
  const parsedOffset = offset ? parseInt(offset, 10) : 0;

  const projectSessions = sessions.getByProjectId(req.params.id, {
    archived: archivedFilter,
    starred: starredFilter,
    limit: parsedLimit,
    offset: parsedOffset,
  });

  // Get total count for pagination (only when limit is specified)
  let total = null;
  if (parsedLimit !== null) {
    total = sessions.getCountByProjectId(req.params.id, {
      archived: archivedFilter,
      starred: starredFilter,
    });
  }

  // Get completed runs from DATABASE (latest run per button per session)
  const dbRuns = commandRuns.getLatestRunsForProject(req.params.id);

  // Get currently RUNNING commands from MEMORY
  // (These may not yet be persisted to DB or are in 'running' state)
  const runningRuns = commandRunner.getRunningByProjectId(req.params.id, (sessionId) => sessions.getById(sessionId));

  // Build index: sessionId -> { buttonId -> run }
  // Running commands take precedence over completed ones (more current state)
  const runsBySession = {};

  // First add DB runs (completed)
  for (const run of dbRuns) {
    if (!runsBySession[run.sessionId]) {
      runsBySession[run.sessionId] = {};
    }
    runsBySession[run.sessionId][run.buttonId] = {
      buttonId: run.buttonId,
      status: run.status,
      exitCode: run.exitCode,
      runId: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }

  // Then overlay running commands (takes precedence - they're more current)
  for (const run of runningRuns) {
    if (!runsBySession[run.sessionId]) {
      runsBySession[run.sessionId] = {};
    }
    runsBySession[run.sessionId][run.buttonId] = {
      buttonId: run.buttonId,
      status: 'running',
      exitCode: null,
      runId: run.runId,
      startedAt: run.startedAt,
    };
  }

  // Attach latestCommandRuns to each session as array
  const sessionsWithRuns = projectSessions.map(session => ({
    ...session,
    latestCommandRuns: Object.values(runsBySession[session.id] || {}),
  }));

  // Return response with pagination metadata when limit is specified
  if (parsedLimit !== null) {
    res.json({
      sessions: sessionsWithRuns,
      pagination: {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + projectSessions.length < total,
      },
    });
  } else {
    // Backward compatible: return array when no pagination
    res.json(sessionsWithRuns);
  }
});

// POST /api/projects/:id/sessions - Create session
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/sessions', uploadMiddleware('files', 10), handleUploadError, async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const projectDefs = projectDefaults.getByProjectId(req.params.id);
  const systemDefaults = ProjectDefaultsRepository.getSystemDefaults();
  const config = prepareSessionConfig(req.body, projectDefs, systemDefaults);
  config.files = req.files || [];

  if (!config.prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Apply template overrides and resolve nextTemplateId
  applyTemplateOverrides(config);
  const { nextTemplateId, error: nextTemplateError } = resolveNextTemplateId(req.body, config.nextTemplateId || null);
  if (nextTemplateError) {
    return res.status(400).json({ error: nextTemplateError });
  }
  config.nextTemplateId = nextTemplateId;

  const initialStatus = determineInitialStatus(config);

  // Validate git settings for git repos
  if (!config.gitMode || !config.gitBranch) {
    const isGit = await isGitRepo(project.workingDirectory);
    if (isGit) {
      return res.status(400).json({
        error: 'Git projects require both gitMode and gitBranch. Set project defaults or provide them per-session.'
      });
    }
  }

  const sessionName = config.name || generateInitialName(config.prompt);
  const session = sessions.create(req.params.id, sessionName, config.prompt, {
    mode: config.mode,
    thinkingEnabled: config.thinkingEnabled,
    gitBranch: config.gitBranch,
    parentSessionId: config.parentSessionId,
    status: initialStatus,
    model: config.model,
    effortLevel: config.effortLevel,
  });

  if (nextTemplateId) {
    sessions.update(session.id, { nextTemplateId });
  }

  const schedulingUpdate = buildSchedulingUpdate(config, initialStatus);
  if (Object.keys(schedulingUpdate).length > 0) {
    sessions.update(session.id, schedulingUpdate);
  }

  // Add session to kanban board if created from a template with a target lane
  if (config.templateId) {
    addSessionToTemplateTargetLane(session.id, config.templateId);
  }

  // Setup git environment, start session, and broadcast
  try {
    const { updatedSession } = await setupAndStartSession({
      session, config, project, projectId: req.params.id, files: config.files,
    });
    res.status(201).json(updatedSession);
  } catch (error) {
    console.error('Git setup error:', error);
    const updatedSession = sessions.update(session.id, { status: 'error', error: error.message });

    broadcastToProject(req.params.id, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: req.params.id,
      sessionId: session.id,
      session: updatedSession,
    });

    res.status(500).json({ error: `Git setup failed: ${error.message}` });
  }
});

// GET /api/projects/:id/templates - List available templates for project (project + global)
router.get('/:id/templates', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const available = sessionTemplates.getAvailableForProject(req.params.id);
  res.json(available);
});

// POST /api/projects/:id/templates - Create project template
router.post('/:id/templates', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = CreateSessionTemplateRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const template = sessionTemplates.create({
    projectId: req.params.id,
    ...result.data,
  });
  res.status(201).json(template);
});

// GET /api/projects/:id/command-buttons - List all command buttons for project
router.get('/:id/command-buttons', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const buttons = commandButtons.getByProjectId(req.params.id);
  res.json(buttons);
});

// POST /api/projects/:id/command-buttons - Create new command button
router.post('/:id/command-buttons', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = CreateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const button = commandButtons.create({
    projectId: req.params.id,
    label: result.data.label,
    command: result.data.command,
    sortOrder: result.data.sortOrder,
    showOnList: result.data.showOnList,
  });

  res.status(201).json(button);
});

// GET /api/projects/:id/command-buttons/:buttonId - Get single button
router.get('/:id/command-buttons/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }
  res.json(button);
});

// PATCH /api/projects/:id/command-buttons/:buttonId - Update button
router.patch('/:id/command-buttons/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  const result = UpdateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const updated = commandButtons.update(req.params.buttonId, result.data);
  res.json(updated);
});

// DELETE /api/projects/:id/command-buttons/:buttonId - Delete button
router.delete('/:id/command-buttons/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  commandButtons.delete(req.params.buttonId);
  res.status(204).send();
});

// GET /api/projects/:id/session-defaults - Get session defaults for project
router.get('/:id/session-defaults', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const defaults = projectDefaults.getByProjectId(req.params.id);
  if (!defaults) {
    return res.json(null);
  }

  res.json(defaults);
});

// POST /api/projects/:id/session-defaults - Update/create session defaults for project
router.post('/:id/session-defaults', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = ProjectSessionDefaultsRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const updated = projectDefaults.upsert(req.params.id, result.data);
  res.status(200).json(updated);
});

// DELETE /api/projects/:id/session-defaults - Reset session defaults for project
router.delete('/:id/session-defaults', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  projectDefaults.resetToDefaults(req.params.id);
  res.json({ message: 'Session defaults reset to system defaults' });
});

export default router;
