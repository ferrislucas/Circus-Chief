<template>
  <div
    class="model-selector"
    :data-model="effectiveSelectedModel"
  >
    <select
      id="model-select"
      :value="effectiveSelectedModel"
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
          :key="model.id"
          :value="model.modelId"
          :data-provider-id="provider.id"
          :data-agent-type="agentTypeFor(provider)"
        >
          {{ provider.isBuiltIn ? model.displayName : model.modelId }}
        </option>
      </optgroup>
    </select>
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
});

const emit = defineEmits(['update:modelValue', 'model-selected', 'update:providerId']);

const providersStore = useProvidersStore();

// Check if providers have models loaded
// Providers may have been fetched without models (e.g., from ProvidersView)
const providersHaveModels = computed(() => providersStore.providers.length > 0 &&
    providersStore.providers.some(p => p.models && p.models.length > 0));

// Get all valid model IDs from all providers
const validModelIds = computed(() => {
  const ids = new Set();
  for (const provider of providersStore.providers) {
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
  return 'claude-code';
}

// Human-readable agent heading for optgroup labels.
function agentLabelFor(provider) {
  return agentTypeFor(provider) === 'codex' ? 'Codex' : 'Claude Code';
}

// Sort providers by:
//   1) Agent type: Claude Code first, then Codex
//   2) Built-in before custom within the same agent
//   3) Alphabetical by name among custom providers
const sortedProviders = computed(() => {
  const list = [...providersStore.providers];
  list.sort((a, b) => {
    const aType = agentTypeFor(a);
    const bType = agentTypeFor(b);
    if (aType !== bType) {
      return aType === 'claude-code' ? -1 : 1;
    }
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
      if (!provider.isBuiltIn) return provider;
      return withCustomModelsHidden(provider, customModelIds);
    })
    .filter((provider) => provider.models?.length);
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
    (p) => agentTypeFor(p) === 'claude-code'
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

// Watch for external changes to keep local selection in sync
const modelValueRef = toRef(props, 'modelValue');
watch(modelValueRef, (newModel) => {
  selectedModel.value = resolveModelId(newModel);
}, { flush: 'sync' });

// Also watch providers - when they load, we may need to resolve tier names
// Use immediate: true to run on mount when providers might already be loaded
watch(() => providersStore.providers, () => {
  // Skip if no models loaded yet - wait for models to be available
  if (!providersHaveModels.value) return;

  // When allowEmpty is true and value is empty/null, treat empty as valid - don't auto-select
  if (props.allowEmpty && (!props.modelValue || props.modelValue === '')) {
    selectedModel.value = '';
    return;
  }

  // First, try to resolve the model ID from props
  let resolvedModel = null;
  if (props.modelValue) {
    resolvedModel = resolveModelId(props.modelValue);
  }

  // Check if resolved model is valid (exists as an option)
  if (resolvedModel && isValidModelId(resolvedModel)) {
    if (selectedModel.value !== resolvedModel) {
      selectedModel.value = resolvedModel;
      // Emit the resolved value back to parent if it changed
      if (resolvedModel !== props.modelValue) {
        emit('update:modelValue', resolvedModel);
      }
    }
  } else if (defaultModel.value) {
    // Model is invalid or not provided - use default
    if (selectedModel.value !== defaultModel.value) {
      selectedModel.value = defaultModel.value;
      emit('update:modelValue', defaultModel.value);
    }
  }
}, { deep: true, immediate: true });

// NOTE: Removed defaultModel watcher - it should not override after initialization
// The default is now only applied once during onMounted (see above)

function handleModelChange(event) {
  const option = event.target.selectedOptions?.[0] || null;
  const optionValue = event.target.value;
  const metadata = optionValue
    ? {
        modelId: optionValue,
        providerId: option?.dataset?.providerId || null,
        kind: providerKindForId(option?.dataset?.providerId),
      }
    : { modelId: '', providerId: null, kind: null };
  const modelId = metadata.modelId;

  if (effectiveSelectedModel.value === modelId && (!props.providerId || props.providerId === metadata.providerId)) return;

  // Immediate visual feedback - update UI right away
  selectedModel.value = modelId;

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
</script>

<style scoped>
.model-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
