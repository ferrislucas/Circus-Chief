<template>
  <div class="arguments-form">
    <div class="form-header">
      <h3 class="command-title">/{{ command.name }}</h3>
      <p v-if="command.description" class="command-description">{{ command.description }}</p>
    </div>

    <form @submit.prevent="handleSubmit" class="form-fields">
      <!-- Skill arguments (simple text input) -->
      <template v-if="command.isSkill">
        <div class="form-field">
          <label for="skill-args" class="field-label">
            Arguments
            <span v-if="command.argumentHint" class="hint">{{ command.argumentHint }}</span>
          </label>
          <input
            id="skill-args"
            type="text"
            v-model="skillRawArgs"
            :placeholder="command.argumentHint || 'Enter arguments...'"
            class="field-input"
            data-testid="skill-args-input"
            @keydown.enter.prevent="handleSubmit"
          />
        </div>
      </template>

      <!-- Structured command arguments -->
      <template v-else>
        <div
          v-for="arg in command.arguments"
          :key="arg.name"
          class="form-field"
        >
          <label :for="`arg-${arg.name}`" class="field-label">
            {{ arg.label }}
            <span v-if="arg.required" class="required-indicator">*</span>
          </label>

          <!-- Select type -->
          <select
            v-if="arg.type === 'select'"
            :id="`arg-${arg.name}`"
            v-model="formData[arg.name]"
            :required="arg.required"
            class="field-select"
            :data-testid="`arg-${arg.name}`"
          >
            <option value="" disabled>Select an option...</option>
            <option
              v-for="opt in arg.options || []"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>

          <!-- Multiline type -->
          <textarea
            v-else-if="arg.type === 'multiline'"
            :id="`arg-${arg.name}`"
            v-model="formData[arg.name]"
            :required="arg.required"
            :placeholder="arg.placeholder || ''"
            class="field-textarea"
            rows="4"
            :data-testid="`arg-${arg.name}`"
          ></textarea>

          <!-- Text type (default) -->
          <input
            v-else
            type="text"
            :id="`arg-${arg.name}`"
            v-model="formData[arg.name]"
            :required="arg.required"
            :placeholder="arg.placeholder || ''"
            class="field-input"
            :data-testid="`arg-${arg.name}`"
          />
        </div>
      </template>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="emit('back')">
          Back
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="!isValid || executing"
          data-testid="execute-command-btn"
        >
          <span v-if="executing" class="loading-spinner"></span>
          {{ executeLabel }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';

const props = defineProps({
  command: { type: Object, required: true },
  executing: { type: Boolean, default: false },
  executeLabel: { type: String, default: 'Execute Command' },
});

const emit = defineEmits(['back', 'submit']);

// Initialize form data with defaults
const formData = ref({});

// For skills: raw arguments string
const skillRawArgs = ref('');

// Initialize form data when command changes
function initFormData() {
  const data = {};
  for (const arg of props.command.arguments || []) {
    data[arg.name] = arg.default !== undefined ? arg.default : '';
  }
  formData.value = data;
}

onMounted(() => {
  initFormData();
});

watch(() => props.command, () => {
  initFormData();
});

// Validation
const isValid = computed(() => {
  // Skills are always valid (args are optional)
  if (props.command.isSkill) {
    return true;
  }

  // For commands, validate required fields
  for (const arg of props.command.arguments || []) {
    if (arg.required) {
      const value = formData.value[arg.name];
      if (value === undefined || value === null || value === '') {
        return false;
      }
    }
  }
  return true;
});

function handleSubmit() {
  if (!isValid.value || props.executing) return;

  // For skills, submit raw args
  if (props.command.isSkill) {
    emit('submit', { _raw: skillRawArgs.value });
    return;
  }

  // For commands, submit structured args
  emit('submit', formData.value);
}
</script>

<style scoped>
.arguments-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.command-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-accent);
  font-family: ui-monospace, monospace;
}

.command-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

.required-indicator {
  color: var(--color-danger, #ef4444);
  margin-left: 0.125rem;
}

.hint {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--color-text-soft);
  font-family: ui-monospace, monospace;
}

.field-input,
.field-select,
.field-textarea {
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s;
}

.field-input:focus,
.field-select:focus,
.field-textarea:focus {
  border-color: var(--color-accent);
}

.field-input::placeholder,
.field-textarea::placeholder {
  color: var(--color-text-soft);
}

.field-textarea {
  resize: vertical;
  min-height: 100px;
}

.field-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  padding-right: 2.5rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.btn-primary {
  background: var(--color-primary, #3b82f6);
  border: 1px solid var(--color-primary, #3b82f6);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #2563eb);
  border-color: var(--color-primary-hover, #2563eb);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
}

.btn-secondary:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-hover);
}

.loading-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Mobile responsive */
@media (max-width: 480px) {
  .form-actions {
    flex-direction: column-reverse;
  }

  .btn {
    width: 100%;
  }
}
</style>
