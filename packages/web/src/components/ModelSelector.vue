<template>
  <div class="model-selector">
    <label for="model-select" class="model-label">Model:</label>
    <select
      id="model-select"
      :value="selectedModel"
      @change="handleModelChange($event.target.value)"
      :disabled="disabled || togglingModel"
      class="model-select"
    >
      <optgroup v-for="provider in providersStore.providers" :key="provider.id" :label="provider.name">
        <option
          v-for="model in provider.models"
          :key="model.id"
          :value="model.modelId"
          :data-provider-id="provider.id"
        >
          {{ model.displayName }}
        </option>
      </optgroup>
    </select>
  </div>
</template>

<script setup>
import { ref, computed, watch, toRef, onMounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: {
    type: String,
    default: null,
  },
  modelValue: {
    type: String,
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'update:providerId']);

const sessionsStore = useSessionsStore();
const providersStore = useProvidersStore();
const uiStore = useUiStore();
const togglingModel = ref(false);

// Fetch providers with models on mount
onMounted(async () => {
  if (providersStore.providers.length === 0) {
    await providersStore.fetchProvidersWithModels();
  }
});

// Use store state when sessionId provided, otherwise use modelValue prop
const currentModel = computed(() => {
  if (props.sessionId) {
    return sessionsStore.currentSession?.model;
  }
  return props.modelValue;
});

// Local state for optimistic UI updates - provides immediate visual feedback
const selectedModel = ref(currentModel.value);

// Watch for external changes to keep local selection in sync
// Create a ref from the modelValue prop for reliable reactivity tracking
const modelValueRef = toRef(props, 'modelValue');

// Watch both the computed and the prop ref to ensure we catch all changes
watch([currentModel, modelValueRef], ([newCurrentModel]) => {
  selectedModel.value = newCurrentModel;
}, { flush: 'sync' });

async function handleModelChange(modelId) {
  if (togglingModel.value) return;
  if (selectedModel.value === modelId) return;

  // Find the provider for this model
  let providerId = null;
  for (const provider of providersStore.providers) {
    if (provider.models) {
      const model = provider.models.find((m) => m.modelId === modelId);
      if (model) {
        providerId = provider.id;
        break;
      }
    }
  }

  // Immediate visual feedback - update UI right away
  selectedModel.value = modelId;

  if (props.sessionId) {
    // Session context: update store asynchronously
    togglingModel.value = true;
    try {
      await sessionsStore.updateSessionModel(props.sessionId, modelId);
    } catch (err) {
      // Revert selection on error
      selectedModel.value = currentModel.value;
      uiStore.error(err.message);
    } finally {
      togglingModel.value = false;
    }
  } else {
    // Form context: emit for v-model
    emit('update:modelValue', modelId);
    emit('update:providerId', providerId);
  }
}
</script>

<style scoped>
.model-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.model-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
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
