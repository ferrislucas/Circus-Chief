<template>
  <div class="model-selector">
    <span class="model-label">Model:</span>
    <div class="model-buttons">
      <button
        v-for="m in models"
        :key="m.id"
        type="button"
        :class="['model-btn', { active: currentModel === m.id }]"
        @click="handleModelChange(m.id)"
        :disabled="disabled || togglingModel"
        :title="m.description"
      >
        {{ m.name }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { CLAUDE_MODELS } from '@claudetools/shared';
import { useSessionsStore } from '../stores/sessions.js';
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

const emit = defineEmits(['update:modelValue']);

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const models = CLAUDE_MODELS;
const togglingModel = ref(false);

// Use store state when sessionId provided, otherwise use modelValue prop
const currentModel = computed(() => {
  if (props.sessionId) {
    return sessionsStore.currentSession?.model;
  }
  return props.modelValue;
});

async function handleModelChange(id) {
  if (togglingModel.value) return;
  if (currentModel.value === id) return;

  if (props.sessionId) {
    // Session context: update store directly for immediate visual feedback
    togglingModel.value = true;
    try {
      await sessionsStore.updateSessionModel(props.sessionId, id);
    } catch (err) {
      uiStore.error(err.message);
    } finally {
      togglingModel.value = false;
    }
  } else {
    // Form context: emit for v-model
    emit('update:modelValue', id);
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

.model-buttons {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  overflow: hidden;
}

.model-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-background);
  border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  user-select: none;
  -webkit-user-select: none;
}

.model-btn:last-child {
  border-right: none;
}

.model-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.model-btn.active,
.model-btn.active:focus {
  background: var(--color-primary);
  color: white;
  outline: none;
}

.model-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
