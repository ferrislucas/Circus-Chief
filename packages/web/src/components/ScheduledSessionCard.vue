<template>
  <div class="scheduled-session-card card">
    <!-- Header -->
    <div class="card-header">
      <div class="session-info">
        <h3 class="session-name">{{ session.name }}</h3>
        <p class="session-project" v-if="session.projectName">
          <span class="project-name">{{ session.projectName }}</span>
        </p>
      </div>
      <div class="status-badge-container">
        <button @click="showEditModal = true" class="edit-btn" title="Edit schedule">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <span class="status-badge status-scheduled">scheduled</span>
      </div>
    </div>

    <!-- Timing Info -->
    <div class="timing-info">
      <div class="timing-item">
        <span class="timing-icon">⏰</span>
        <div class="timing-details">
          <span class="timing-text">{{ scheduledTimeDisplay }}</span>
          <span class="timing-absolute">{{ absoluteTimeDisplay }}</span>
        </div>
      </div>

      <div v-if="session.autoRescheduleEnabled" class="timing-item">
        <span class="timing-icon">🔄</span>
        <div class="timing-details">
          <span class="timing-text">Auto-reschedule</span>
          <span class="timing-absolute">
            Attempt {{ session.rescheduleCount }}/{{ session.maxRescheduleCount || '∞' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="card-actions">
      <button @click="handleStartNow" class="btn btn-primary btn-small" :disabled="loading">
        {{ loading ? 'Loading...' : 'Start Now' }}
      </button>
      <button @click="handleCancel" class="btn btn-secondary btn-small" :disabled="loading">
        Cancel
      </button>
    </div>

    <!-- Edit Schedule Modal -->
    <SchedulingEditModal
      :is-open="showEditModal"
      :session="session"
      @close="showEditModal = false"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import SchedulingEditModal from './SchedulingEditModal.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);
const showEditModal = ref(false);

const scheduledTimeDisplay = computed(() => {
  const time = new Date(props.session.scheduledAt);
  return formatDistanceToNow(time, { addSuffix: true });
});

const absoluteTimeDisplay = computed(() => {
  const time = new Date(props.session.scheduledAt);
  return format(time, 'MMM d, h:mm a');
});

async function handleStartNow() {
  loading.value = true;
  try {
    // Update session status to 'starting' and clear scheduled time
    await sessionsStore.updateSessionFields(props.session.id, {
      status: 'starting',
      scheduledAt: null,
    });

    uiStore.success('Session started');
  } catch (error) {
    console.error('Failed to start session:', error);
    uiStore.error('Failed to start session: ' + error.message);
  } finally {
    loading.value = false;
  }
}

async function handleCancel() {
  if (!confirm('Cancel this scheduled session?')) {
    return;
  }

  loading.value = true;
  try {
    await sessionsStore.updateSessionFields(props.session.id, {
      status: 'stopped',
    });

    uiStore.success('Session cancelled');
  } catch (error) {
    console.error('Failed to cancel session:', error);
    uiStore.error('Failed to cancel session: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function handleSaved() {
  // Modal handles closing itself
  // Session updates come via WebSocket
}
</script>

<style scoped>
.scheduled-session-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  margin: 0 0 0.25rem 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
}

.session-project {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.project-name {
  color: var(--color-text-soft);
}

.status-badge-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.edit-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: var(--border-radius, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, background 0.2s;
}

.edit-btn:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.1);
}

.status-badge {
  display: inline-block;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.status-scheduled {
  background: rgba(34, 197, 255, 0.2);
  color: #22c5ff;
  border: 1px solid rgba(34, 197, 255, 0.3);
}

.timing-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--color-background, rgba(255, 255, 255, 0.02));
  border-radius: var(--border-radius, 4px);
}

.timing-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.95rem;
}

.timing-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.timing-details {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.timing-text {
  color: var(--color-text);
  font-weight: 500;
}

.timing-absolute {
  font-size: 0.825rem;
  color: var(--color-text-soft);
}

.card-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn-small {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: 1px solid var(--color-primary);
  border-radius: var(--border-radius, 4px);
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius, 4px);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-text);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
