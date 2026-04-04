<template>
  <Teleport to="body">
    <div v-if="isOpen" class="dialog-overlay" @click.self="handleCancel">
      <div class="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="dialog-header">
          <h2 :id="titleId" class="dialog-title">{{ isEditing ? 'Edit Quick Response' : 'Add Quick Response' }}</h2>
          <button class="close-button" @click="handleCancel" aria-label="Close dialog">&times;</button>
        </div>

        <form @submit.prevent="handleSubmit" class="dialog-form">
          <div class="dialog-content">
            <!-- Label field -->
            <div class="form-group">
              <label for="qr-label" class="form-label">Label *</label>
              <input
                id="qr-label"
                ref="labelInput"
                v-model="form.label"
                type="text"
                class="form-input"
                placeholder="e.g., Yes, LGTM, Run tests"
                maxlength="50"
                required
                @blur="form.label = form.label.trim()"
              />
              <span class="form-help">Short text shown on the button (max 50 characters)</span>
              <span v-if="labelError" class="form-error">{{ labelError }}</span>
            </div>

            <!-- Content field -->
            <div class="form-group">
              <label for="qr-content" class="form-label">Content *</label>
              <textarea
                id="qr-content"
                v-model="form.content"
                class="form-textarea"
                placeholder="The full message that will be inserted into the prompt"
                rows="4"
                maxlength="10000"
                required
              ></textarea>
              <span class="form-help">The full message that will be inserted (max 10,000 characters)</span>
              <span v-if="contentError" class="form-error">{{ contentError }}</span>
            </div>

            <!-- Category field (optional) -->
            <div class="form-group">
              <label for="qr-category" class="form-label">Category (optional)</label>
              <input
                id="qr-category"
                v-model="form.category"
                type="text"
                class="form-input"
                placeholder="e.g., feedback, commands"
                maxlength="50"
              />
              <span class="form-help">Optional grouping for organization</span>
            </div>

            <!-- Auto-submit option -->
            <div class="form-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  v-model="form.autoSubmit"
                  class="checkbox-input"
                />
                <span class="checkbox-text">Auto-submit</span>
              </label>
              <span class="form-help indent">Send immediately when clicked (no confirmation)</span>
            </div>

            <!-- Scope selection (only for new responses) -->
            <div v-if="!isEditing" class="form-group">
              <span class="form-label">Scope</span>
              <div class="radio-group">
                <label class="radio-label">
                  <input
                    type="radio"
                    v-model="form.isGlobal"
                    :value="false"
                    class="radio-input"
                  />
                  <span class="radio-text">Project-specific</span>
                </label>
                <label class="radio-label">
                  <input
                    type="radio"
                    v-model="form.isGlobal"
                    :value="true"
                    class="radio-input"
                  />
                  <span class="radio-text">Global (all projects)</span>
                </label>
              </div>
            </div>

            <!-- Error message -->
            <div v-if="error" class="error-message">{{ error }}</div>
          </div>

          <!-- Actions - fixed at bottom -->
          <div class="dialog-footer">
            <button type="button" class="btn btn-secondary" @click="handleCancel">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="!isValid || saving">
              {{ saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Save Quick Response') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    required: true,
  },
  editingResponse: {
    type: Object,
    default: null,
  },
  defaultIsGlobal: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'saved']);

const store = useQuickResponsesStore();
const labelInput = ref(null);
const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;

const form = ref({
  label: '',
  content: '',
  category: '',
  autoSubmit: false,
  isGlobal: false,
});

const saving = ref(false);
const error = ref(null);

const isEditing = computed(() => !!props.editingResponse);

const labelError = computed(() => {
  if (form.value.label && form.value.label.length > 50) {
    return 'Label must be 50 characters or less';
  }
  return null;
});

const contentError = computed(() => {
  if (form.value.content && form.value.content.length > 10000) {
    return 'Content must be 10,000 characters or less';
  }
  return null;
});

const isValid = computed(() => {
  return (
    form.value.label.trim().length > 0 &&
    form.value.label.length <= 50 &&
    form.value.content.trim().length > 0 &&
    form.value.content.length <= 10000
  );
});

// Reset form when dialog opens
watch(() => props.isOpen, (open) => {
  if (open) {
    if (props.editingResponse) {
      form.value = {
        label: props.editingResponse.label || '',
        content: props.editingResponse.content || '',
        category: props.editingResponse.category || '',
        autoSubmit: props.editingResponse.autoSubmit || false,
        isGlobal: props.editingResponse.projectId === null,
      };
    } else {
      form.value = {
        label: '',
        content: '',
        category: '',
        autoSubmit: false,
        isGlobal: props.defaultIsGlobal,
      };
    }
    error.value = null;

    // Focus label input on open
    nextTick(() => {
      labelInput.value?.focus();
    });
  }
});

// Handle escape key
watch(() => props.isOpen, (open) => {
  if (open) {
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }
});

function handleCancel() {
  emit('close');
}

async function handleSubmit() {
  if (!isValid.value || saving.value) return;

  saving.value = true;
  error.value = null;

  try {
    const data = {
      label: form.value.label.trim(),
      content: form.value.content,
      category: form.value.category.trim() || null,
      autoSubmit: form.value.autoSubmit,
    };

    if (isEditing.value) {
      await store.updateResponse(props.editingResponse.id, data);
    } else {
      data.isGlobal = form.value.isGlobal;
      await store.createResponse(props.projectId, data);
    }

    emit('saved');
    emit('close');
  } catch (err) {
    error.value = err.message || 'Failed to save quick response';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1015;
}

.dialog {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg, 12px);
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dialog-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-button {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.close-button:hover {
  color: var(--color-text);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

.form-input,
.form-textarea {
  padding: 0.625rem 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-help {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.form-help.indent {
  margin-left: 1.5rem;
}

.form-error {
  font-size: 0.75rem;
  color: var(--color-danger, #ef4444);
}

.checkbox-label,
.radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.checkbox-input,
.radio-input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--color-accent);
}

.checkbox-text,
.radio-text {
  font-size: 0.875rem;
  color: var(--color-text);
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.error-message {
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--border-radius);
  color: #ef4444;
  font-size: 0.875rem;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.btn {
  padding: 0.625rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-mute);
}

.btn-primary {
  background: var(--color-accent, #22d3ee);
  border: 1px solid var(--color-accent, #22d3ee);
  color: var(--color-background, #0d1117);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
