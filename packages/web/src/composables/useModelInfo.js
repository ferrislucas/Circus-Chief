import { CLAUDE_MODELS, DEFAULT_MODEL } from '@circuschief/shared';
import { useProvidersStore } from '../stores/providers.js';

/**
 * Format a raw model ID into a human-readable name
 * Handles third-party models that aren't in CLAUDE_MODELS or providers store
 * @param {string} modelId - The raw model ID
 * @returns {string} - Formatted display name
 */
function formatModelId(modelId) {
  if (!modelId) return 'Unknown';

  // Remove path prefixes (e.g., "models/", "accounts/.../models/")
  let formatted = modelId.replace(/^(.*\/)?models\//, '');
  formatted = formatted.replace(/^accounts\/[^/]+\/models\//, '');

  // Remove trailing date stamps (e.g., "-20241022")
  formatted = formatted.replace(/-\d{8}$/, '');

  // Replace hyphens and underscores with spaces
  formatted = formatted.replace(/[-_]/g, ' ');

  // Title case each word
  formatted = formatted
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return formatted || 'Unknown';
}

/**
 * Composable for handling Claude model information
 * Provides utilities to get display names and descriptions for models
 */
export function useModelInfo() {
  /**
   * Get human-readable display name for a model ID
   * @param {string|null} modelId - The model ID (e.g., 'claude-opus-4-6')
   * @returns {string} - The display name (e.g., 'Opus 4.6') or 'Default' if null
   */
  function getModelDisplayName(modelId) {
    if (!modelId) {
      return 'Default';
    }

    // 1. Check hardcoded known models
    const known = CLAUDE_MODELS.find((m) => m.id === modelId);
    if (known) return known.name;

    // 2. Check providers store for displayName
    try {
      const providersStore = useProvidersStore();
      const providerModel = providersStore.allModels.find((m) => m.modelId === modelId);
      if (providerModel?.displayName) return providerModel.displayName;
    } catch (error) {
      // Store might not be initialized yet, fall through to formatting
    }

    // 3. Last resort: format the raw model ID into a readable string
    return formatModelId(modelId);
  }

  /**
   * Get description for a model ID
   * @param {string|null} modelId - The model ID
   * @returns {string} - The description or empty string if not found
   */
  function getModelDescription(modelId) {
    if (!modelId) {
      const defaultModel = CLAUDE_MODELS.find((m) => m.id === DEFAULT_MODEL);
      return defaultModel ? defaultModel.description : '';
    }

    const model = CLAUDE_MODELS.find((m) => m.id === modelId);
    if (model) return model.description;

    // For unknown models, return the raw model ID so users can see the exact identifier
    return modelId;
  }

  /**
   * Get both display name and description
   * @param {string|null} modelId - The model ID
   * @returns {Object} - Object with name and description
   */
  function getModelInfo(modelId) {
    return {
      name: getModelDisplayName(modelId),
      description: getModelDescription(modelId),
    };
  }

  return {
    getModelDisplayName,
    getModelDescription,
    getModelInfo,
    formatModelId,
  };
}
