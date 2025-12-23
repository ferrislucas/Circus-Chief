<template>
  <div class="model-selector">
    <span class="model-label">Model:</span>
    <div class="model-buttons">
      <button
        v-for="m in models"
        :key="m.id"
        type="button"
        :class="['model-btn', { active: modelValue === m.id }]"
        @click="selectModel(m.id)"
        :disabled="disabled"
        :title="m.description"
      >
        {{ m.name }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { CLAUDE_MODELS } from '@claudetools/shared';

defineProps({
  modelValue: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

function selectModel(id) {
  emit('update:modelValue', id);
}

const models = CLAUDE_MODELS;
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
}

.model-btn:last-child {
  border-right: none;
}

.model-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.model-btn.active {
  background: var(--color-primary);
  color: white;
}

.model-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
