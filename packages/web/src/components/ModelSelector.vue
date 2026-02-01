<template>
  <div class="model-selector" :data-model="selectedModel">
    <select
      id="model-select"
      :value="selectedModel"
      @change="handleModelChange($event.target.value)"
      :disabled="disabled"
      class="model-select"
    >
      <optgroup v-for="provider in providersStore.providers" :key="provider.id" :label="provider.name">
        <option
          v-for="model in provider.models"
          :key="model.id"
          :value="model.modelId"
          :data-provider-id="provider.id"
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
});

const emit = defineEmits(['update:modelValue']);

const providersStore = useProvidersStore();

// Check if providers have models loaded
// Providers may have been fetched without models (e.g., from ProvidersView)
const providersHaveModels = computed(() => {
  return providersStore.providers.length > 0 &&
    providersStore.providers.some(p => p.models && p.models.length > 0);
});

// Get default model from first available provider
const defaultModel = computed(() => {
  // Prefer built-in Anthropic provider's sonnet model
  const builtIn = providersStore.providers.find(p => p.isBuiltIn);
  if (builtIn?.models?.length) {
    // Find sonnet tier if available, otherwise first model
    const sonnet = builtIn.models.find(m => m.tier === 'sonnet');
    return sonnet?.modelId || builtIn.models[0].modelId;
  }
  // Fallback to first provider's first model
  const firstProvider = providersStore.providers[0];
  return firstProvider?.models?.[0]?.modelId || null;
});

// Track if we've already initialized (to prevent default model from overriding after init)
const hasInitialized = ref(false);

// Fetch providers with models on mount
onMounted(async () => {
  // Fetch if no providers OR if providers exist but don't have models loaded
  if (providersStore.providers.length === 0 || !providersHaveModels.value) {
    await providersStore.fetchProvidersWithModels();
  }

  // Only set default on initial mount if no model was provided
  if (!hasInitialized.value && props.modelValue === null && defaultModel.value) {
    emit('update:modelValue', defaultModel.value);
  }
  hasInitialized.value = true;
});

// Local state for optimistic UI updates - provides immediate visual feedback
const selectedModel = ref(props.modelValue);

// Watch for external changes to keep local selection in sync
const modelValueRef = toRef(props, 'modelValue');
watch(modelValueRef, (newModel) => {
  selectedModel.value = newModel;
}, { flush: 'sync' });

// NOTE: Removed defaultModel watcher - it should not override after initialization
// The default is now only applied once during onMounted (see above)

function handleModelChange(modelId) {
  if (selectedModel.value === modelId) return;

  // Immediate visual feedback - update UI right away
  selectedModel.value = modelId;

  // Emit for v-model
  emit('update:modelValue', modelId);
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
