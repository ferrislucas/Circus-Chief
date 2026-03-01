import { modelProviders } from '../database.js';
import { DEFAULT_SERVER_PORT } from '@claudetools/shared';
import { createRobustEnv } from './nodeSpawnHelper.js';

/** Check if mock mode is enabled (for E2E testing) */
export const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Get the base API URL for canvas and session operations.
 * Uses CLAUDETOOLS_API_URL environment variable if set, otherwise constructs
 * from the runtime port to ensure dynamic port handling.
 * @returns {string} The base API URL (e.g., http://localhost:5000)
 */
export function getApiBaseUrl() {
  return process.env.CLAUDETOOLS_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
}

/**
 * Resolve the provider for a given model ID
 * Looks up which provider owns the model, or returns null for Anthropic defaults
 * @param {string|null} modelId - The model ID to look up
 * @returns {Object|null} Provider object or null if using Anthropic default
 */
export function resolveProviderFromModel(modelId) {
  return modelProviders.getProviderByModelId(modelId);
}

/**
 * Build environment variables from provider configuration
 * @param {Object|null} provider - Provider object
 * @returns {Object} Environment variables to add to session env
 */
export function buildProviderEnv(provider) {
  if (!provider) {
    console.log('[SessionManager] buildProviderEnv: No provider, using SDK defaults');
    return {}; // Use SDK defaults
  }

  const env = {};

  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }
  if (provider.authToken) {
    // Set BOTH ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
    // The SDK prioritizes ANTHROPIC_API_KEY, so we must set it to override
    // any user's existing ANTHROPIC_API_KEY in their environment
    env.ANTHROPIC_API_KEY = provider.authToken;
    env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
  }
  // Derive default model env vars from the provider's models array by tier
  if (provider.models && Array.isArray(provider.models)) {
    const opusModel = provider.models.find(m => m.tier === 'opus');
    const sonnetModel = provider.models.find(m => m.tier === 'sonnet');
    const haikuModel = provider.models.find(m => m.tier === 'haiku');
    if (opusModel) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel.modelId;
    }
    if (sonnetModel) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel.modelId;
    }
    if (haikuModel) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel.modelId;
    }
  }
  if (provider.apiTimeoutMs) {
    env.API_TIMEOUT_MS = String(provider.apiTimeoutMs);
  }

  // Parse additional env vars
  if (provider.additionalEnvVars) {
    Object.assign(env, provider.additionalEnvVars);
  }

  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" env vars:`, {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  });

  return env;
}

/**
 * Build environment variables for Claude SDK based on provider and session settings.
 * Always returns a robust env with Node in PATH to prevent ENOENT errors.
 * @param {Object|null} provider - Provider object or null for Anthropic defaults
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled
 * @returns {Object}
 */
export function buildSessionEnv(provider, thinkingEnabled = false) {
  const baseEnv = createRobustEnv(process.env);
  const providerEnv = buildProviderEnv(provider);

  // Combine all env vars
  const sessionEnv = {
    ...baseEnv,
    ...providerEnv, // Add provider env vars
  };

  // When no custom provider is configured, explicitly exclude ANTHROPIC_* variables
  // from the environment to ensure SDK uses its defaults (not user's env vars)
  if (!provider) {
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;
  }

  // Add thinking tokens if enabled
  if (thinkingEnabled) {
    sessionEnv.MAX_THINKING_TOKENS = '10240';
  }

  return sessionEnv;
}

/**
 * Map session mode to SDK permissionMode
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo')
 * @returns {string} SDK permissionMode value
 */
export function getPermissionModeForSession(mode) {
  switch (mode) {
    case 'yolo':
      return 'bypassPermissions';
    case 'plan':
    case 'standard':
    default:
      return 'default';
  }
}
