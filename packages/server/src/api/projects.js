import { Router } from 'express';
import { projects, sessions, sessionTemplates, attachments, commandButtons } from '../database.js';
import { CreateProjectRequest, UpdateProjectRequest } from '@claudetools/shared/contracts/projects';
import { CreateSessionTemplateRequest } from '@claudetools/shared/contracts/templates';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@claudetools/shared/contracts/commandButtons';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { executeHookAsync } from '../services/hookService.js';
import { broadcastToProject, broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { upload, handleUploadError } from '../middleware/upload.js';
import { commandRunner } from '../services/commandRunner.js';
import { databaseManager } from '../db/DatabaseManager.js';

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
    return res.status(400).json({ error: result.error.errors[0].message });
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
    return res.status(400).json({ error: result.error.errors[0].message });
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
router.get('/:id/sessions', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Parse archived query param: undefined = all, 'true' = archived only, 'false' = non-archived only
  const { archived } = req.query;
  let archivedFilter = null;
  if (archived === 'true') archivedFilter = true;
  else if (archived === 'false') archivedFilter = false;

  const projectSessions = sessions.getByProjectId(req.params.id, { archived: archivedFilter });
  res.json(projectSessions);
});

// POST /api/projects/:id/sessions - Create session
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/sessions', upload.array('files', 10), handleUploadError, async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Handle both JSON and form-data - parse booleans from form-data strings
  const prompt = req.body.prompt;
  const name = req.body.name;
  const mode = req.body.mode;
  const model = req.body.model;
  let thinkingEnabled = req.body.thinkingEnabled === true || req.body.thinkingEnabled === 'true';
  let gitBranch = req.body.gitBranch;
  let gitMode = req.body.gitMode;
  const templateId = req.body.templateId;
  const files = req.files || [];

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Apply template settings if templateId is provided
  let nextTemplateId = null;
  if (templateId) {
    const template = sessionTemplates.getById(templateId);
    if (template) {
      // Template settings override if set (not null/undefined)
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

  const sessionName = name || generateInitialName(prompt);
  const session = sessions.create(req.params.id, sessionName, prompt, mode, thinkingEnabled, gitBranch, model);

  // Set nextTemplateId if template was selected
  if (nextTemplateId) {
    sessions.update(session.id, { nextTemplateId });
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

    // Start session manager (non-blocking) - pass attachments for context
    const { runSession } = await import('../services/sessionManager.js');
    runSession(session.id, prompt, workingDirectory, project.systemPrompt, sessionAttachments, model).catch((error) => {
      console.error('Session error:', error);
      sessions.update(session.id, { status: 'error', error: error.message });
    });

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
    return res.status(400).json({ error: result.error.errors[0].message });
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
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const button = commandButtons.create({
    projectId: req.params.id,
    label: result.data.label,
    command: result.data.command,
    sortOrder: result.data.sortOrder,
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
    return res.status(400).json({ error: result.error.errors[0].message });
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

export default router;
