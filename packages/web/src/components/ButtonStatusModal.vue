<template>
  <div v-if="isOpen" class="modal-overlay" @click="close">
    <div class="modal-dialog" @click.stop>
      <div class="modal-header">
        <h3>{{ button.label }}</h3>
        <button type="button" class="modal-close" @click="close" aria-label="Close">
          ×
        </button>
      </div>

      <div class="modal-body">
        <!-- Status Section -->
        <div class="status-section">
          <div class="status-row">
            <span class="status-label">Status:</span>
            <span :class="['status-badge', `status-${statusDisplay.color}`]">
              {{ statusDisplay.text }}
            </span>
          </div>

          <!-- Never run message -->
          <div v-if="!latestRun" class="info-message">
            This button has not been run yet.
          </div>

          <!-- Running status details -->
          <div v-else-if="latestRun.status === 'running'" class="status-details">
            <div class="detail-row">
              <span class="detail-label">Elapsed Time:</span>
              <span class="detail-value">{{ elapsedTime }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Started:</span>
              <span class="detail-value">{{ formatTime(latestRun.startedAt) }}</span>
            </div>
          </div>

          <!-- Success status details -->
          <div v-else-if="latestRun.status === 'success'" class="status-details">
            <div class="detail-row">
              <span class="detail-label">Exit Code:</span>
              <span class="detail-value">{{ latestRun.exitCode ?? 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Completed:</span>
              <span class="detail-value">{{ formatTime(latestRun.completedAt) }}</span>
            </div>
          </div>

          <!-- Error status details -->
          <div v-else-if="latestRun.status === 'error'" class="status-details">
            <div class="detail-row">
              <span class="detail-label">Exit Code:</span>
              <span class="detail-value">{{ latestRun.exitCode ?? 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Failed:</span>
              <span class="detail-value">{{ formatTime(latestRun.completedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps({
  button: {
    type: Object,
    required: true,
  },
  latestRun: {
    type: Object,
    default: null,
  },
  isOpen: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close']);

const elapsedTime = ref('0:00');
let timerInterval = null;

const statusDisplay = computed(() => {
  if (!props.latestRun) {
    return { text: 'Never Run', color: 'pending' };
  }

  switch (props.latestRun.status) {
    case 'running':
      return { text: 'Running', color: 'running' };
    case 'success':
      return { text: 'Success', color: 'success' };
    case 'error':
      return { text: 'Error', color: 'error' };
    default:
      return { text: 'Unknown', color: 'pending' };
  }
});

const updateElapsedTime = () => {
  if (!props.latestRun || props.latestRun.status !== 'running') {
    return;
  }

  const elapsed = Date.now() - props.latestRun.startedAt;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  elapsedTime.value = `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (timestamp) => {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const startTimer = () => {
  if (!props.latestRun || props.latestRun.status !== 'running') {
    return;
  }

  updateElapsedTime();
  timerInterval = setInterval(() => {
    updateElapsedTime();
  }, 1000);
};

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

const close = () => {
  emit('close');
};

watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      startTimer();
    } else {
      stopTimer();
    }
  }
);

watch(
  () => props.latestRun?.status,
  (newStatus) => {
    if (newStatus === 'running' && props.isOpen) {
      startTimer();
    } else {
      stopTimer();
    }
  }
);

onMounted(() => {
  if (props.isOpen && props.latestRun?.status === 'running') {
    startTimer();
  }
});

onBeforeUnmount(() => {
  stopTimer();
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-dialog {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  max-width: 400px;
  width: 90%;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.modal-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.1rem;
  flex: 1;
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}

.modal-close:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem 1.25rem;
  color: var(--color-text);
}

.status-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-label {
  font-weight: 600;
  color: var(--color-text-soft);
  min-width: 80px;
}

.status-badge {
  display: inline-block;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
}

.status-pending {
  background-color: rgba(75, 85, 99, 0.3);
  color: #4b5563;
}

.status-running {
  background-color: rgba(210, 153, 34, 0.2);
  color: #d29922;
}

.status-success {
  background-color: rgba(63, 185, 80, 0.2);
  color: #3fb950;
}

.status-error {
  background-color: rgba(248, 81, 73, 0.2);
  color: #f85149;
}

.info-message {
  padding: 0.75rem;
  background-color: rgba(75, 85, 99, 0.1);
  border-left: 3px solid rgba(75, 85, 99, 0.5);
  color: var(--color-text-soft);
  font-size: 0.9rem;
  border-radius: 4px;
}

.status-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}

.detail-label {
  font-weight: 600;
  color: var(--color-text-soft);
  min-width: 100px;
}

.detail-value {
  color: var(--color-text);
  word-break: break-word;
}

.modal-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--color-primary);
  color: white;
}

.btn-primary:hover {
  background-color: var(--color-primary-dark, #4a8fd8);
}

.btn-primary:active {
  opacity: 0.9;
}
</style>
