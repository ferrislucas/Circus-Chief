<template>
  <div v-if="isEditing" class="pr-edit-form">
    <input
      v-model="editValue"
      type="url"
      class="pr-url-input"
      placeholder="https://github.com/owner/repo/pull/123"
      @keyup.enter="save"
      @keyup.escape="cancel"
    />
    <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="save">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </button>
    <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="cancel">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
    <button v-if="editValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear PR URL" @click="clear">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  </div>
  <template v-else>
    <PrIndicators
      v-if="prUrl"
      :pr-url="prUrl"
      :summary="summary"
    />
    <button class="btn-link pr-edit-trigger" @click="startEdit" :title="prUrl ? 'Edit PR URL' : 'Add PR URL'">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      <span v-if="!prUrl">Link PR</span>
    </button>
  </template>
</template>

<script setup>
import { ref } from 'vue';
import PrIndicators from './PrIndicators.vue';
import { useUiStore } from '../stores/ui.js';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from '../stores/sessions.js';

const props = defineProps({
  /** The current session ID */
  sessionId: {
    type: String,
    required: true,
  },
  /** The current PR URL (may be null/empty) */
  prUrl: {
    type: String,
    default: '',
  },
  /** Summary object for PrIndicators */
  summary: {
    type: Object,
    default: null,
  },
});

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();

const isEditing = ref(false);
const editValue = ref('');

/** GitHub PR URL validation pattern */
const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

function startEdit() {
  editValue.value = props.prUrl || '';
  isEditing.value = true;
}

function cancel() {
  isEditing.value = false;
  editValue.value = '';
}

async function save() {
  const newPrUrl = editValue.value.trim();

  // Validate if not empty
  if (newPrUrl) {
    if (!PR_URL_PATTERN.test(newPrUrl)) {
      uiStore.error('Invalid PR URL format. Must be a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)');
      return;
    }
  }

  try {
    const updated = await api.updateSession(props.sessionId, { prUrl: newPrUrl || null });
    sessionsStore.updateSession({ ...updated, id: props.sessionId });
    uiStore.success(newPrUrl ? 'PR URL updated' : 'PR URL cleared');
    isEditing.value = false;
    editValue.value = '';
  } catch (err) {
    uiStore.error(err.message || 'Failed to update PR URL');
  }
}

async function clear() {
  editValue.value = '';
  await save();
}

defineExpose({ isEditing, editValue, startEdit, cancel, save, clear, PR_URL_PATTERN });
</script>

<style scoped>
.pr-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pr-url-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 280px;
  max-width: 400px;
}

.pr-url-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.pr-url-input::placeholder {
  color: var(--color-text-soft, #888);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.pr-edit-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.pr-save-btn {
  color: var(--color-success, #4caf50);
}

.pr-save-btn:hover {
  background: rgba(76, 175, 80, 0.1);
}

.pr-cancel-btn {
  color: var(--color-text-soft, #888);
}

.pr-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.pr-clear-btn {
  color: var(--color-error, #f44336);
}

.pr-clear-btn:hover {
  background: rgba(244, 67, 54, 0.1);
}

.pr-edit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft, #888);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.pr-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}

@media (max-width: 480px) {
  .pr-url-input {
    min-width: 180px;
    max-width: 100%;
  }

  .pr-edit-form {
    flex-wrap: wrap;
  }
}
</style>
