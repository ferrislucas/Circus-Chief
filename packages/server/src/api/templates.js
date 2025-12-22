import { Router } from 'express';
import { sessionTemplates } from '../database.js';
import { CreateSessionTemplateRequest, UpdateSessionTemplateRequest } from '@claudetools/shared/contracts/templates';

const router = Router();

// GET /api/templates - List all global templates
router.get('/', (_req, res) => {
  const templates = sessionTemplates.getGlobal();
  res.json(templates);
});

// POST /api/templates - Create global template
router.post('/', (req, res) => {
  const result = CreateSessionTemplateRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const template = sessionTemplates.create({
    projectId: null, // Global template
    ...result.data,
  });
  res.status(201).json(template);
});

// GET /api/templates/:id - Get template by ID
router.get('/:id', (req, res) => {
  const template = sessionTemplates.getById(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json(template);
});

// PATCH /api/templates/:id - Update template
router.patch('/:id', (req, res) => {
  const template = sessionTemplates.getById(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const result = UpdateSessionTemplateRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const updated = sessionTemplates.update(req.params.id, result.data);
  res.json(updated);
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', (req, res) => {
  const template = sessionTemplates.getById(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  sessionTemplates.delete(req.params.id);
  res.status(204).send();
});

export default router;
