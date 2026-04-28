import { modelProviders, sessions } from '../database.js';

export const DEFAULT_ANTHROPIC_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPENAI_SUMMARY_MODEL = 'gpt-5.4-mini';
export const BUILT_IN_ANTHROPIC_PROVIDER_ID = 'anthropic-default';
export const BUILT_IN_OPENAI_PROVIDER_ID = 'openai-default';

export const CHEAPEST_SUMMARY_MODEL_BY_BUILT_IN_PROVIDER = Object.freeze({
  [BUILT_IN_ANTHROPIC_PROVIDER_ID]: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
  [BUILT_IN_OPENAI_PROVIDER_ID]: DEFAULT_OPENAI_SUMMARY_MODEL,
});

const ANTHROPIC_TIER_NAMES = new Set(['sonnet', 'opus', 'haiku']);

export function isKnownBuiltInAnthropicModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  if (ANTHROPIC_TIER_NAMES.has(modelId.toLowerCase())) return true;
  if (modelId === DEFAULT_ANTHROPIC_SUMMARY_MODEL) return true;

  const anthropicProvider = modelProviders.getById(BUILT_IN_ANTHROPIC_PROVIDER_ID);
  return Boolean(
    anthropicProvider?.models?.some((model) => model.modelId === modelId)
      || modelId.startsWith('claude-')
  );
}

export function resolveSummaryModel(summarySettings = {}) {
  const summaryModel = summarySettings?.summaryModel || '';
  const summaryProviderId = summarySettings?.summaryProviderId || null;

  if (summaryModel) {
    return resolveExplicitSummaryModel(summaryModel, summaryProviderId);
  }

  const recentFamily = findRecentBuiltInProviderFamily();
  if (recentFamily === BUILT_IN_OPENAI_PROVIDER_ID) {
    return {
      model: DEFAULT_OPENAI_SUMMARY_MODEL,
      provider: modelProviders.getById(BUILT_IN_OPENAI_PROVIDER_ID),
      providerId: BUILT_IN_OPENAI_PROVIDER_ID,
      kind: 'openai',
      isDefault: true,
      selectionReason: 'recent-built-in-provider',
    };
  }

  if (recentFamily === BUILT_IN_ANTHROPIC_PROVIDER_ID) {
    return defaultAnthropicResolution('recent-built-in-provider');
  }

  return defaultAnthropicResolution('fallback');
}

function resolveExplicitSummaryModel(summaryModel, summaryProviderId) {
  if (summaryProviderId) {
    const provider = modelProviders.getById(summaryProviderId);
    if (!provider) {
      throw new Error(`Summary provider not found: ${summaryProviderId}`);
    }
    const ownsModel = provider.models?.some((model) => model.modelId === summaryModel);
    if (!ownsModel) {
      throw new Error(`Summary provider ${summaryProviderId} does not own model ${summaryModel}`);
    }
    return providerResolution(summaryModel, provider, 'explicit');
  }

  const provider = modelProviders.getProviderByModelId(summaryModel);
  if (provider) return providerResolution(summaryModel, provider, 'explicit');

  if (isKnownBuiltInAnthropicModel(summaryModel)) {
    return {
      model: summaryModel,
      provider: null,
      providerId: null,
      kind: 'anthropic',
      isDefault: false,
      selectionReason: 'explicit',
    };
  }

  throw new Error(`Unknown summary model: ${summaryModel}`);
}

function providerResolution(model, provider, selectionReason) {
  const kind = provider.kind || 'anthropic';
  return {
    model,
    provider,
    providerId: provider.id,
    kind,
    isDefault: false,
    selectionReason,
  };
}

function defaultAnthropicResolution(selectionReason) {
  return {
    model: DEFAULT_ANTHROPIC_SUMMARY_MODEL,
    provider: null,
    providerId: null,
    kind: 'anthropic',
    isDefault: true,
    selectionReason,
  };
}

function findRecentBuiltInProviderFamily() {
  for (const usage of getRecentSessionModelUsage()) {
    const providerId = usage.providerId || null;
    if (providerId) {
      const provider = modelProviders.getById(providerId);
      const family = builtInFamilyForProvider(provider);
      if (family) return family;
      continue;
    }

    const model = usage.model || null;
    if (!model) continue;

    const provider = modelProviders.getProviderByModelId(model);
    const family = builtInFamilyForProvider(provider);
    if (family) return family;

    if (!provider && isKnownBuiltInAnthropicModel(model)) {
      return BUILT_IN_ANTHROPIC_PROVIDER_ID;
    }
  }
  return null;
}

function builtInFamilyForProvider(provider) {
  if (!provider?.isBuiltIn) return null;
  if (provider.id === BUILT_IN_OPENAI_PROVIDER_ID || provider.kind === 'openai') return BUILT_IN_OPENAI_PROVIDER_ID;
  if (provider.id === BUILT_IN_ANTHROPIC_PROVIDER_ID || (provider.kind || 'anthropic') === 'anthropic') {
    return BUILT_IN_ANTHROPIC_PROVIDER_ID;
  }
  return null;
}

export function getRecentSessionModelUsage(limit = 50) {
  const rows = sessions.db
    .prepare(
      `SELECT model, provider_id
       FROM sessions
       ORDER BY updated_at DESC, created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(limit);

  return rows.map((row) => ({
    model: row.model || null,
    providerId: row.provider_id || null,
  }));
}
