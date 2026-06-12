import { Router } from 'express';
import { projects, sessions, commandRuns } from '../database.js';
import { commandRunner } from '../services/commandRunner.js';
import { CreateProjectRequest, UpdateProjectRequest } from '@circuschief/shared/contracts/projects';
import projectCommandButtonsRouter from './projects-commandButtons.js';
import projectSessionDefaultsRouter from './projects-session-defaults.js';
import projectTemplatesRouter from './projects-templates.js';
import { handleUploadError, uploadMiddleware } from '../middleware/upload.js';
import { determineInitialStatus } from './projects-session-helpers.js';
import { buildRunsBySession } from './projects-helpers.js';
import { resolveAgentTypeFromModel } from '../services/sessionProvider.js';
import { access, constants } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import { getRepositoryUrl } from '../services/gitService.js';
import { validateAndPrepareSessionConfig, createSessionRow, startSessionOrFail } from './projects-session-create.js';

// Error message constants
const ERR_PROJECT_NOT_FOUND = 'Project not found';

/**
 * Validate a worktree path value.
 * Returns null if valid, or an error message string if invalid.
 * @param {string|null|undefined} worktreePath
 * @returns {Promise<string|null>}
 */
export async function validateWorktreePath(worktreePath) {
  if (worktreePath === null || worktreePath === undefined || worktreePath === '') {
    return null; // null/empty is valid (means use default)
  }

  if (!isAbsolute(worktreePath)) {
    return 'Worktree path must be an absolute path';
  }

  const parent = dirname(worktreePath);
  try {
    await access(parent, constants.W_OK);
  } catch {
    return `Parent directory does not exist or is not writable: ${parent}`;
  }

  return null; // valid
}

function prepareProjectUpdate(project, data) {
  const update = { ...data };

  if (
    update.workingDirectory !== undefined
    && update.worktreePath !== undefined
    && update.worktreePath === join(project.workingDirectory, '.worktrees')
  ) {
    update.worktreePath = join(update.workingDirectory, '.worktrees');
  }

  return update;
}

const router = Router();

// GET /api/projects - List all projects
router.get('/', (_req, res) => {
  const allProjects = projects.getAll();
  res.json(allProjects);
});

// POST /api/projects - Create project
router.post('/', async (req, res) => {
  const result = CreateProjectRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { name, workingDirectory, systemPrompt, onSessionCreated, onSessionDeleted, worktreePath, repoUrl } = result.data;

  const pathError = await validateWorktreePath(worktreePath);
  if (pathError) {
    return res.status(400).json({ error: pathError });
  }

  // Resolve repoUrl:
  // - string: use as-is (explicitly provided)
  // - null: suppress detection (explicitly sent as null)
  // - undefined: auto-detect from git remote
  let resolvedRepoUrl = repoUrl;
  if (resolvedRepoUrl === undefined) {
    try {
      resolvedRepoUrl = await getRepositoryUrl(workingDirectory);
    } catch {
      resolvedRepoUrl = null;
    }
  }

  const createOptions = {
    onSessionCreated: onSessionCreated || null,
    onSessionDeleted: onSessionDeleted || null,
    worktreePath: worktreePath || null,
    repoUrl: resolvedRepoUrl,
  };
  const project = projects.create(name, workingDirectory, systemPrompt || null, createOptions);
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
router.put('/:id', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const result = UpdateProjectRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const update = prepareProjectUpdate(project, result.data);

  if (update.worktreePath !== undefined) {
    const pathError = await validateWorktreePath(update.worktreePath);
    if (pathError) {
      return res.status(400).json({ error: pathError });
    }
  }

  const updated = projects.update(req.params.id, update);
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

// POST /api/projects/:id/sessions - Create session
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/sessions', uploadMiddleware('files', 10), handleUploadError, async (req, res) => {
  // Outer try/catch so any synchronous or asynchronous throw produces an HTTP
  // response rather than leaving the socket hanging (which manifests as
  // "socket hang up" on the client side). Without this, an unhandled rejection
  // from validation, DB repositories, or template resolution could cause the
  // intermittent flake observed in file-attachments.test.js.
  let session = null;
  try {
    const project = projects.getById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
    }

    const prepared = await validateAndPrepareSessionConfig(req.body, req.files, req.params.id, project);
    if (prepared.error) {
      return res.status(prepared.status).json({ error: prepared.error });
    }

    const { config, nextTemplateId } = prepared;
    // Derive the agent type from the resolved model (after template overrides
    // have been applied inside validateAndPrepareSessionConfig). Null/unknown
    // model IDs fall back to 'claude-code'. This is the single source of truth
    // for which adapter the session will use; sessions.create() persists it.
    config.agentType = resolveAgentTypeFromModel(config.model);
    const initialStatus = determineInitialStatus(config);
    session = createSessionRow(req.params.id, config, nextTemplateId, initialStatus);
    return await startSessionOrFail(req, res, { session, config, project });
  } catch (error) {
    console.error('Session creation error:', error);

    // If the session row was already created, mark it as errored so it isn't left dangling.
    if (session && session.id) {
      try {
        sessions.update(session.id, { status: 'error', error: error.message });
      } catch (updateError) {
        console.error('Failed to mark session as errored:', updateError);
      }
    }

    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Template routes are mounted as a sub-router
router.use('/:id/templates', projectTemplatesRouter);

// Command button routes are mounted as a sub-router
router.use('/:id/circus-commands', projectCommandButtonsRouter);

// Session defaults routes are mounted as a sub-router
router.use('/:id/session-defaults', projectSessionDefaultsRouter);

export default router;
