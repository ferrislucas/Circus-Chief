import { Router } from 'express';
import { projects, sessions, sessionTemplates, attachments, commandButtons, projectDefaults, commandRuns } from '../database.js';
import { commandRunner } from '../services/commandRunner.js';
import { CreateProjectRequest, UpdateProjectRequest, ProjectSessionDefaultsRequest } from '@claudetools/shared/contracts/projects';
import { ProjectDefaultsRepository } from '../db/ProjectDefaultsRepository.js';
import { CreateSessionTemplateRequest } from '@claudetools/shared/contracts/templates';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@claudetools/shared/contracts/commandButtons';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { executeHookAsync } from '../services/hookService.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { upload, handleUploadError } from '../middleware/upload.js';

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

  // Validate summaryDebounceMs if provided
  if (result.data.summaryDebounceMs !== undefined) {
    if (!Number.isInteger(result.data.summaryDebounceMs) || result.data.summaryDebounceMs < 100) {
      return res.status(400).json({
        error: 'summaryDebounceMs must be an integer >= 100 (milliseconds)'
      });
    }
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
router.post('/:id/sessions', upload.array('files', 10), handleUploadError, async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Get project defaults and system defaults
  const projectDefs = projectDefaults.getByProjectId(req.params.id);
  const systemDefaults = ProjectDefaultsRepository.getSystemDefaults();

  // Handle both JSON and form-data - parse booleans from form-data strings
  const prompt = req.body.prompt;
  const name = req.body.name;

  // Apply defaults priority: explicit param > project default > system default
  let mode = req.body.mode;
  if (!mode && projectDefs?.mode) mode = projectDefs.mode;
  if (!mode) mode = systemDefaults.mode;

  let thinkingEnabled = req.body.thinkingEnabled === true || req.body.thinkingEnabled === 'true';
  if (!thinkingEnabled && req.body.thinkingEnabled !== false && req.body.thinkingEnabled !== 'false') {
    // No explicit value provided, use defaults
    if (projectDefs?.thinkingEnabled !== undefined && projectDefs?.thinkingEnabled !== null) {
      thinkingEnabled = projectDefs.thinkingEnabled;
    } else {
      thinkingEnabled = systemDefaults.thinkingEnabled;
    }
  }

  let gitBranch = req.body.gitBranch;
  if (!gitBranch && projectDefs?.gitBranch) gitBranch = projectDefs.gitBranch;

  let gitMode = req.body.gitMode;
  if (!gitMode && projectDefs?.gitMode) gitMode = projectDefs.gitMode;

  const templateId = req.body.templateId;
  const parentSessionId = req.body.parentSessionId || null; // Optional: parent session ID for child sessions

  let startImmediately = req.body.startImmediately !== false && req.body.startImmediately !== 'false';
  if (req.body.startImmediately === undefined || req.body.startImmediately === null) {
    // No explicit value provided, use defaults
    if (projectDefs?.startImmediately !== undefined && projectDefs?.startImmediately !== null) {
      startImmediately = projectDefs.startImmediately;
    } else {
      startImmediately = systemDefaults.startImmediately;
    }
  }

  const files = req.files || [];

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Apply template settings if templateId is provided
  let nextTemplateId = null;
  if (templateId) {
    const template = sessionTemplates.getById(templateId);
    if (template) {
      // Template settings override project defaults if set (not null/undefined)
      if (template.thinkingEnabled !== null && template.thinkingEnabled !== undefined) {
        thinkingEnabled = template.thinkingEnabled;
      }
      if (template.gitBranch) {
        gitBranch = template.gitBranch;
      }
      if (template.gitMode) {
        gitMode = template.gitMode;
      }
      // Set nextTemplateId so template triggers after Claude finishes
      nextTemplateId = templateId;
    }
  }

  // Extract scheduling fields from request
  const scheduledAt = req.body.scheduledAt ? parseInt(req.body.scheduledAt, 10) : undefined;
  const autoRescheduleEnabled = req.body.autoRescheduleEnabled === true || req.body.autoRescheduleEnabled === 'true';
  const rescheduleDelayMinutes = req.body.rescheduleDelayMinutes ? parseInt(req.body.rescheduleDelayMinutes, 10) : 15;
  const rescheduleOnTokenLimit = req.body.rescheduleOnTokenLimit !== false && req.body.rescheduleOnTokenLimit !== 'false';
  const rescheduleOnServiceError = req.body.rescheduleOnServiceError !== false && req.body.rescheduleOnServiceError !== 'false';
  const maxRescheduleCount = req.body.maxRescheduleCount ? parseInt(req.body.maxRescheduleCount, 10) : null;
  const maxTotalTokens = req.body.maxTotalTokens ? parseInt(req.body.maxTotalTokens, 10) : null;
  const rescheduleAtTokenCount = req.body.rescheduleAtTokenCount ? parseInt(req.body.rescheduleAtTokenCount, 10) : null;

  const sessionName = name || generateInitialName(prompt);
  // Determine initial status: scheduled > waiting > starting
  let initialStatus;
  if (scheduledAt && scheduledAt > Date.now()) {
    initialStatus = 'scheduled';
  } else if (!startImmediately) {
    initialStatus = 'waiting';
  }
  const session = sessions.create(req.params.id, sessionName, prompt, mode, thinkingEnabled, gitBranch, parentSessionId, initialStatus);

  // Set nextTemplateId if template was selected
  if (nextTemplateId) {
    sessions.update(session.id, { nextTemplateId });
  }

  // Set scheduling fields if provided
  const schedulingUpdate = {};
  if (scheduledAt !== undefined) schedulingUpdate.scheduledAt = scheduledAt;
  if (autoRescheduleEnabled !== undefined) schedulingUpdate.autoRescheduleEnabled = autoRescheduleEnabled;
  if (rescheduleDelayMinutes !== undefined) schedulingUpdate.rescheduleDelayMinutes = rescheduleDelayMinutes;
  if (rescheduleOnTokenLimit !== undefined) schedulingUpdate.rescheduleOnTokenLimit = rescheduleOnTokenLimit;
  if (rescheduleOnServiceError !== undefined) schedulingUpdate.rescheduleOnServiceError = rescheduleOnServiceError;
  if (maxRescheduleCount !== undefined) schedulingUpdate.maxRescheduleCount = maxRescheduleCount;
  if (maxTotalTokens !== undefined) schedulingUpdate.maxTotalTokens = maxTotalTokens;
  if (rescheduleAtTokenCount !== undefined) schedulingUpdate.rescheduleAtTokenCount = rescheduleAtTokenCount;

  // For draft/waiting/scheduled sessions, set pendingPrompt so they can be edited before starting
  if (initialStatus === 'waiting' || initialStatus === 'scheduled') {
    schedulingUpdate.pendingPrompt = prompt;
  }

  if (Object.keys(schedulingUpdate).length > 0) {
    sessions.update(session.id, schedulingUpdate);
  }

  // Setup git environment (branch checkout or worktree creation)
  try {
    const { workingDirectory, gitWorktree } = await setupGitForSession({
      projectDir: project.workingDirectory,
      gitMode: gitMode || null,
      gitBranch: gitBranch || null,
      sessionId: session.id,
    });

    // Update session with worktree path if created
    if (gitWorktree) {
      sessions.update(session.id, { gitWorktree });
    }

    // Store file attachments if any - saves to disk in workingDirectory/.attachments
    const sessionAttachments = attachments.createBatch(session.id, null, files, workingDirectory);

    // Only start session manager if startImmediately is true AND not scheduled
    const isScheduled = scheduledAt && scheduledAt > Date.now();
    if (startImmediately && !isScheduled) {
      // Start session manager (non-blocking) - pass attachments for context
      const { runSession } = await import('../services/sessionManager.js');
      runSession(session.id, prompt, workingDirectory, project.systemPrompt, sessionAttachments, null).catch((error) => {
        console.error('Session error:', error);
        sessions.update(session.id, { status: 'error', error: error.message });
      });
    }

    // Return updated session with gitWorktree if set
    const updatedSession = sessions.getById(session.id);

    // Broadcast session created to project subscribers
    broadcastToProject(req.params.id, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: req.params.id,
      session: updatedSession,
    });

    // Execute on_session_created hook if configured (non-blocking)
    if (project.onSessionCreated) {
      executeHookAsync(project.onSessionCreated, workingDirectory, {
        sessionId: session.id,
        projectId: project.id,
        sessionName: session.name,
      });
    }

    res.status(201).json(updatedSession);
  } catch (error) {
    console.error('Git setup error:', error);
    const updatedSession = sessions.update(session.id, { status: 'error', error: error.message });

    // Broadcast error status to project subscribers for session list updates
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
