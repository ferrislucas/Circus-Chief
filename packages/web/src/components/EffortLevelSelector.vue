<template>
  <div class="effort-selector">
    <select
      id="effort-select"
      :value="selectedLevel"
      @change="handleChange($event.target.value)"
      :disabled="disabled || toggling"
      class="effort-select"
    >
      <option v-for="l in levels" :key="l.value" :value="l.value">
        {{ l.label }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, computed, watch, toRef } from 'vue';
import { EFFORT_LEVELS } from '@claudetools/shared';
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
const toggling = ref(false);

// Reorder so "auto" comes first in the dropdown
const sortedLevels = ['auto', ...EFFORT_LEVELS.filter(l => l !== 'auto')];
const levels = sortedLevels.map(level => ({
  value: level,
  label: level.charAt(0).toUpperCase() + level.slice(1) + ' Effort',
}));

// Use store state when sessionId provided, otherwise use modelValue prop
const currentLevel = computed(() => {
  if (props.sessionId) {
    return sessionsStore.currentSession?.effortLevel || 'auto';
  }
  return props.modelValue || 'auto';
});

// Local state for optimistic UI updates
const selectedLevel = ref(currentLevel.value);

const modelValueRef = toRef(props, 'modelValue');

watch([currentLevel, modelValueRef], ([newLevel]) => {
  selectedLevel.value = newLevel || 'auto';
}, { flush: 'sync' });

async function handleChange(value) {
  if (toggling.value) return;
  if (selectedLevel.value === value) return;

  selectedLevel.value = value;

  if (props.sessionId) {
    // Session context: update store asynchronously
    toggling.value = true;
    try {
      await sessionsStore.updateSession(props.sessionId, {
        effortLevel: value === 'auto' ? null : value,
      });
    } catch (err) {
      selectedLevel.value = currentLevel.value;
      uiStore.error(err.message);
    } finally {
      toggling.value = false;
    }
  } else {
    // Form context: emit for v-model
    emit('update:modelValue', value === 'auto' ? null : value);
  }
}
</script>

<style scoped>
.effort-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.effort-select {
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

.effort-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.effort-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1);
}

.effort-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.effort-select option {
  background-color: var(--color-background);
  color: var(--color-text);
}
</style>
