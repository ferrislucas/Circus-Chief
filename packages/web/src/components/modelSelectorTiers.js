/**
 * The single shared "is this tier a submittable selection" predicate. The
 * selector's visible set (`tiersWithMembers`) and the save-path guard
 * (`describeSelectionProblem` via `useSelectionGuard`) both judge tier refs
 * through this function, so the two cannot drift apart again: a tier is
 * selectable when it exists AND has ≥1 usable (`available`) member, honoring
 * the picker's provider-kind restriction.
 *
 * `providers` is a plain array of `{ id, kind }` (an id absent from the live
 * catalog fails a kind filter closed; a known provider with a legacy missing
 * `kind` still groups as anthropic, matching ModelSelector);
 * `allowedProviderKinds` is null for unrestricted pickers.
 */
export function isTierSelectable(tier, { providers = [], allowedProviderKinds = null } = {}) {
  const usable = (tier?.members || []).filter((member) => member.available === true);
  if (usable.length === 0) return false;
  if (!allowedProviderKinds) return true;
  // A tier is selectable when ANY member fits the restricted picker — every()
  // would hide mixed-kind tiers whose other members belong elsewhere.
  return usable.some((member) => {
    const provider = providers.find((entry) => entry?.id === member.providerId);
    // Unknown provider id → fail closed (the server-computed `available`
    // flag already encodes existence; an id absent from the live catalog
    // cannot prove a kind fit). A known provider with a legacy missing
    // `kind` field still groups as anthropic, matching ModelSelector.
    if (!provider) return false;
    return allowedProviderKinds.includes(provider.kind || 'anthropic');
  });
}

export function tierSupportsProviderKinds(tier, providersStore, allowedProviderKinds) {
  return isTierSelectable(tier, {
    providers: providersStore.providers || [],
    allowedProviderKinds,
  });
}

/**
 * The single shared "(model, providerId) → normalized pair" helper. A tier
 * reference never carries a concrete provider hint — the active member (and
 * its provider) resolves at run time — so any stored or incoming pair whose
 * model is a tier ref normalizes to `providerId: null`. Every surface that
 * persists or initializes a pair (selectors, defaults application, save
 * payloads, session init) funnels through this function instead of
 * re-implementing the rule.
 */
export function normalizeModelProviderPair(model, providerId) {
  if (typeof model === 'string' && model.startsWith('tier::')) {
    return { model, providerId: null };
  }
  return { model, providerId: providerId ?? null };
}

/**
 * Shared default-model resolver: the first enabled model of the first
 * enabled Claude-Code-kind provider (built-in preferred, `sonnet`-tier model
 * preferred within the provider). Extracted from ModelSelector's
 * `defaultModel` so session init paths resolve the same fallback instead of
 * hardcoding a legacy `'sonnet'` literal that may not exist in the catalog.
 * Returns a concrete model id, or null when no provider qualifies.
 */
export function resolveDefaultModelId(providers = []) {
  const candidates = (providers || []).filter(
    (provider) => provider?.kind !== 'openai' && provider?.kind !== 'google' && provider?.enabled !== false
  );
  if (candidates.length === 0) return null;
  const preferred = candidates.find((provider) => provider.isBuiltIn) || candidates[0];
  const enabledModels = (preferred?.models || []).filter((model) => model?.enabled !== false);
  if (enabledModels.length === 0) return null;
  const sonnet = enabledModels.find((model) => model.tier === 'sonnet');
  return (sonnet || enabledModels[0]).modelId || null;
}

export function tierDisplayName(modelValue, tiersStore) {
  const tierId = modelValue.slice('tier::'.length);
  return tiersStore.getById(tierId)?.name || tierId;
}

export function tierIsStale(modelValue, tiersStore, visibleTiers) {
  // `loaded` is false only for the real store's initial/failure state. Treat
  // lightweight callers that predate the flag as ready, preserving the helper
  // contract for callers that provide an explicit tier list.
  if (tiersStore.loaded === false) return false;
  const tierId = modelValue.slice('tier::'.length);
  return !visibleTiers.some((tier) => tier.id === tierId);
}

export function tierDisplayTitle(modelValue, tiersStore, stale) {
  const tierId = modelValue.slice('tier::'.length);
  const tier = tiersStore.getById(tierId);
  if (!tier) {
    return stale
      ? `Model tier "${tierId}" is no longer available — choose a replacement to update it.`
      : `Tier: ${tierId}`;
  }
  const memberCount = tier.members?.length ?? 0;
  return `Model tier "${tier.name}" — ${memberCount} member${memberCount !== 1 ? 's' : ''}`;
}
