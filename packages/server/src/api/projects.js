import { Router } from 'express';
import { projects, sessions, attachments } from '../database.js';
import { CreateProjectRequest, UpdateProjectRequest } from '@claudetools/shared/contracts/projects';
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
router.get('/:id/sessions', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const projectSessions = sessions.getByProjectId(req.params.id);
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
  const thinkingEnabled = req.body.thinkingEnabled === true || req.body.thinkingEnabled === 'true';
  const gitBranch = req.body.gitBranch;
  const gitMode = req.body.gitMode;
  const files = req.files || [];

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const sessionName = name || generateInitialName(prompt);
  const session = sessions.create(req.params.id, sessionName, prompt, mode, thinkingEnabled, gitBranch, model);

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
    sessions.update(session.id, { status: 'error', error: error.message });
    res.status(500).json({ error: `Git setup failed: ${error.message}` });
  }
});

export default router;
