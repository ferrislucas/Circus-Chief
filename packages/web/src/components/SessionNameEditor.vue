<template>
  <template v-if="isEditingName">
    <div class="name-edit-form">
      <input
        ref="nameEditInput"
        v-model="editNameValue"
        type="text"
        class="name-edit-input"
        placeholder="Session name"
        @keyup.enter="saveSessionName"
        @keyup.escape="cancelEditName"
      >
      <button
        class="btn-icon pr-edit-btn pr-save-btn"
        title="Save"
        @click="saveSessionName"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
      <button
        class="btn-icon pr-edit-btn pr-cancel-btn"
        title="Cancel"
        @click="cancelEditName"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line
            x1="18"
            y1="6"
            x2="6"
            y2="18"
          />
          <line
            x1="6"
            y1="6"
            x2="18"
            y2="18"
          />
        </svg>
      </button>
      <button
        v-if="editNameValue"
        class="btn-icon pr-edit-btn pr-clear-btn"
        title="Clear name"
        @click="clearSessionName"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  </template>
  <template v-else>
    <div class="session-name-wrapper">
      <h3 class="session-name">
        {{ session.name }}
      </h3>
      <span
        v-if="session.archived"
        class="archived-badge"
        aria-label="Archived session"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect
            width="20"
            height="5"
            x="2"
            y="3"
            rx="1"
          />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
        Archived
      </span>
      <button
        class="btn-link name-edit-trigger"
        title="Edit session name"
        @click="startEditName"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </div>
  </template>
</template>

<script setup>
import { nextTick, ref } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { useSessionsStore } from '../stores/sessions.js';
import { api } from '../composables/useApi.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  session: {
    type: Object,
    required: true,
  },
});

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();

const isEditingName = ref(false);
const editNameValue = ref('');
const nameEditInput = ref(null);

function startEditName() {
  editNameValue.value = props.session?.name || '';
  isEditingName.value = true;
}

function cancelEditName() {
  isEditingName.value = false;
  editNameValue.value = '';
}

function clearSessionName() {
  editNameValue.value = '';
  nextTick(() => {
    nameEditInput.value?.focus();
  });
}

async function saveSessionName() {
  const newName = editNameValue.value.trim();
  const sessionId = props.sessionId;

  if (!newName) {
    uiStore.error('Session name cannot be empty');
    return;
  }

  try {
    const updated = await api.updateSession(sessionId, {
      name: newName,
      manuallyNamed: true
    });
    sessionsStore.updateSession({ ...updated, id: sessionId });
    uiStore.success('Session name updated');
    isEditingName.value = false;
    editNameValue.value = '';
  } catch (err) {
    uiStore.error(err.message || 'Failed to update session name');
  }
}

defineExpose({
  isEditingName,
  editNameValue,
  startEditName,
  cancelEditName,
  clearSessionName,
  saveSessionName,
});
</script>

<style scoped>
.session-name-wrapper {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.session-name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  min-width: 0;
}

.archived-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.5rem;
  padding: 0.1875rem 0.5rem;
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.14);
  color: #fbbf24;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}

.archived-badge svg {
  flex-shrink: 0;
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

.name-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.name-edit-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 200px;
  max-width: 400px;
}

.name-edit-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.name-edit-input::placeholder {
  color: var(--color-text-soft, #888);
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

.name-edit-trigger {
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

.name-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}

@media (max-width: 768px) {
  .session-name-wrapper {
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 0.375rem;
    row-gap: 0.25rem;
  }

  .name-edit-trigger {
    grid-column: 2;
    grid-row: 1;
  }

  .session-name {
    font-size: 1rem;
  }

  .archived-badge {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: start;
    font-size: 0.6875rem;
    min-height: 1.375rem;
  }
}
</style>
