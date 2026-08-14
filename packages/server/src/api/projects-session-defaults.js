import { Router } from 'express';
import { projects, projectDefaults } from '../database.js';
import { ProjectSessionDefaultsRequest } from '@circuschief/shared/contracts/projects';
import { validateModelId } from './model-validation.js';
import { isTierRef } from '@circuschief/shared';

const ERR_PROJECT_NOT_FOUND = 'Project not found';

const router = Router({ mergeParams: true });

// GET /api/projects/:id/session-defaults - Get session defaults for project
router.get('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const defaults = projectDefaults.getByProjectId(req.params.id);
  if (!defaults) {
    return res.json(null);
  }

  res.json(defaults);
});

// POST /api/projects/:id/session-defaults - Update/create session defaults for project
router.post('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  const result = ProjectSessionDefaultsRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const modelResult = validateModelId(result.data.model);
  if (modelResult.error) {
    return res.status(400).json({ error: modelResult.error });
  }

  // A tier binding has no single owning provider — the concrete provider is
  // resolved per-run from the active tier member (Work Item 1). Normalize
  // away a stray concrete providerId so it never shadows the tier binding.
  if (isTierRef(result.data.model)) {
    result.data.providerId = null;
  }

  const updated = projectDefaults.upsert(req.params.id, result.data);
  res.status(200).json(updated);
});

// DELETE /api/projects/:id/session-defaults - Reset session defaults for project
router.delete('/', (req, res) => {
  const project = projects.getById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: ERR_PROJECT_NOT_FOUND });
  }

  projectDefaults.resetToDefaults(req.params.id);
  res.json({ message: 'Session defaults reset to system defaults' });
});

export default router;
