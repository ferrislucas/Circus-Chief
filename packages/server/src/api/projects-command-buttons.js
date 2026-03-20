import { Router } from 'express';
import { projects, commandButtons, projectDefaults } from '../database.js';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@claudetools/shared/contracts/commandButtons';
import { ProjectSessionDefaultsRequest } from '@claudetools/shared/contracts/projects';

const router = Router();

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
