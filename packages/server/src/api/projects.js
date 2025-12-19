import { Router } from 'express';
import { projects, sessions } from '../database.js';
import { CreateProjectRequest, UpdateProjectRequest } from '@claudetools/shared/contracts/projects';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { executeHookAsync } from '../services/hookService.js';

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
router.post('/:id/sessions', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { prompt, name, mode, thinkingEnabled, gitBranch, gitMode } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const sessionName = name || `Session ${Date.now()}`;
  const session = sessions.create(req.params.id, sessionName, prompt, mode, thinkingEnabled, gitBranch);

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

    // Start session manager (non-blocking)
    const { runSession } = await import('../services/sessionManager.js');
    runSession(session.id, prompt, workingDirectory, project.systemPrompt).catch((error) => {
      console.error('Session error:', error);
      sessions.update(session.id, { status: 'error', error: error.message });
    });

    // Return updated session with gitWorktree if set
    const updatedSession = sessions.getById(session.id);

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
