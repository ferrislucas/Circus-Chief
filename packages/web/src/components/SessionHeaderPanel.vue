<template>
  <div class="session-header">
    <!-- Main header row with status, name, and menu -->
    <div class="session-header-row">
      <!-- Session name -->
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
          />
          <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="saveSessionName">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
          <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="cancelEditName">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <button v-if="editNameValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear name" @click="clearSessionName">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </template>
      <template v-else>
        <div class="session-name-wrapper">
          <h3 class="session-name">{{ session.name }}</h3>
          <button class="btn-link name-edit-trigger" @click="startEditName" title="Edit session name">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
      </template>

      <!-- Overflow menu with secondary actions -->
      <OverflowMenu
        aria-label="Session actions"
        :is-archived="session.archived"
        :is-deleting="isDeleting"
        copy-session-id-text="Copy ID"
        @duplicate="emit('duplicate')"
        @copySessionId="emit('copySessionId')"
        @archive="emit('archive')"
        @delete="emit('delete')"
      />
    </div>

    <!-- PR indicators and command button status bar -->
    <div class="branch-pr-indicators">
      <div class="left-indicators">
        <!-- Star button (icon only) -->
        <button
          class="btn-icon btn-star"
          :title="session.starred ? 'Unstar session' : 'Star session'"
          :class="{ 'is-starred': session.starred }"
          @click="emit('star')"
        >
          <svg v-if="session.starred" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
        </button>
        <PrUrlEditor
          :session-id="sessionId"
          :pr-url="session.prUrl"
          :summary="summary"
        />
      </div>

      <!-- Command button status indicators for real-time status updates -->
      <CommandButtonStatusBar :button-statuses="buttonStatuses" :session-id="sessionId" />
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import OverflowMenu from './OverflowMenu.vue';
import PrUrlEditor from './PrUrlEditor.vue';
import CommandButtonStatusBar from './CommandButtonStatusBar.vue';
import { useUiStore } from '../stores/ui.js';
import { useSessionsStore } from '../stores/sessions.js';
import { api } from '../composables/useApi.js';

const props = defineProps({
  /** The current session ID */
  sessionId: {
    type: String,
    required: true,
  },
  /** The session object */
  session: {
    type: Object,
    required: true,
  },
  /** Summary object for PrIndicators */
  summary: {
    type: Object,
    default: null,
  },
  /** Whether the session is currently being deleted */
  isDeleting: {
    type: Boolean,
    default: false,
  },
  /** Command button statuses to display */
  buttonStatuses: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['duplicate', 'copySessionId', 'archive', 'delete', 'star']);

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();

// Name editing state
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

defineExpose({ isEditingName, editNameValue, startEditName, cancelEditName, clearSessionName, saveSessionName });
</script>

<style scoped>
.session-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  padding: 0 0.5rem;
}

.session-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.session-name-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
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

.btn-star {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.btn-star svg {
  flex-shrink: 0;
}

.btn-star.is-starred {
  color: var(--color-warning, #f0ad4e);
}

.session-name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.4;
}

.branch-pr-indicators {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.left-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

@media (max-width: 768px) {
  .session-header-row {
    align-items: flex-start;
    min-height: auto;
    padding-top: 0.25rem;
  }

  .session-name {
    font-size: 1rem;
  }
}

/* Name editing styles */
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
</style>
