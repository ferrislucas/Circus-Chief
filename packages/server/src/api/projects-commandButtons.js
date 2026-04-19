import { Router } from 'express';
import { projects, commandButtons } from '../database.js';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@circuschief/shared/contracts/commandButtons';

// Error message constants
const ERR_PROJECT_NOT_FOUND = 'Project not found';
const ERR_BUTTON_NOT_FOUND = 'Command button not found';

const router = Router({ mergeParams: true });

// GET /api/projects/:id/command-buttons - List all command buttons for project
router.get('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const buttons = commandButtons.getByProjectId(req.params.id);
  res.json(buttons);
});

// POST /api/projects/:id/command-buttons - Create new command button
router.post('/', (req, res) => {
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
router.get('/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }
  res.json(button);
});

// PATCH /api/projects/:id/command-buttons/:buttonId - Update button
router.patch('/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }

  const result = UpdateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const updated = commandButtons.update(req.params.buttonId, result.data);
  res.json(updated);
});

// DELETE /api/projects/:id/command-buttons/:buttonId - Delete button
router.delete('/:buttonId', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const button = commandButtons.getById(req.params.buttonId);
  if (!button) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }

  commandButtons.delete(req.params.buttonId);
  res.status(204).send();
});

export default router;
