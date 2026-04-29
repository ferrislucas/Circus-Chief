import { Router } from 'express';
import { modelProviders, settings } from '../db/index.js';
import { DEFAULT_SESSION_TITLE_PROMPT } from '../services/summaryService.js';

const router = Router();
const SUPPORTED_SUMMARY_PROVIDER_KINDS = new Set(['anthropic', 'openai']);

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
    const body = req.body || {};
    const {
      disableSessionSummaries,
      sessionTitlePrompt,
      summaryModel,
      summaryProviderId,
    } = body;

    // Validate that all required fields are present
    if (typeof disableSessionSummaries !== 'boolean' ||
        typeof sessionTitlePrompt !== 'string' ||
        !Object.prototype.hasOwnProperty.call(body, 'summaryModel') ||
        !Object.prototype.hasOwnProperty.call(body, 'summaryProviderId')) {
      return res.status(400).json({
        error: 'Invalid summary settings. disableSessionSummaries must be a boolean, sessionTitlePrompt must be a string, summaryModel must be present, and summaryProviderId must be present'
      });
    }

    if (typeof summaryModel !== 'string') {
      return res.status(400).json({ error: 'summaryModel must be a string' });
    }

    if (summaryProviderId !== null && typeof summaryProviderId !== 'string') {
      return res.status(400).json({ error: 'summaryProviderId must be a string or null' });
    }

    const validationError = validateSummaryModelSelection(summaryModel, summaryProviderId);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const updatedSettings = settings.setSummarySettings({
      disableSessionSummaries,
      sessionTitlePrompt,
      summaryModel,
      summaryProviderId,
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

function validateSummaryModelSelection(summaryModel, summaryProviderId) {
  if (!summaryModel) {
    if (summaryProviderId !== null) {
      return 'summaryProviderId must be null when summaryModel is empty';
    }
    return null;
  }

  if (!summaryProviderId) {
    return 'summaryProviderId is required when summaryModel is set';
  }

  const provider = modelProviders.getById(summaryProviderId);
  if (!provider) return `Unknown summary provider: ${summaryProviderId}`;
  if (!SUPPORTED_SUMMARY_PROVIDER_KINDS.has(provider.kind || 'anthropic')) {
    return `Unsupported summary provider kind: ${provider.kind}`;
  }
  const ownsModel = provider.models?.some((model) => model.modelId === summaryModel);
  if (!ownsModel) {
    return `Provider ${summaryProviderId} does not own summary model ${summaryModel}`;
  }
  return null;
}

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
