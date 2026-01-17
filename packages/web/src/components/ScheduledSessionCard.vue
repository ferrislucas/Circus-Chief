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
      <button @click="showEditModal = true" class="btn btn-secondary btn-small" :disabled="loading">
        Edit Schedule
      </button>
      <button @click="handleCancel" class="btn btn-danger btn-small" :disabled="loading">
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

.btn-danger {
  background: #dc2626;
  color: white;
  border: 1px solid #dc2626;
  border-radius: var(--border-radius, 4px);
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
