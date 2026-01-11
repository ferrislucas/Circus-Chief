<template>
  <div class="mode-selector">
    <label for="mode-select" class="mode-label">Mode:</label>
    <select
      id="mode-select"
      :value="selectedMode"
      @change="handleModeChange($event.target.value)"
      :disabled="disabled || togglingMode"
      class="mode-select"
    >
      <option v-for="m in modes" :key="m.value" :value="m.value">
        {{ m.label }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, computed, watch, toRef } from 'vue';
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
const togglingMode = ref(false);

const modes = [
  { value: 'plan', label: 'Plan', description: 'Agent plans before implementing' },
  { value: 'standard', label: 'Standard', description: 'Balanced approach' },
  { value: 'yolo', label: 'YOLO', description: 'Auto-approve mode' },
];

// Use store state when sessionId provided, otherwise use modelValue prop
const currentMode = computed(() => {
  if (props.sessionId) {
    return sessionsStore.currentSession?.mode;
  }
  return props.modelValue;
});

// Local state for optimistic UI updates - provides immediate visual feedback
const selectedMode = ref(currentMode.value);

// Watch for external changes to keep local selection in sync
// Create a ref from the modelValue prop for reliable reactivity tracking
const modelValueRef = toRef(props, 'modelValue');

// Watch both the computed and the prop ref to ensure we catch all changes
watch([currentMode, modelValueRef], ([newCurrentMode]) => {
  selectedMode.value = newCurrentMode;
}, { flush: 'sync' });

async function handleModeChange(value) {
  if (togglingMode.value) return;
  if (selectedMode.value === value) return;

  // Immediate visual feedback - update UI right away
  selectedMode.value = value;

  if (props.sessionId) {
    // Session context: update store asynchronously
    togglingMode.value = true;
    try {
      await sessionsStore.updateSessionMode(props.sessionId, value);
    } catch (err) {
      // Revert selection on error
      selectedMode.value = currentMode.value;
      uiStore.error(err.message);
    } finally {
      togglingMode.value = false;
    }
  } else {
    // Form context: emit for v-model
    emit('update:modelValue', value);
  }
}
</script>

<style scoped>
.mode-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mode-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.mode-select {
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

.mode-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.mode-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1);
}

.mode-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-select option {
  background-color: var(--color-background);
  color: var(--color-text);
}
</style>
