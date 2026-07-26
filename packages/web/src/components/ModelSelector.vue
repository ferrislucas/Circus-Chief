<template>
  <div
    class="model-selector"
    :data-model="effectiveSelectedModel"
    :data-provider-id="effectiveSelectedProviderId || ''"
  >
    <select
      id="model-select"
      :value="effectiveSelectedKey"
      :disabled="disabled"
      :class="selectClass || 'model-select'"
      @change="handleModelChange($event)"
    >
      <option
        v-if="allowEmpty"
        value=""
      >
        {{ emptyLabel }}
      </option>
      <optgroup
        v-for="provider in visibleProviders"
        :key="provider.id"
        :label="`${agentLabelFor(provider)} · ${provider.name}`"
        :data-agent-type="agentTypeFor(provider)"
      >
        <option
          v-for="model in provider.models"
          :key="`${provider.id}:${model.id}`"
          :value="optionKey(provider.id, model.modelId)"
          :disabled="model.unavailable === true"
          :data-provider-id="provider.id"
          :data-model-id="model.modelId"
          :data-agent-type="agentTypeFor(provider)"
        >
          {{ optionLabel(provider, model) }}
        </option>
      </optgroup>
    </select>
    <span
      v-if="isUnknownModel"
      class="unknown-model-badge"
      :title="`Stored model '${model}' is no longer available. Choose a replacement to update it.`"
    >unknown model</span>
  </div>
</template>

<script setup>
import { ref, computed, watch, toRef, onMounted } from 'vue';
import { useProvidersStore } from '../stores/providers.js';

const props = defineProps({
  modelValue: {
    type: String,
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  allowEmpty: {
    type: Boolean,
    default: false,
  },
  emptyLabel: {
    type: String,
    default: 'Use system default',
  },
  selectClass: {
    type: String,
    default: '',
  },
  providerId: {
    type: String,
    default: null,
  },
  hideBuiltInDuplicates: {
    type: Boolean,
    default: true,
  },
  // Opt-in flag for pickers rendering an *existing session's* stored model
  // (not drafts, templates, project defaults, or scheduling forms). When
  // true, a disabled OR soft-removed choice matching modelValue/providerId
  // is fetched and merged in so the session keeps showing/using it without
  // an "unknown model" badge, while unrelated pickers never see it
  // (FRD-built-in-model-choices.md §0 historical continuity, Plan Phase 7).
  sessionScoped: {
    type: Boolean,
    default: false,
  },
  // Configuration forms may need to render a previously stored disabled or
  // removed value. Unlike a session-scoped historical value, this entry is
  // read-only: it documents the current setting but cannot be selected for a
  // new configuration.
  preserveCurrentValue: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'model-selected', 'update:providerId']);

const providersStore = useProvidersStore();

// Check if providers have models loaded
// Providers may have been fetched without models (e.g., from ProvidersView)
const providersHaveModels = computed(() => providersStore.providers.length > 0 &&
    providersStore.providers.some(p => p.models && p.models.length > 0));

const shouldPreserveCurrentValue = computed(() => props.sessionScoped || props.preserveCurrentValue);

// Get all valid model IDs from all providers
const validModelIds = computed(() => {
  const ids = new Set();
  for (const provider of visibleProviders.value) {
    if (provider.models) {
      for (const model of provider.models) {
        ids.add(model.modelId);
      }
    }
  }
  return ids;
});

// Check if a model ID is valid (exists as an option)
function isValidModelId(modelId) {
  return modelId && validModelIds.value.has(modelId);
}

// Map a provider kind to an agent type. Default to 'claude-code' when `kind`
// is absent so legacy providers (pre-Phase-1) keep their Claude Code grouping.
function agentTypeFor(provider) {
  if (provider?.kind === 'openai') return 'codex';
  if (provider?.kind === 'google') return 'gemini';
  return 'claude-code';
}

// Human-readable agent heading for optgroup labels.
function agentLabelFor(provider) {
  const type = agentTypeFor(provider);
  if (type === 'codex') return 'Codex';
  if (type === 'gemini') return 'Gemini';
  return 'Claude Code';
}

// Sort providers by:
//   1) Agent type: Claude Code first, then Gemini, then Codex
//   2) Built-in before custom within the same agent
//   3) Alphabetical by name among custom providers
const AGENT_SORT_ORDER = { 'claude-code': 0, 'gemini': 1, 'codex': 2 };
const sortedProviders = computed(() => {
  const list = [...providersStore.providers].filter((p) => p.enabled !== false);
  list.sort((a, b) => {
    const aType = agentTypeFor(a);
    const bType = agentTypeFor(b);
    const aWeight = AGENT_SORT_ORDER[aType] ?? 99;
    const bWeight = AGENT_SORT_ORDER[bType] ?? 99;
    if (aWeight !== bWeight) return aWeight - bWeight;
    if (a.isBuiltIn !== b.isBuiltIn) {
      return a.isBuiltIn ? -1 : 1;
    }
    return (a.name || '').localeCompare(b.name || '');
  });
  return list;
});

const visibleProviders = computed(() => {
  const customModelIds = new Set();
  for (const provider of providersStore.providers) {
    if (provider.isBuiltIn || !provider.models) continue;
    for (const model of provider.models) {
      if (model.enabled !== false || resolveModelId(props.modelValue) === model.modelId) {
        customModelIds.add(model.modelId);
      }
    }
  }

  const providers = sortedProviders.value
    .map((provider) => withDisabledModelsHidden(
      provider,
      sessionScopedKeepModelIds(provider),
      props.preserveCurrentValue && !props.sessionScoped,
    ))
    .map((provider) => {
      if (!props.hideBuiltInDuplicates || !provider.isBuiltIn) return provider;
      return withCustomModelsHidden(provider, customModelIds);
    });

  return withHistoricalEntryMerged(providers).filter((provider) => provider.models?.length);
});

// ── Session-scoped historical continuity (disabled OR soft-removed) ────
// Disabled-but-not-removed choices are already present in provider.models
// (just filtered by withDisabledModelsHidden above, and un-hidden there when
// they match the current value). Soft-removed choices are excluded from the
// bulk providers payload entirely, so a session-scoped picker fetches that
// one historical row separately and merges it in here.
const historicalEntry = ref(null); // { providerId, model } | null

function hasActiveMatch(modelId, providerId) {
  if (!modelId) return true;
  return providersStore.providers.some((provider) => {
    if (providerId && provider.id !== providerId) return false;
    return (provider.models || []).some((model) => model.modelId === modelId);
  });
}

// Which provider the preserved current value belongs to. Always prefer the
// provider that actually owns the model id (covers disabled OpenAI/Gemini
// models on a session whose `providerId` was never stored -- e.g. a session
// created via the API with only `model` set), then a built-in model-id
// prefix inference for a soft-removed row not present in the bulk payload.
// Session-scoped pickers fall back to the built-in Anthropic provider only as
// a last resort (legacy tier aliases like 'sonnet' with no owning provider).
// Configuration forms (non-session-scoped) return null in that last-resort
// case instead, since they have no session context to default to.
const currentValueProviderId = computed(() => {
  if (props.providerId) return props.providerId;
  const owningProvider = providersStore.providers.find(providerHasCurrentModel);
  if (owningProvider) return owningProvider.id;
  const inferred = inferredBuiltInProviderId(resolveModelId(props.modelValue));
  if (inferred) return inferred;
  if (!props.sessionScoped) return null;
  return providersStore.providers.find(
    (p) => p.isBuiltIn && agentTypeFor(p) === 'claude-code'
  )?.id || null;
});

function providerHasCurrentModel(provider) {
  return (provider.models || []).some((model) => model.modelId === resolveModelId(props.modelValue));
}

// Older template and schedule records predate provider ids. Built-in model ids
// have stable provider prefixes, so they remain recoverable even after their
// catalog row has been soft-removed. Custom removed rows need an explicit
// provider id and intentionally remain unknown rather than guessing.
function inferredBuiltInProviderId(modelId) {
  if (!modelId) return null;
  const kind = modelId.startsWith('gpt-') ? 'openai'
    : modelId.startsWith('gemini-') ? 'google'
      : modelId.startsWith('claude-') ? 'anthropic'
        : null;
  return providersStore.providers.find((provider) => provider.isBuiltIn && provider.kind === kind)?.id || null;
}

// Disabled rows stay hidden by default. A session can preserve its own current
// choice as selectable; configuration forms explicitly opt in to preserve a
// stored value as a disabled, read-only entry. No unrelated picker sees it.
function sessionScopedKeepModelIds(provider) {
  if (!shouldPreserveCurrentValue.value || provider.id !== currentValueProviderId.value) return new Set();
  return new Set([resolveModelId(props.modelValue)].filter(Boolean));
}

watch(
  () => [shouldPreserveCurrentValue.value, props.modelValue, props.providerId, providersHaveModels.value],
  async () => {
    historicalEntry.value = null;
    if (!shouldPreserveCurrentValue.value || !props.modelValue || !providersHaveModels.value) return;
    if (hasActiveMatch(props.modelValue, props.providerId)) return;

    const targetProviderId = currentValueProviderId.value;
    if (!targetProviderId) return;

    const model = await providersStore.fetchHistoricalModel(targetProviderId, props.modelValue);
    if (model && model.modelId === props.modelValue) {
      historicalEntry.value = { providerId: targetProviderId, model };
    }
  },
  { immediate: true },
);

function withHistoricalEntryMerged(providers) {
  const entry = historicalEntry.value;
  if (!entry) return providers;

  const alreadyPresent = providers.some(
    (provider) => provider.id === entry.providerId && provider.models?.some((model) => model.modelId === entry.model.modelId),
  );
  if (alreadyPresent) return providers;

  const targetIndex = providers.findIndex((provider) => provider.id === entry.providerId);
  if (targetIndex !== -1) {
    return providers.map((provider, index) => (
      index === targetIndex
        ? { ...provider, models: [...(provider.models || []), unavailableHistoricalModel(entry.model)] }
        : provider
    ));
  }

  const sourceProvider = providersStore.providers.find((provider) => provider.id === entry.providerId);
  return sourceProvider
    ? [...providers, { ...sourceProvider, models: [unavailableHistoricalModel(entry.model)] }]
    : providers;
}

function unavailableHistoricalModel(model) {
  return props.preserveCurrentValue && !props.sessionScoped ? { ...model, unavailable: true } : model;
}

const duplicateModelIds = computed(() => {
  const counts = new Map();
  for (const provider of visibleProviders.value) {
    for (const model of provider.models || []) {
      counts.set(model.modelId, (counts.get(model.modelId) || 0) + 1);
    }
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([modelId]) => modelId));
});

function withCustomModelsHidden(provider, customModelIds) {
  return {
    ...provider,
    models: (provider.models || []).filter((model) => !customModelIds.has(model.modelId)),
  };
}

// Disabled choices stay valid for historical sessions, but are hidden from
// new selections. Explicit preservation either keeps a session usable or
// renders a configuration form's stored choice as read-only.
function withDisabledModelsHidden(provider, keepModelIds, markPreservedUnavailable = false) {
  return {
    ...provider,
    models: (provider.models || [])
      .filter((model) => model.enabled !== false || keepModelIds.has(model.modelId))
      .map((model) => (
        markPreservedUnavailable && model.enabled === false && keepModelIds.has(model.modelId)
          ? { ...model, unavailable: true }
          : model
      )),
  };
}

// Default model resolution honours Phase 6 rules:
//   - Prefer the first built-in Anthropic provider's sonnet (or first) model.
//   - If NO Anthropic providers exist at all, return null rather than silently
//     selecting a Codex model (Codex has no "default" concept in the UI yet).
const defaultModel = computed(() => {
  const anthropicProviders = providersStore.providers.filter(
    (p) => agentTypeFor(p) === 'claude-code' && p.enabled !== false
  );
  if (anthropicProviders.length === 0) {
    return null;
  }
  const builtIn = anthropicProviders.find((p) => p.isBuiltIn);
  const candidate = builtIn || anthropicProviders[0];
  const enabledModels = candidate?.models?.filter((model) => model.enabled !== false) || [];
  if (enabledModels.length) {
    const sonnet = enabledModels.find((m) => m.tier === 'sonnet');
    return sonnet?.modelId || enabledModels[0].modelId;
  }
  return null;
});

// Track if we've already initialized (to prevent default model from overriding after init)
const hasInitialized = ref(false);

// Fetch providers with models on mount
onMounted(async () => {
  // Fetch if no providers OR if providers exist but don't have models loaded
  if (providersStore.providers.length === 0 || !providersHaveModels.value) {
    await providersStore.fetchProviders();
  }

  // Don't emit default - let parent component control model selection
  // This prevents overriding project defaults with the component's internal default
  hasInitialized.value = true;
});

// Helper to convert tier names (e.g., 'sonnet') to full model IDs
// This handles legacy/shorthand values that don't match actual option values
function resolveModelId(modelValue) {
  if (!modelValue) return null;

  // If it's already a full model ID (contains 'claude-'), use as-is
  if (modelValue.includes('claude-')) {
    return modelValue;
  }

  // It's a tier name like 'sonnet', 'opus', 'haiku' - find matching model
  // (only resolve against an Anthropic built-in; Codex has no tier map)
  const builtIn = providersStore.providers.find(
    (p) => p.isBuiltIn && agentTypeFor(p) === 'claude-code'
  );
  if (builtIn?.models?.length) {
    const match = builtIn.models.find(m => m.tier === modelValue);
    if (match) {
      return match.modelId;
    }
  }

  // Fallback: return as-is (will show empty if no match, but at least we tried)
  return modelValue;
}

// Local state for optimistic UI updates - provides immediate visual feedback
const selectedModel = ref(resolveModelId(props.modelValue));
const selectedProviderId = ref(props.providerId);

// True when the parent supplied a non-empty model id that no longer matches any
// option in the catalog (e.g. a model retired since the value was stored). We
// surface this as a visible badge instead of silently substituting the default,
// so stale config is obvious. Null/empty (unset) is NOT "unknown".
const isUnknownModel = computed(() => {
  if (!providersHaveModels.value) return false;
  if (!props.modelValue) return false;
  return !isValidModelId(resolveModelId(props.modelValue));
});

// Computed that ALWAYS returns a valid model ID for the select element
// This ensures the select never shows empty, even before providers load
const effectiveSelectedModel = computed(() => {
  // When allowEmpty is true and the value is empty/null, return empty string
  if (props.allowEmpty && (!selectedModel.value || selectedModel.value === '')) {
    return '';
  }
  // First, try the current selectedModel if it's valid
  if (selectedModel.value && isValidModelId(selectedModel.value)) {
    return selectedModel.value;
  }
  // Fall back to default model
  if (defaultModel.value) {
    return defaultModel.value;
  }
  // Last resort: return whatever we have (will show empty if no options loaded yet)
  return selectedModel.value;
});

const effectiveSelectedProviderId = computed(() => {
  if (!effectiveSelectedModel.value) return null;
  const option = findVisibleOption(effectiveSelectedModel.value, props.providerId || selectedProviderId.value);
  return option?.provider.id || null;
});

const effectiveSelectedKey = computed(() => {
  if (props.allowEmpty && (!effectiveSelectedModel.value || effectiveSelectedModel.value === '')) {
    return '';
  }
  if (!effectiveSelectedModel.value) return '';
  const option = findVisibleOption(effectiveSelectedModel.value, props.providerId || selectedProviderId.value);
  return option ? optionKey(option.provider.id, option.model.modelId) : effectiveSelectedModel.value;
});

// Watch for external changes to keep local selection in sync
const modelValueRef = toRef(props, 'modelValue');
watch(modelValueRef, (newModel) => {
  selectedModel.value = resolveModelId(newModel);
}, { flush: 'sync' });

watch(toRef(props, 'providerId'), (newProviderId) => {
  selectedProviderId.value = newProviderId;
}, { flush: 'sync' });

// Also watch providers - when they load, we may need to resolve tier names
// Use immediate: true to run on mount when providers might already be loaded
watch(() => providersStore.providers, syncSelectionFromProviders, { deep: true, immediate: true });

function syncSelectionFromProviders() {
  // Skip if no models loaded yet - wait for models to be available
  if (!providersHaveModels.value) return;

  // When allowEmpty is true and value is empty/null, treat empty as valid - don't auto-select
  if (props.allowEmpty && (!props.modelValue || props.modelValue === '')) {
    selectedModel.value = '';
    return;
  }

  const resolvedModel = props.modelValue ? resolveModelId(props.modelValue) : null;

  // Check if resolved model is valid (exists as an option)
  if (resolvedModel && isValidModelId(resolvedModel)) {
    applyResolvedModel(resolvedModel);
    return;
  }

  // Non-empty value that doesn't resolve to any current option — e.g. a model
  // id retired from the catalog. Don't silently overwrite the parent's stored
  // value with the default; surface the orphan via the isUnknownModel badge so
  // the staleness is visible. Display still falls back to the default through
  // the effectiveSelectedModel/effectiveSelectedKey computeds.
  if (props.modelValue) {
    selectedModel.value = resolveModelId(props.modelValue);
    return;
  }

  applyDefaultModel();
}

function applyResolvedModel(resolvedModel) {
  const resolvedProviderId = findVisibleOption(resolvedModel, props.providerId)?.provider.id || null;
  if (selectedModel.value === resolvedModel) {
    if (selectedProviderId.value !== resolvedProviderId) {
      selectedProviderId.value = resolvedProviderId;
      emit('update:providerId', resolvedProviderId);
    }
    return;
  }
  selectedModel.value = resolvedModel;
  selectedProviderId.value = resolvedProviderId;
  // Emit the resolved value back to parent if it changed
  if (resolvedModel !== props.modelValue) {
    emit('update:modelValue', resolvedModel);
  }
  if (resolvedProviderId !== props.providerId) {
    emit('update:providerId', resolvedProviderId);
  }
}

function applyDefaultModel() {
  if (!defaultModel.value || selectedModel.value === defaultModel.value) return;
  selectedModel.value = defaultModel.value;
  selectedProviderId.value = findVisibleOption(defaultModel.value)?.provider.id || null;
  emit('update:modelValue', defaultModel.value);
}

// NOTE: Removed defaultModel watcher - it should not override after initialization
// The default is now only applied once during onMounted (see above)

function handleModelChange(event) {
  const optionValue = event.target.value;
  const parsed = optionValue ? parseOptionKey(optionValue) : null;
  const metadata = parsed
    ? {
        modelId: parsed.modelId,
        providerId: parsed.providerId,
        kind: providerKindForId(parsed.providerId),
      }
    : { modelId: '', providerId: null, kind: null };
  const modelId = metadata.modelId;

  if (effectiveSelectedModel.value === modelId && effectiveSelectedProviderId.value === metadata.providerId) return;

  // Immediate visual feedback - update UI right away
  selectedModel.value = modelId;
  selectedProviderId.value = metadata.providerId;

  // Emit for v-model (empty string when allowEmpty option is selected)
  emit('update:modelValue', modelId);
  emit('update:providerId', metadata.providerId);
  emit('model-selected', metadata);
}

function providerKindForId(providerId) {
  if (!providerId) return null;
  const provider = providersStore.providers.find((entry) => entry.id === providerId);
  return provider?.kind || 'anthropic';
}

function optionKey(providerId, modelId) {
  return `${providerId}::${modelId}`;
}

function parseOptionKey(value) {
  const separatorIndex = value.indexOf('::');
  if (separatorIndex === -1) return null;
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 2),
  };
}

function findVisibleOption(modelId, providerId = null) {
  if (!modelId) return null;
  for (const provider of visibleProviders.value) {
    if (providerId && provider.id !== providerId) continue;
    const model = provider.models?.find((entry) => entry.modelId === modelId);
    if (model) return { provider, model };
  }
  // If the requested provider is not visible, still select a visible option for
  // the requested model. This can happen when built-in duplicate models are
  // hidden in favor of a custom provider.
  for (const provider of visibleProviders.value) {
    const model = provider.models?.find((entry) => entry.modelId === modelId);
    if (model) return { provider, model };
  }
  return null;
}

function optionLabel(provider, model) {
  const baseLabel = provider.isBuiltIn ? model.displayName : model.modelId;
  const disambiguated = duplicateModelIds.value.has(model.modelId) ? `${baseLabel} (${provider.name})` : baseLabel;
  return model.unavailable ? `${disambiguated} (currently set — unavailable for new selection)` : disambiguated;
}
</script>

<style scoped>
.model-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.unknown-model-badge {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-warning, #fbbf24);
  background-color: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.4);
  padding: 0.15rem 0.4rem;
  border-radius: 0.375rem;
  cursor: help;
  white-space: nowrap;
  line-height: 1.4;
}

.model-select {
  appearance: none;
  padding: 0.375rem 2rem 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M1.5 4.5l4.5 4 4.5-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 12px;
  padding-right: 2rem;
}

.model-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.model-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1);
}

.model-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-select option {
  background-color: var(--color-background);
  color: var(--color-text);
}
</style>
