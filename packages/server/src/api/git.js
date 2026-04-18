import { Router } from 'express';
import { projects } from '../database.js';
import * as gitService from '../services/gitService.js';

const router = Router();

// GET /api/git/detect-worktree-path?directory=/path/to/repo
router.get('/detect-worktree-path', async (req, res) => {
  const { directory } = req.query;
  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const result = await gitService.detectWorktreePath(directory);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id/git/status - Check if git repo, get branches
router.get('/projects/:id/status', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const isRepo = await gitService.isGitRepo(project.workingDirectory);
    if (!isRepo) {
      return res.json({ isGitRepo: false });
    }

    const [branches, currentBranch] = await Promise.all([
      gitService.getBranches(project.workingDirectory),
      gitService.getCurrentBranch(project.workingDirectory),
    ]);

    res.json({
      isGitRepo: true,
      currentBranch,
      branches,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id/git/worktrees - List worktrees
router.get('/projects/:id/worktrees', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const worktrees = await gitService.getWorktrees(project.workingDirectory);
    res.json(worktrees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:id/git/worktrees - Create worktree
router.post('/projects/:id/worktrees', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { branch, path } = req.body;
  if (!branch || !path) {
    return res.status(400).json({ error: 'Branch and path are required' });
  }

  try {
    const worktree = await gitService.createWorktree(project.workingDirectory, branch, path);
    res.status(201).json(worktree);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/projects/:id/git/worktrees/:path - Remove worktree
router.delete('/projects/:id/worktrees/:path(*)', async (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    await gitService.removeWorktree(project.workingDirectory, req.params.path);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
