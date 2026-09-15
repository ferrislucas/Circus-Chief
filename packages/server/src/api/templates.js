import { Router } from 'express';
import { sessionTemplates } from '../database.js';
import { CreateSessionTemplateRequest, UpdateSessionTemplateRequest } from '@circuschief/shared/contracts/templates';
import { validateModelAndProvider } from './model-validation.js';

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
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const modelResult = validateModelAndProvider(result.data.model, result.data.providerId);
  if (modelResult.error) {
    return res.status(400).json({ error: modelResult.error });
  }

  const template = sessionTemplates.create({
    projectId: null, // Global template
    ...result.data, model: modelResult.model, providerId: modelResult.providerId,
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
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const model = result.data.model === undefined ? template.model : result.data.model;
  const providerId = result.data.providerId === undefined ? template.providerId : result.data.providerId;
  const modelResult = validateModelAndProvider(model, providerId);
  if (modelResult.error) {
    return res.status(400).json({ error: modelResult.error });
  }

  const updated = sessionTemplates.update(req.params.id, {
    ...result.data, model: modelResult.model, providerId: modelResult.providerId,
  });
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
