<template>
  <div class="scheduled-child-card">
    <!-- Header -->
    <div class="card-header">
      <div class="session-info">
        <button
          class="session-name-link"
          data-testid="scheduled-session-name-btn"
          @click="handleSessionClick"
        >
          <h4 class="session-name">
            {{ session.name }}
          </h4>
        </button>
      </div>
      <span class="status-badge status-scheduled">scheduled</span>
    </div>

    <!-- Timing Info -->
    <div
      v-if="hasScheduledTime"
      class="timing-info"
    >
      <div class="timing-item">
        <span class="timing-icon">⏰</span>
        <div class="timing-details">
          <span class="timing-text">{{ scheduledTimeDisplay }}</span>
          <span class="timing-absolute">{{ absoluteTimeDisplay }}</span>
        </div>
        <div class="timing-actions">
          <button
            class="btn-link timing-action-btn"
            :disabled="loading"
            @click="showEditModal = true"
          >
            Edit
          </button>
          <button
            class="btn-link timing-action-btn btn-cancel"
            :disabled="loading"
            @click="handleCancel"
          >
            Cancel
          </button>
        </div>
      </div>

      <div
        v-if="session.autoRescheduleEnabled"
        class="timing-item"
      >
        <span class="timing-icon">🔄</span>
        <div class="timing-details">
          <span class="timing-text">Auto-reschedule</span>
          <span class="timing-absolute">
            Attempt {{ session.rescheduleCount }}/{{ session.maxRescheduleCount || '∞' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Orchestration Panel -->
    <OrchestrationPanel
      :session-id="session.id"
      :project-id="projectId"
      :current-template-id="session.nextTemplateId"
      session-status="scheduled"
      :is-draft="false"
      :input-has-content="true"
      :auto-reschedule-enabled="session.autoRescheduleEnabled"
      :hide-schedule-row="true"
      @update:template-id="handleTemplateChange"
      @open-auto-reschedule="showAutoRescheduleModal = true"
      @open-schedule="() => {}"
    />

    <!-- Edit Schedule Modal -->
    <SchedulingEditModal
      :is-open="showEditModal"
      :session="session"
      @close="showEditModal = false"
      @saved="() => {}"
    />

    <!-- Auto-Reschedule Modal -->
    <AutoRescheduleModal
      :is-open="showAutoRescheduleModal"
      :session="session"
      @close="showAutoRescheduleModal = false"
      @saved="() => {}"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import OrchestrationPanel from './OrchestrationPanel.vue';
import SchedulingEditModal from './SchedulingEditModal.vue';
import AutoRescheduleModal from './AutoRescheduleModal.vue';

const props = defineProps({
  session: { type: Object, required: true },
  projectId: { type: String, required: true },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);
const showEditModal = ref(false);
const showAutoRescheduleModal = ref(false);

const emit = defineEmits(['open-session-overlay']);

function handleSessionClick() {
  emit('open-session-overlay', props.session.id);
}

const hasScheduledTime = computed(() => props.session.status === 'scheduled' && Boolean(props.session.scheduledAt));

const scheduledTimeDisplay = computed(() => {
  if (!hasScheduledTime.value) return '';
  const time = new Date(props.session.scheduledAt);
  return formatDistanceToNow(time, { addSuffix: true });
});

const absoluteTimeDisplay = computed(() => {
  if (!hasScheduledTime.value) return '';
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
    uiStore.error(`Failed to cancel session: ${error.message}`);
  } finally {
    loading.value = false;
  }
}

async function handleTemplateChange(templateId) {
  try {
    await sessionsStore.updateNextTemplate(props.session.id, templateId);
  } catch (err) {
    uiStore.error(err.message);
  }
}
</script>

<style scoped>
.scheduled-child-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--border-radius, 4px);
  background: var(--color-background, rgba(255, 255, 255, 0.02));
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

.session-name-link {
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  display: block;
  width: 100%;
  text-decoration: none;
  transition: color 0.2s;
}

.session-name-link:hover .session-name {
  color: var(--color-primary, #22c5ff);
}

.session-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
  transition: color 0.2s;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.status-scheduled {
  background: rgba(34, 197, 255, 0.2);
  color: #22c5ff;
  border: 1px solid rgba(34, 197, 255, 0.3);
}

.timing-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.timing-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.timing-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.timing-details {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1;
}

.timing-text {
  color: var(--color-text);
  font-weight: 500;
}

.timing-absolute {
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}

.timing-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  padding: 0;
  color: var(--color-primary);
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  color: var(--color-error, #cf222e);
}
</style>
