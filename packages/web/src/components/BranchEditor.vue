<template>
  <div class="branch-editor">
    <div class="branch-editor-header">
      <span class="branch-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 2v8M4 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 6c0 2 2 4 4 4h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="branch-title">Create branch from this message</span>
    </div>

    <div class="branch-editor-body">
      <div class="branch-name-row">
        <label class="branch-label">Branch name (optional)</label>
        <input
          ref="nameInput"
          v-model="branchName"
          type="text"
          class="form-input branch-name-input"
          placeholder="e.g., Try different approach..."
          @keydown.enter.prevent="handleCreate"
          @keydown.escape="handleCancel"
        />
      </div>

      <div class="branch-prompt-row">
        <label class="branch-label">Initial prompt (optional)</label>
        <textarea
          ref="promptInput"
          v-model="initialPrompt"
          class="form-input branch-prompt-input"
          placeholder="Enter a new prompt to start the branch with..."
          rows="3"
          @keydown.ctrl.enter="handleCreate"
          @keydown.meta.enter="handleCreate"
          @keydown.escape="handleCancel"
        ></textarea>
        <div class="prompt-hint">Leave empty to just create the branch without a new message</div>
      </div>
    </div>

    <div class="branch-editor-footer">
      <button
        type="button"
        class="btn btn-ghost"
        @click="handleCancel"
        :disabled="creating"
      >
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        @click="handleCreate"
        :disabled="creating"
      >
        <span v-if="creating" class="loading-spinner"></span>
        {{ creating ? 'Creating...' : 'Create Branch' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const props = defineProps({
  messageId: { type: String, required: true },
});

const emit = defineEmits(['create', 'cancel']);

const branchName = ref('');
const initialPrompt = ref('');
const creating = ref(false);
const nameInput = ref(null);
const promptInput = ref(null);

onMounted(() => {
  // Focus the name input when the component mounts
  if (nameInput.value) {
    nameInput.value.focus();
  }
});

function handleCreate() {
  if (creating.value) return;

  creating.value = true;
  emit('create', {
    messageId: props.messageId,
    name: branchName.value.trim() || null,
    prompt: initialPrompt.value.trim() || null,
  });
}

function handleCancel() {
  emit('cancel');
}

// Expose a method to reset the creating state (called by parent on error)
function resetCreating() {
  creating.value = false;
}

defineExpose({ resetCreating });
</script>

<style scoped>
.branch-editor {
  margin-top: 0.75rem;
  padding: 1rem;
  background: rgba(139, 92, 246, 0.05);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 0.5rem;
  animation: slideDown 0.15s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.branch-editor-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  color: var(--color-text);
}

.branch-icon {
  display: flex;
  align-items: center;
  color: rgba(139, 92, 246, 0.9);
}

.branch-title {
  font-weight: 600;
  font-size: 0.875rem;
}

.branch-editor-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.branch-name-row,
.branch-prompt-row {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.branch-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-soft);
}

.branch-name-input {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}

.branch-prompt-input {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 60px;
}

.prompt-hint {
  font-size: 0.6875rem;
  color: var(--color-text-soft);
  font-style: italic;
}

.branch-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-background-soft);
  color: var(--color-text);
}

.btn-primary {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  min-width: 120px;
}

.loading-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
  margin-right: 0.25rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
