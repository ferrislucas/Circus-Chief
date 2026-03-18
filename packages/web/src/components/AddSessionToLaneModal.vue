<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Add Session to {{ laneName }}</h2>
        <button @click="close" class="close-btn" aria-label="Close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Search input -->
        <div class="form-group">
          <label for="session-search" class="form-label">Search Sessions</label>
          <input
            id="session-search"
            type="text"
            v-model="searchQuery"
            class="form-input"
            placeholder="Search by name..."
            @input="handleSearch"
          />
        </div>

        <!-- Sessions list -->
        <div class="sessions-list">
          <div v-if="loading" class="loading-state">
            <span class="loading-spinner"></span>
            Loading sessions...
          </div>

          <div v-else-if="filteredSessions.length === 0" class="empty-state">
            <p v-if="searchQuery">No sessions matching "{{ searchQuery }}"</p>
            <p v-else>No available sessions to add.</p>
          </div>

          <div
            v-else
            v-for="session in filteredSessions"
            :key="session.id"
            class="session-item"
            :class="{ selected: selectedSessionId === session.id }"
            @click="selectSession(session.id)"
          >
            <div class="session-status" :class="`status-${session.status}`">
              {{ getStatusIndicator(session.status) }}
            </div>
            <div class="session-info">
              <div class="session-name">{{ session.name }}</div>
              <div class="session-meta">
                <span v-if="session.mode" class="session-mode">{{ session.mode }}</span>
                <span class="session-date">{{ formatDate(session.updatedAt || session.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button @click="close" class="btn btn-secondary">Cancel</button>
        <button
          @click="handleAdd"
          class="btn btn-primary"
          :disabled="!selectedSessionId || adding"
        >
          {{ adding ? 'Adding...' : 'Add to Lane' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useUiStore } from '../stores/ui.js';
import { api } from '../composables/useApi.js';

const props = defineProps({
  isOpen: Boolean,
  projectId: String,
  laneId: String,
  laneName: String,
});

const emit = defineEmits(['close', 'update:isOpen', 'added']);

const sessionsStore = useSessionsStore();
const kanbanStore = useKanbanStore();
const uiStore = useUiStore();

const loading = ref(false);
const adding = ref(false);
const searchQuery = ref('');
const selectedSessionId = ref(null);
const availableSessions = ref([]);

// Filter out sessions that are already on the board
const filteredSessions = computed(() => {
  let sessions = availableSessions.value.filter((s) => {
    // Check if session is already on the board
    return !kanbanStore.isSessionOnBoard(s.id);
  });

  // Filter to only root sessions (no parent)
  sessions = sessions.filter((s) => !s.parentSessionId);

  // Apply search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    sessions = sessions.filter((s) =>
      s.name?.toLowerCase().includes(query)
    );
  }

  return sessions;
});

function getStatusIndicator(status) {
  switch (status) {
    case 'running':
    case 'starting':
      return '\u25CF'; // filled circle
    case 'waiting':
      return '\u25D0'; // half-filled circle
    case 'completed':
      return '\u2713'; // check mark
    case 'error':
      return '\u2715'; // X mark
    case 'stopped':
      return '\u25A0'; // filled square
    case 'scheduled':
      return '\u23F0'; // alarm clock
    default:
      return '\u25CB'; // empty circle
  }
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function selectSession(sessionId) {
  selectedSessionId.value = sessionId;
}

function handleSearch() {
  // Search is reactive via computed
}

function close() {
  emit('update:isOpen', false);
  emit('close');
  // Reset state
  searchQuery.value = '';
  selectedSessionId.value = null;
}

async function loadSessions() {
  if (!props.projectId) return;

  loading.value = true;
  try {
    // Fetch active sessions for this project
    const sessions = await api.getProjectSessions(props.projectId, false, null);
    availableSessions.value = Array.isArray(sessions) ? sessions : sessions?.sessions || [];
  } catch (err) {
    console.error('Failed to load sessions:', err);
    uiStore.error('Failed to load sessions');
    availableSessions.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAdd() {
  if (!selectedSessionId.value || !props.laneId) return;

  adding.value = true;
  try {
    await kanbanStore.addSessionToBoard(props.projectId, selectedSessionId.value, props.laneId);
    uiStore.success('Session added to board');
    emit('added', selectedSessionId.value);
    close();
  } catch (err) {
    console.error('Failed to add session to board:', err);
    uiStore.error(err.message || 'Failed to add session to board');
  } finally {
    adding.value = false;
  }
}

// Load sessions when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      loadSessions();
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem;
  flex: 1;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--color-text);
}

.form-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 0.95rem;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(34, 197, 255, 0.1);
}

.sessions-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--color-text-soft);
}

.session-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.15s;
}

.session-item:last-child {
  border-bottom: none;
}

.session-item:hover {
  background: var(--color-bg-soft);
}

.session-item.selected {
  background: rgba(34, 197, 255, 0.1);
  border-color: var(--color-primary);
}

.session-status {
  flex-shrink: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.session-status.status-running,
.session-status.status-starting {
  color: #10b981;
}

.session-status.status-waiting {
  color: #f59e0b;
}

.session-status.status-completed {
  color: #3b82f6;
}

.session-status.status-error,
.session-status.status-stopped {
  color: #ef4444;
}

.session-status.status-scheduled {
  color: #6b7280;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
  margin-top: 0.25rem;
}

.session-mode {
  text-transform: capitalize;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
  transition: opacity 0.2s, background-color 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
