import { Router } from 'express';
import { modelTiers, settings } from '../database.js';
import {
  CreateTierRequest,
  UpdateTierRequest,
} from '@circuschief/shared/contracts/modelTiers';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import { validateTierMembers } from './model-validation.js';
import { getTierMemberAvailabilityMap, getTierMembersWithAvailability } from '../services/tierResolutionService.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { deleteTierAndDegradeReferences, degradeReferencesToEmptiedTiers } from '../services/tierDeletionService.js';
import { publishEmptiedTierDegradations, publishTierDegradation } from '../services/tierDegradationNotifier.js';

const ERR_TIER_NOT_FOUND = 'Tier not found';

function withManagementMembers(tier, availabilityByProvider) {
  return tier ? { ...tier, members: getTierMembersWithAvailability(tier.members, availabilityByProvider) } : tier;
}

const router = Router();

/**
 * A configured summary tier must retain at least one member. Provider kinds
 * are unrestricted: summary dispatch supports every kind available in tiers.
 * @param {string} tierId
 * @param {Array<{providerId: string, modelId: string}>} members
 * @returns {string|null} An error message, or null if the edit is allowed.
 */
function checkSummaryTierKindGuard(tierId, members) {
  const summarySettings = settings.getSummarySettings();
  const isConfiguredSummaryTier =
    isTierRef(summarySettings.summaryModel) && parseTierRef(summarySettings.summaryModel) === tierId;
  if (!isConfiguredSummaryTier) return null;

  if (members.length === 0) {
    return 'This tier is the configured summary model — it must contain at least one executable model (see Settings → Summary Settings)';
  }
  return null;
}

// GET /api/tiers — list all tiers with members
router.get('/', (_req, res) => {
  try {
    const availabilityByProvider = getTierMemberAvailabilityMap();
    const all = modelTiers.getAllWithMembers().map((tier) => withManagementMembers(tier, availabilityByProvider));
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
    res.json(withManagementMembers(tier));
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

  const memberValidation = validateTierMembers(result.data.members);
  if (memberValidation.error) {
    return res.status(400).json({ error: memberValidation.error });
  }

  try {
    const tier = modelTiers.create(result.data);
    res.status(201).json(withManagementMembers(tier));
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

  if (result.data.members) {
    const memberValidation = validateTierMembers(result.data.members, {
      existingMembers: tier.members,
    });
    if (memberValidation.error) {
      return res.status(400).json({ error: memberValidation.error });
    }

    const summaryGuardError = checkSummaryTierKindGuard(req.params.id, result.data.members);
    if (summaryGuardError) {
      return res.status(400).json({ error: summaryGuardError });
    }
  }

  try {
    // Atomic with member replacement: a members update that leaves the tier
    // with no executable member empties it, so its persisted consumers
    // (defaults, templates, lanes, sessions, summary settings) are degraded in
    // the same transaction instead of dangling on an unusable tier ref.
    // Degradation change sets are collected inside the transaction and
    // published to connected clients only AFTER it commits.
    let degradationChangeSets = [];
    const updatedTier = databaseManager.transaction(() => {
      const updated = modelTiers.update(req.params.id, result.data);
      if (updated && result.data.members !== undefined) {
        degradationChangeSets = degradeReferencesToEmptiedTiers();
      }
      return updated;
    });
    publishEmptiedTierDegradations(degradationChangeSets);
    res.json(withManagementMembers(updatedTier));
  } catch (error) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A tier with that name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tiers/:id — delete a tier
router.delete('/:id', (req, res) => {
  try {
    const result = deleteTierAndDegradeReferences(req.params.id);
    if (!result) return res.status(404).json({ error: ERR_TIER_NOT_FOUND });
    // Post-commit: reconcile connected clients with the degraded state.
    publishTierDegradation(result.degradation);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
