<template>
  <div
    class="model-selector"
    :data-model="effectiveSelectedModel"
    :data-provider-id="effectiveSelectedProviderId || ''"
  >
    <!-- Tier badge: shown when a tier ref is currently selected (F11) -->
    <span
      v-if="isTierRef(effectiveSelectedModel)"
      class="tier-chip"
      :title="tierChipTitle"
    >Tier: {{ tierChipName }}</span>
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
      <!-- Tiers optgroup (shown only when tiers with ≥1 member exist) -->
      <optgroup
        v-if="tiersWithMembers.length > 0"
        label="Model Tiers"
      >
        <option
          v-for="tier in tiersWithMembers"
          :key="`tier::${tier.id}`"
          :value="`tier::${tier.id}`"
        >
          {{ tier.name }}{{ tier.description ? ` — ${tier.description}` : '' }}
        </option>
      </optgroup>

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
import { useTiersStore, isTierRef } from '../stores/tiers.js';

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
});

// defineEmits requires a literal array (Vue compiler macro constraint) — the
// event name constants used by every emit() call below are declared after it.
const emit = defineEmits(['update:modelValue', 'model-selected', 'update:providerId']);

// Event name constants (avoid repeating the literal strings across every emit() call below)
const EVT_UPDATE_MODEL_VALUE = 'update:modelValue';
const EVT_UPDATE_PROVIDER_ID = 'update:providerId';
const EVT_MODEL_SELECTED = 'model-selected';

const providersStore = useProvidersStore();
const tiersStore = useTiersStore();

// Tiers with at least one member (shown in the optgroup)
const tiersWithMembers = computed(() =>
  tiersStore.tiers.filter((t) => t.members && t.members.length > 0)
);

// Tier chip: name and tooltip for the selected tier (when a tier ref is active)
const tierChipName = computed(() => {
  if (!isTierRef(effectiveSelectedModel.value)) return '';
  const tierId = effectiveSelectedModel.value.slice('tier::'.length);
  const tier = tiersStore.getById(tierId);
  return tier?.name || tierId;
});

const tierChipTitle = computed(() => {
  if (!isTierRef(effectiveSelectedModel.value)) return '';
  const tierId = effectiveSelectedModel.value.slice('tier::'.length);
  const tier = tiersStore.getById(tierId);
  const memberCount = tier?.members?.length ?? 0;
  return tier
    ? `Model tier "${tier.name}" — ${memberCount} member${memberCount !== 1 ? 's' : ''}`
    : `Tier: ${tierId}`;
});

// Check if providers have models loaded
// Providers may have been fetched without models (e.g., from ProvidersView)
const providersHaveModels = computed(() => providersStore.providers.length > 0 &&
    providersStore.providers.some(p => p.models && p.models.length > 0));

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

// Check if a model ID is valid (exists as an option, or is a valid tier ref)
function isValidModelId(modelId) {
  if (!modelId) return false;
  if (isTierRef(modelId)) {
    // Valid if the tier exists with ≥1 member (or tiers haven't loaded yet — be permissive)
    const tierId = modelId.slice('tier::'.length);
    return tiersStore.tiers.length === 0 || tiersWithMembers.value.some((t) => t.id === tierId);
  }
  return validModelIds.value.has(modelId);
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
      customModelIds.add(model.modelId);
    }
  }

  return sortedProviders.value
    .map((provider) => {
      if (!props.hideBuiltInDuplicates || !provider.isBuiltIn) return provider;
      return withCustomModelsHidden(provider, customModelIds);
    })
    .filter((provider) => provider.models?.length);
});

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
  if (candidate?.models?.length) {
    const sonnet = candidate.models.find((m) => m.tier === 'sonnet');
    return sonnet?.modelId || candidate.models[0].modelId;
  }
  return null;
});

// Track if we've already initialized (to prevent default model from overriding after init)
const hasInitialized = ref(false);

// Fetch providers with models on mount
onMounted(async () => {
  // Fetch if no providers OR if providers exist but don't have models loaded
  const providersFetch = (providersStore.providers.length === 0 || !providersHaveModels.value)
    ? providersStore.fetchProviders()
    : Promise.resolve();

  // Also fetch tiers if not yet loaded
  const tiersFetch = tiersStore.tiers.length === 0
    ? tiersStore.fetchTiers()
    : Promise.resolve();

  await Promise.all([providersFetch, tiersFetch]);

  // Don't emit default - let parent component control model selection
  // This prevents overriding project defaults with the component's internal default
  hasInitialized.value = true;
});

// Helper to convert tier names (e.g., 'sonnet') to full model IDs
// This handles legacy/shorthand values that don't match actual option values
function resolveModelId(modelValue) {
  if (!modelValue) return null;

  // Tier refs are always valid as-is — no resolution needed
  if (isTierRef(modelValue)) {
    return modelValue;
  }

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
  // Tier refs have no concrete provider at selection time
  if (isTierRef(effectiveSelectedModel.value)) return null;
  const option = findVisibleOption(effectiveSelectedModel.value, props.providerId || selectedProviderId.value);
  return option?.provider.id || null;
});

const effectiveSelectedKey = computed(() => {
  if (props.allowEmpty && (!effectiveSelectedModel.value || effectiveSelectedModel.value === '')) {
    return '';
  }
  if (!effectiveSelectedModel.value) return '';
  // Tier refs map directly to the option value (no provider::model encoding needed)
  if (isTierRef(effectiveSelectedModel.value)) {
    return effectiveSelectedModel.value;
  }
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

  // Tier refs don't need provider resolution — handle them directly
  if (resolvedModel && isTierRef(resolvedModel)) {
    if (selectedModel.value !== resolvedModel) {
      selectedModel.value = resolvedModel;
      selectedProviderId.value = null;
    }
    return;
  }

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
      emit(EVT_UPDATE_PROVIDER_ID, resolvedProviderId);
    }
    return;
  }
  selectedModel.value = resolvedModel;
  selectedProviderId.value = resolvedProviderId;
  // Emit the resolved value back to parent if it changed
  if (resolvedModel !== props.modelValue) {
    emit(EVT_UPDATE_MODEL_VALUE, resolvedModel);
  }
  if (resolvedProviderId !== props.providerId) {
    emit(EVT_UPDATE_PROVIDER_ID, resolvedProviderId);
  }
}

function applyDefaultModel() {
  if (!defaultModel.value || selectedModel.value === defaultModel.value) return;
  selectedModel.value = defaultModel.value;
  selectedProviderId.value = findVisibleOption(defaultModel.value)?.provider.id || null;
  emit(EVT_UPDATE_MODEL_VALUE, defaultModel.value);
}

// NOTE: Removed defaultModel watcher - it should not override after initialization
// The default is now only applied once during onMounted (see above)

function handleModelChange(event) {
  const optionValue = event.target.value;

  // Tier ref selected — option value IS the tier ref
  if (optionValue && isTierRef(optionValue)) {
    if (effectiveSelectedModel.value === optionValue) return;

    selectedModel.value = optionValue;
    selectedProviderId.value = null;

    emit(EVT_UPDATE_MODEL_VALUE, optionValue);
    emit(EVT_UPDATE_PROVIDER_ID, null);
    emit(EVT_MODEL_SELECTED, { modelId: optionValue, providerId: null, kind: null, tierId: optionValue.slice('tier::'.length) });
    return;
  }

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
  emit(EVT_UPDATE_MODEL_VALUE, modelId);
  emit(EVT_UPDATE_PROVIDER_ID, metadata.providerId);
  emit(EVT_MODEL_SELECTED, metadata);
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
  if (!duplicateModelIds.value.has(model.modelId)) return baseLabel;
  return `${baseLabel} (${provider.name})`;
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

/* Tier chip badge shown alongside the selector when a tier is selected (F11) */
.tier-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  background-color: rgba(6, 182, 212, 0.15);
  color: #06b6d4;
  border: 1px solid rgba(6, 182, 212, 0.3);
  border-radius: 0.25rem;
  white-space: nowrap;
  cursor: default;
}
</style>
