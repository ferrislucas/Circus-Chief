import { Router } from 'express';
import { modelTiers } from '../database.js';
import {
  CreateTierRequest,
  UpdateTierRequest,
} from '@circuschief/shared/contracts/modelTiers';

const ERR_TIER_NOT_FOUND = 'Tier not found';

const router = Router();

// GET /api/tiers — list all tiers with members
router.get('/', (_req, res) => {
  try {
    const all = modelTiers.getAllWithMembers();
    res.json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tiers/:id — get a single tier with members
router.get('/:id', (req, res) => {
  try {
    const tier = modelTiers.getByIdWithMembers(req.params.id);
    if (!tier) return res.status(404).json({ error: ERR_TIER_NOT_FOUND });
    res.json(tier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tiers — create a tier
router.post('/', (req, res) => {
  const result = CreateTierRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  try {
    const tier = modelTiers.create(result.data);
    res.status(201).json(tier);
  } catch (error) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A tier with that name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/tiers/:id — update a tier
router.patch('/:id', (req, res) => {
  const tier = modelTiers.getByIdWithMembers(req.params.id);
  if (!tier) return res.status(404).json({ error: ERR_TIER_NOT_FOUND });

  const result = UpdateTierRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  try {
    const updated = modelTiers.update(req.params.id, result.data);
    res.json(updated);
  } catch (error) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A tier with that name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tiers/:id — delete a tier
router.delete('/:id', (req, res) => {
  const tier = modelTiers.getByIdWithMembers(req.params.id);
  if (!tier) return res.status(404).json({ error: ERR_TIER_NOT_FOUND });

  try {
    modelTiers.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
