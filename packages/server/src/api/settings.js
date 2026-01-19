import { Router } from 'express';
import { settings } from '../db/index.js';

const router = Router();

/**
 * GET /api/settings/token-weights
 * Get current token cost weights
 */
router.get('/token-weights', (req, res) => {
  try {
    const weights = settings.getTokenCostWeights();
    res.json(weights);
  } catch (error) {
    console.error('Error getting token weights:', error);
    res.status(500).json({ error: 'Failed to get token weights' });
  }
});

/**
 * PUT /api/settings/token-weights
 * Update token cost weights
 */
router.put('/token-weights', (req, res) => {
  try {
    const { input, output, cacheRead, cacheCreation } = req.body;

    // Validate required fields are present and are numbers
    if (typeof input !== 'number' || typeof output !== 'number' ||
        typeof cacheRead !== 'number' || typeof cacheCreation !== 'number') {
      return res.status(400).json({
        error: 'All weights (input, output, cacheRead, cacheCreation) must be numbers'
      });
    }

    // Validate weights are positive
    if (input < 0 || output < 0 || cacheRead < 0 || cacheCreation < 0) {
      return res.status(400).json({
        error: 'All weights must be non-negative numbers'
      });
    }

    const updatedWeights = settings.setTokenCostWeights({
      input,
      output,
      cacheRead,
      cacheCreation,
    });

    res.json(updatedWeights);
  } catch (error) {
    console.error('Error updating token weights:', error);
    res.status(500).json({ error: 'Failed to update token weights' });
  }
});

/**
 * DELETE /api/settings/token-weights
 * Reset token cost weights to defaults
 */
router.delete('/token-weights', (req, res) => {
  try {
    const defaults = settings.resetTokenCostWeights();
    res.json(defaults);
  } catch (error) {
    console.error('Error resetting token weights:', error);
    res.status(500).json({ error: 'Failed to reset token weights' });
  }
});

export default router;
