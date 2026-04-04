import { Router } from 'express';
import { settings } from '../db/index.js';
import { DEFAULT_SESSION_TITLE_PROMPT } from '../services/summaryService.js';

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

/**
 * GET /api/settings/summary
 * Get summary settings
 */
router.get('/summary', (req, res) => {
  try {
    const summarySettings = settings.getSummarySettings();
    // Include the default prompt for UI display/editing
    res.json({
      ...summarySettings,
      defaultSessionTitlePrompt: DEFAULT_SESSION_TITLE_PROMPT,
    });
  } catch (error) {
    console.error('Error getting summary settings:', error);
    res.status(500).json({ error: 'Failed to get summary settings' });
  }
});

/**
 * PUT /api/settings/summary
 * Update summary settings
 */
router.put('/summary', (req, res) => {
  try {
    const { disableSessionSummaries, sessionTitlePrompt } = req.body;

    // Validate that all required fields are present
    if (typeof disableSessionSummaries !== 'boolean' ||
        typeof sessionTitlePrompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid summary settings. disableSessionSummaries must be a boolean, sessionTitlePrompt must be a string'
      });
    }

    const updatedSettings = settings.setSummarySettings({
      disableSessionSummaries,
      sessionTitlePrompt,
    });

    // Include the default prompt for UI display/editing
    res.json({
      ...updatedSettings,
      defaultSessionTitlePrompt: DEFAULT_SESSION_TITLE_PROMPT,
    });
  } catch (error) {
    console.error('Error updating summary settings:', error);
    res.status(500).json({ error: 'Failed to update summary settings' });
  }
});

/**
 * DELETE /api/settings/summary
 * Reset summary settings to defaults
 */
router.delete('/summary', (req, res) => {
  try {
    const defaults = settings.resetSummarySettings();
    // Include the default prompt for UI display/editing
    res.json({
      ...defaults,
      defaultSessionTitlePrompt: DEFAULT_SESSION_TITLE_PROMPT,
    });
  } catch (error) {
    console.error('Error resetting summary settings:', error);
    res.status(500).json({ error: 'Failed to reset summary settings' });
  }
});

/**
 * GET /api/settings/general
 * Get general settings (includes privacy settings)
 */
router.get('/general', (req, res) => {
  try {
    const generalSettings = settings.getGeneralSettings();
    res.json(generalSettings);
  } catch (error) {
    console.error('Error getting general settings:', error);
    res.status(500).json({ error: 'Failed to get general settings' });
  }
});

/**
 * PUT /api/settings/general
 * Update general settings
 */
router.put('/general', (req, res) => {
  try {
    const { disableAnalytics } = req.body;

    // Validate that disableAnalytics is a boolean
    if (typeof disableAnalytics !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid general settings. disableAnalytics must be a boolean'
      });
    }

    const updatedSettings = settings.setGeneralSettings({
      disableAnalytics,
    });

    res.json(updatedSettings);
  } catch (error) {
    console.error('Error updating general settings:', error);
    res.status(500).json({ error: 'Failed to update general settings' });
  }
});

/**
 * DELETE /api/settings/general
 * Reset general settings to defaults
 */
router.delete('/general', (req, res) => {
  try {
    const defaults = settings.resetGeneralSettings();
    res.json(defaults);
  } catch (error) {
    console.error('Error resetting general settings:', error);
    res.status(500).json({ error: 'Failed to reset general settings' });
  }
});

export default router;
