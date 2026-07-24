import { modelProviders, sessions } from '../database.js';
import { isTierRef } from '@circuschief/shared';
import { resolveActiveModel } from './tierResolutionService.js';
import { ACTIVITY_FIELDS_SQL } from '../db/session-helpers.js';

export const DEFAULT_ANTHROPIC_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPENAI_SUMMARY_MODEL = 'gpt-5.4-mini';
export const BUILT_IN_ANTHROPIC_PROVIDER_ID = 'anthropic-default';
export const BUILT_IN_OPENAI_PROVIDER_ID = 'openai-default';

// Single source of truth for which provider kinds `callSummaryModel` knows how
// to route: 'openai' → OpenAI client, everything else → Anthropic client. A
// summary model/tier resolving to any other kind (e.g. 'google') must never
// reach that call — see the write-time check in api/settings.js and the
// resolve-time guard below.
export const SUPPORTED_SUMMARY_PROVIDER_KINDS = new Set(['anthropic', 'openai']);

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

/**
 * Resolve a summary tier ref to a concrete (model, providerId) suitable for
 * `resolveExplicitSummaryModel`, or `null` if the tier should fall through
 * to the default summary model selection (Fix 9 — graceful degradation).
 * Falls through when: the tier has no healthy members (cooldown/empty), or
 * the active member's provider kind is outside
 * SUPPORTED_SUMMARY_PROVIDER_KINDS (e.g. 'google') — write-time validation
 * (api/settings.js) should already block the latter, but a cooldown-driven
 * member change or a legacy row could still reach here, and this must never
 * silently mis-route a call (e.g. Google → Anthropic).
 * @param {string} summaryModel - Tier ref sentinel string
 * @returns {{ model: string, providerId: string }|null}
 */
function resolveHealthyTierSummaryMember(summaryModel) {
  const resolved = resolveActiveModel(summaryModel, {});
  if (!resolved) {
    console.warn(
      `[summaryModelResolver] Summary tier "${summaryModel}" has no healthy members — falling back to default summary model`
    );
    return null;
  }

  const resolvedKind = modelProviders.getById(resolved.providerId)?.kind || 'anthropic';
  if (!SUPPORTED_SUMMARY_PROVIDER_KINDS.has(resolvedKind)) {
    console.warn(
      `[summaryModelResolver] Summary tier "${summaryModel}" resolved to unsupported provider kind "${resolvedKind}" — falling back to default summary model`
    );
    return null;
  }

  return resolved;
}

export function resolveSummaryModel(summarySettings = {}) {
  const summaryModel = summarySettings?.summaryModel || '';
  const summaryProviderId = summarySettings?.summaryProviderId || null;

  if (summaryModel) {
    // Tier ref: resolve to a concrete (model, providerId) before building the summary run
    if (isTierRef(summaryModel)) {
      const resolved = resolveHealthyTierSummaryMember(summaryModel);
      if (resolved) {
        return resolveExplicitSummaryModel(resolved.model, resolved.providerId);
      }
      // Fall through to default resolution below
    } else {
      return resolveExplicitSummaryModel(summaryModel, summaryProviderId);
    }
  }
  if (summaryProviderId) {
    throw new Error('summaryModel is required when summaryProviderId is set');
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
  if (!summaryProviderId) {
    throw new Error('summaryProviderId is required when summaryModel is set');
  }

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
      `SELECT s.model, s.provider_id, ${ACTIVITY_FIELDS_SQL}
       FROM sessions s
       ORDER BY COALESCE(last_activity_at, s.updated_at, s.created_at) DESC,
                s.updated_at DESC,
                s.created_at DESC,
                s.rowid DESC
       LIMIT ?`
    )
    .all(limit);

  return rows.map((row) => ({
    model: row.model || null,
    providerId: row.provider_id || null,
  }));
}
