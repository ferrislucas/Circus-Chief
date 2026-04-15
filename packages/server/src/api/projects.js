import { Router } from 'express';
import { projects, sessions, sessionTemplates, commandButtons, projectDefaults, commandRuns } from '../database.js';
import { commandRunner } from '../services/commandRunner.js';
import { CreateProjectRequest, UpdateProjectRequest, ProjectSessionDefaultsRequest } from '@circuschief/shared/contracts/projects';
import { ProjectDefaultsRepository } from '../db/ProjectDefaultsRepository.js';
import { CreateSessionTemplateRequest } from '@circuschief/shared/contracts/templates';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@circuschief/shared/contracts/commandButtons';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { handleUploadError, uploadMiddleware } from '../middleware/upload.js';
import {
  generateInitialName,
  prepareSessionConfig,
  applyTemplateOverrides,
  resolveNextTemplateId,
  determineInitialStatus,
  buildSchedulingUpdate,
  setupAndStartSession,
} from './projects-session-helpers.js';
import { validateGitSettings, buildRunsBySession } from './projects-helpers.js';

// Error message constants
const ERR_PROJECT_NOT_FOUND = 'Project not found';

const router = Router();

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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }
  res.json(project);
});

// PUT /api/projects/:id - Update project
router.put('/:id', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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

  // Build merged index of latest command runs per session
  const runsBySession = buildRunsBySession(
    commandRuns.getLatestRunsForProject(req.params.id),
    commandRunner.getRunningByProjectId(req.params.id, (sessionId) => sessions.getById(sessionId))
  );

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

/**
 * Validate and prepare the session configuration from the request body.
 * Returns { config, nextTemplateId } on success, or { error, status } on failure.
 */
async function validateAndPrepareSessionConfig(reqBody, reqFiles, projectId, project) {
  const projectDefs = projectDefaults.getByProjectId(projectId);
  const systemDefaults = ProjectDefaultsRepository.getSystemDefaults();
  const config = prepareSessionConfig(reqBody, projectDefs, systemDefaults);
  config.files = reqFiles || [];

  if (!config.prompt) {
    return { error: 'Prompt is required', status: 400 };
  }

  // Apply template overrides and resolve nextTemplateId
  applyTemplateOverrides(config);
  const { nextTemplateId, error: nextTemplateError } = resolveNextTemplateId(reqBody, config.nextTemplateId || null);
  if (nextTemplateError) {
    return { error: nextTemplateError, status: 400 };
  }
  config.nextTemplateId = nextTemplateId;

  // Validate git settings for git repos
  const gitError = await validateGitSettings(config, project);
  if (gitError) {
    return { error: gitError, status: 400 };
  }

  return { config, nextTemplateId };
}

// POST /api/projects/:id/sessions - Create session
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/sessions', uploadMiddleware('files', 10), handleUploadError, async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const prepared = await validateAndPrepareSessionConfig(req.body, req.files, req.params.id, project);
  if (prepared.error) {
    return res.status(prepared.status).json({ error: prepared.error });
  }

  const { config, nextTemplateId } = prepared;
  const initialStatus = determineInitialStatus(config);

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

  // Apply optional post-create updates (next template + scheduling) in one pass
  const postCreateUpdate = {
    ...(nextTemplateId ? { nextTemplateId } : {}),
    ...buildSchedulingUpdate(config, initialStatus),
  };
  if (Object.keys(postCreateUpdate).length > 0) {
    sessions.update(session.id, postCreateUpdate);
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const available = sessionTemplates.getAvailableForProject(req.params.id);
  res.json(available);
});

// POST /api/projects/:id/templates - Create project template
router.post('/:id/templates', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const buttons = commandButtons.getByProjectId(req.params.id);
  res.json(buttons);
});

// POST /api/projects/:id/command-buttons - Create new command button
router.post('/:id/command-buttons', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  projectDefaults.resetToDefaults(req.params.id);
  res.json({ message: 'Session defaults reset to system defaults' });
});

export default router;
