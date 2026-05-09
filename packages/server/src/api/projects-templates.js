import { Router } from 'express';
import { projects, sessionTemplates } from '../database.js';
import { CreateSessionTemplateRequest } from '@circuschief/shared/contracts/templates';

const ERR_PROJECT_NOT_FOUND = 'Project not found';
const router = Router({ mergeParams: true });

// GET - List available templates for project (project + global)
router.get('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const available = sessionTemplates.getAvailableForProject(req.params.id);
  res.json(available);
});

// POST - Create project template
router.post('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
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

export default router;
