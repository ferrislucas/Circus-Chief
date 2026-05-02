import { CLAUDE_MODELS, DEFAULT_MODEL, OPENAI_MODELS } from '@circuschief/shared';
import { useProvidersStore } from '../stores/providers.js';
import { api } from './useApi.js';

/**
 * Default capability shape used when `/api/agents` has not yet returned
 * or an unknown agent type is requested. Conservative: nothing enabled.
 */
const UNKNOWN_CAPABILITIES = Object.freeze({
  streaming: false,
  thinking: false,
  reasoningEffort: false,
  toolUse: false,
  resume: false,
});

/**
 * Module-level cache of `/api/agents` results, keyed by agentType.
 * Populated on first call and reused for every subsequent composable
 * invocation. Also tracks an in-flight promise so concurrent callers
 * share one network request.
 *
 * @type {{ byAgentType: Map<string, object>, fetchPromise: Promise|null, fetched: boolean }}
 */
const capabilityCache = {
  byAgentType: new Map(),
  fetchPromise: null,
  fetched: false,
};

/**
 * Reset the module-level capability cache. Intended for tests.
 */
export function __resetCapabilityCache() {
  capabilityCache.byAgentType = new Map();
  capabilityCache.fetchPromise = null;
  capabilityCache.fetched = false;
}

/**
 * Fetch capabilities from `/api/agents` exactly once per session.
 * Concurrent callers share the in-flight request.
 *
 * @returns {Promise<Map<string, object>>}
 */
async function fetchCapabilities() {
  if (capabilityCache.fetched) return capabilityCache.byAgentType;
  if (capabilityCache.fetchPromise) return capabilityCache.fetchPromise;

  capabilityCache.fetchPromise = (async () => {
    try {
      const list = await api.getAgents();
      for (const entry of list || []) {
        if (entry && entry.agentType) {
          capabilityCache.byAgentType.set(entry.agentType, entry.capabilities || UNKNOWN_CAPABILITIES);
        }
      }
    } catch (_error) {
      // Leave the cache empty on failure; callers still get UNKNOWN_CAPABILITIES.
    } finally {
      capabilityCache.fetched = true;
      capabilityCache.fetchPromise = null;
    }
    return capabilityCache.byAgentType;
  })();

  return capabilityCache.fetchPromise;
}

/**
 * Synchronous read of the capability cache (no network).
 *
 * @param {string} agentType
 * @returns {object}
 */
function capabilitiesFor(agentType) {
  return capabilityCache.byAgentType.get(agentType) || { ...UNKNOWN_CAPABILITIES };
}

/**
 * Map a provider's `kind` to an agent type. Unknown / missing kinds default
 * to `claude-code` so legacy providers behave as before.
 *
 * @param {{ kind?: string } | null} provider
 * @returns {string}
 */
function agentTypeForProvider(provider) {
  if (provider?.kind === 'openai') return 'codex';
  return 'claude-code';
}

function resolveCatalogModel(modelId, provider) {
  if (provider?.kind === 'openai') {
    return OPENAI_MODELS.find((m) => m.id === modelId) || null;
  }
  if (!provider || agentTypeForProvider(provider) === 'claude-code') {
    return CLAUDE_MODELS.find((m) => m.id === modelId) || null;
  }
  return null;
}

/**
 * Resolve the provider-model record (with provider metadata) that owns a
 * given modelId. Returns null if none.
 *
 * @param {string} modelId
 * @returns {object|null}
 */
function resolveProviderModel(modelId) {
  try {
    const providersStore = useProvidersStore();
    const matches = providersStore.allModels.filter((m) => m.modelId === modelId);
    if (matches.length <= 1) return matches[0] || null;

    return matches.sort((a, b) => {
      const providerA = resolveProvider(a.providerId);
      const providerB = resolveProvider(b.providerId);
      if (providerA?.isBuiltIn !== providerB?.isBuiltIn) {
        return providerA?.isBuiltIn ? 1 : -1;
      }
      return (providerA?.name || '').localeCompare(providerB?.name || '');
    })[0] || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Lookup the provider record (with `kind`) in the providers store.
 *
 * @param {string} providerId
 * @returns {object|null}
 */
function resolveProvider(providerId) {
  try {
    const providersStore = useProvidersStore();
    return providersStore.getById(providerId) || null;
  } catch (_error) {
    return null;
  }
}

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
 * Composable for handling model information.
 *
 * Phase 6 behavior:
 *   - `CLAUDE_MODELS` (the hardcoded Anthropic constants) are ONLY consulted
 *     when the resolved provider has `kind === 'anthropic'` (or is missing,
 *     which defaults to `claude-code`). Codex / OpenAI model IDs never match
 *     the Claude constants even if the string happens to collide.
 *   - `getModelInfo()` returns `{ name, description, providerId, providerName,
 *     agentType, capabilities }`. `capabilities` come from the `/api/agents`
 *     map fetched once and cached module-wide.
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

    const providerModel = resolveProviderModel(modelId);
    const provider = providerModel ? resolveProvider(providerModel.providerId) : null;

    const known = resolveCatalogModel(modelId, provider);
    if (known) return known.name;

    if (providerModel?.displayName) return providerModel.displayName;

    // Last resort: format the raw model ID into a readable string
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

    const providerModel = resolveProviderModel(modelId);
    const provider = providerModel ? resolveProvider(providerModel.providerId) : null;

    const model = resolveCatalogModel(modelId, provider);
    if (model) return model.description;

    if (providerModel?.description) return providerModel.description;

    // For unknown/non-Anthropic models, return the raw model ID so users can
    // see the exact identifier.
    return modelId;
  }

  /**
   * Get display name, description, provider info, agent type, and capabilities
   * for a model ID.
   *
   * @param {string|null} modelId - The model ID
   * @returns {{
   *   name: string,
   *   description: string,
   *   providerId: string|null,
   *   providerName: string|null,
   *   agentType: string,
   *   capabilities: object,
   * }}
   */
  function getModelInfo(modelId) {
    // Kick off the capability fetch (fire-and-forget). Subsequent calls hit
    // the cache; unit tests typically seed the cache synchronously.
    fetchCapabilities();

    const providerModel = resolveProviderModel(modelId);
    const provider = providerModel ? resolveProvider(providerModel.providerId) : null;
    const agentType = provider ? agentTypeForProvider(provider) : 'claude-code';

    return {
      name: getModelDisplayName(modelId),
      description: getModelDescription(modelId),
      providerId: providerModel?.providerId || null,
      providerName: providerModel?.providerName || provider?.name || null,
      agentType,
      capabilities: capabilitiesFor(agentType),
    };
  }

  return {
    getModelDisplayName,
    getModelDescription,
    getModelInfo,
    formatModelId,
    // Expose the async fetch so consumers that need capabilities on mount
    // (e.g. SessionFormOptions) can `await` it before rendering.
    fetchAgentCapabilities: fetchCapabilities,
  };
}
