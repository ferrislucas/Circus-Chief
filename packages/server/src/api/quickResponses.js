import { Router } from 'express';
import { projects, quickResponses } from '../database.js';
import {
  CreateQuickResponseRequest,
  UpdateQuickResponseRequest,
  ReorderQuickResponsesRequest,
} from '@circuschief/shared/contracts/quickResponses';

const router = Router();

// GET /api/projects/:projectId/quick-responses - List quick responses for a project
router.get('/projects/:projectId/quick-responses', (req, res) => {
  const { projectId } = req.params;

  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const responses = quickResponses.getAvailableForProject(projectId);
  res.json(responses);
});

// POST /api/projects/:projectId/quick-responses - Create a quick response
router.post('/projects/:projectId/quick-responses', (req, res) => {
  const { projectId } = req.params;

  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = CreateQuickResponseRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { label, content, autoSubmit, category, sortOrder, isGlobal } = result.data;

  const response = quickResponses.create({
    projectId: isGlobal ? null : projectId,
    label: label.trim(),
    content,
    autoSubmit,
    category,
    sortOrder,
  });

  res.status(201).json(response);
});

// GET /api/quick-responses/global - List global quick responses only
router.get('/quick-responses/global', (_req, res) => {
  const responses = quickResponses.getGlobal();
  res.json(responses);
});

// PATCH /api/quick-responses/:id - Update a quick response
router.patch('/quick-responses/:id', (req, res) => {
  const { id } = req.params;

  const existing = quickResponses.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Quick response not found' });
  }

  const result = UpdateQuickResponseRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const updates = { ...result.data };
  if (updates.label) {
    updates.label = updates.label.trim();
  }

  const updated = quickResponses.update(id, updates);
  res.json(updated);
});

// DELETE /api/quick-responses/:id - Delete a quick response
router.delete('/quick-responses/:id', (req, res) => {
  const { id } = req.params;

  const existing = quickResponses.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Quick response not found' });
  }

  quickResponses.deleteById(id);
  res.status(204).send();
});

// POST /api/projects/:projectId/quick-responses/reorder - Reorder quick responses
router.post('/projects/:projectId/quick-responses/reorder', (req, res) => {
  const { projectId } = req.params;

  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = ReorderQuickResponsesRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  quickResponses.updateSortOrder(result.data);

  // Return the updated responses
  const responses = quickResponses.getAvailableForProject(projectId);
  res.json(responses);
});

// POST /api/quick-responses/global/reorder - Reorder global quick responses
router.post('/quick-responses/global/reorder', (req, res) => {
  const result = ReorderQuickResponsesRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  quickResponses.updateSortOrder(result.data);

  // Return the updated global responses
  const responses = quickResponses.getGlobal();
  res.json(responses);
});

export default router;
