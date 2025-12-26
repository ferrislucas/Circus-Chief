import { CLAUDE_MODELS, DEFAULT_MODEL } from '@claudetools/shared';

/**
 * Composable for handling Claude model information
 * Provides utilities to get display names and descriptions for models
 */
export function useModelInfo() {
  /**
   * Get human-readable display name for a model ID
   * @param {string|null} modelId - The model ID (e.g., 'claude-opus-4-5-20251101')
   * @returns {string} - The display name (e.g., 'Opus 4.5') or 'Default' if null
   */
  function getModelDisplayName(modelId) {
    if (!modelId) {
      return 'Default';
    }

    const model = CLAUDE_MODELS.find((m) => m.id === modelId);
    return model ? model.name : 'Unknown';
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
    return model ? model.description : '';
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
  };
}
