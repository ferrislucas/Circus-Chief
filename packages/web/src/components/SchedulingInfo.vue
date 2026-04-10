<template>
  <!-- Scheduled Session Info -->
  <div
    v-if="session.status === 'scheduled'"
    class="scheduling-info scheduled-panel"
  >
    <div class="info-header">
      <span class="info-icon">⏰</span>
      <h3 class="info-title">
        Scheduled Session
      </h3>
    </div>

    <div class="info-content">
      <div class="countdown-section">
        <p class="countdown-text">
          Starting <strong>{{ countdownDisplay }}</strong>
        </p>
        <p class="absolute-time">
          {{ absoluteTimeDisplay }}
        </p>
      </div>

      <div
        v-if="session.autoRescheduleEnabled"
        class="reschedule-info"
      >
        <div class="reschedule-badge">
          <span class="badge-icon">🔄</span>
          <span class="badge-label">Auto-reschedule enabled</span>
        </div>
      </div>

      <div class="actions">
        <button
          class="btn btn-secondary"
          @click="showEditModal = true"
        >
          Edit Schedule
        </button>
        <button
          class="btn btn-danger"
          :disabled="loading"
          @click="handleCancelSchedule"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>

  <!-- Edit Modal for scheduled sessions -->
  <SchedulingEditModal
    v-if="session.status === 'scheduled'"
    :is-open="showEditModal"
    :session="session"
    @close="showEditModal = false"
    @saved="handleSaved"
  />
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
import { useUiStore } from '../stores/ui.js';
import SchedulingEditModal from './SchedulingEditModal.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
});

const sessionsStore = useInjectedSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);
const showEditModal = ref(false);
const countdownTime = ref(new Date());
let countdownInterval = null;

const countdownDisplay = computed(() => formatDistanceToNow(new Date(props.session.scheduledAt), { addSuffix: true }));

const absoluteTimeDisplay = computed(() => format(new Date(props.session.scheduledAt), 'EEEE, MMMM d, yyyy h:mm a'));

async function handleCancelSchedule() {
  if (!confirm('Cancel the scheduled session?')) return;

  loading.value = true;
  try {
    await sessionsStore.updateSessionFields(props.session.id, {
      status: 'stopped',
      scheduledAt: null,
    });
    uiStore.showToast('Schedule cancelled', 'success');
  } catch (error) {
    uiStore.showToast(`Failed to cancel schedule: ${  error.message}`, 'error');
  } finally {
    loading.value = false;
  }
}

function handleSaved() {
  // Settings updated, modal will close
}

// Update countdown display every second
onMounted(() => {
  countdownInterval = setInterval(() => {
    countdownTime.value = new Date();
  }, 1000);
});

onUnmounted(() => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
});
</script>

<style scoped>
.scheduling-info {
  border-radius: var(--border-radius, 6px);
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.scheduled-panel {
  background: linear-gradient(135deg, rgba(34, 197, 255, 0.1) 0%, rgba(34, 197, 255, 0.05) 100%);
  border: 1px solid rgba(34, 197, 255, 0.3);
  border-left: 4px solid var(--color-primary);
}

.configure-reschedule-panel {
  margin-bottom: 1rem;
}

.configure-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--color-background, rgba(255, 255, 255, 0.02));
  border: 1px dashed rgba(34, 197, 255, 0.3);
  border-radius: var(--border-radius, 6px);
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.configure-btn:hover {
  background: rgba(34, 197, 255, 0.08);
  border-color: rgba(34, 197, 255, 0.5);
  color: var(--color-text);
}

.configure-icon {
  font-size: 1rem;
  opacity: 0.7;
}

.configure-btn:hover .configure-icon {
  opacity: 1;
}

.configure-text {
  flex: 1;
  text-align: left;
}

.configure-arrow {
  opacity: 0.5;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.configure-btn:hover .configure-arrow {
  opacity: 1;
  transform: translateX(2px);
}

.info-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.info-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.info-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.countdown-section {
  background: var(--color-background, rgba(255, 255, 255, 0.05));
  padding: 1rem;
  border-radius: var(--border-radius, 4px);
}

.countdown-text {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  color: var(--color-text);
  line-height: 1.4;
}

.countdown-text strong {
  color: var(--color-primary);
  font-weight: 600;
}

.absolute-time {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.reschedule-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.reschedule-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(34, 197, 255, 0.15);
  border: 1px solid rgba(34, 197, 255, 0.3);
  border-radius: 0.375rem;
  width: fit-content;
}

.badge-icon {
  font-size: 1rem;
}

.badge-label {
  font-size: 0.875rem;
  color: var(--color-text);
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.625rem 1.25rem;
  border-radius: var(--border-radius, 4px);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: 1px solid var(--color-primary);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(34, 197, 255, 0.2);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}

.btn-danger {
  background: var(--color-error, #dc2626);
  color: white;
  border: 1px solid var(--color-error, #dc2626);
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
}

@media (max-width: 640px) {
  .scheduling-info {
    padding: 1rem;
  }

  .info-header {
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .info-icon {
    font-size: 1.25rem;
  }

  .info-title {
    font-size: 1rem;
  }
}
</style>
