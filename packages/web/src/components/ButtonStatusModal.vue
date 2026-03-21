<template>
  <div v-if="isOpen" class="modal-overlay" @click="close" data-testid="button-status-modal">
    <div class="modal-dialog" @click.stop>
      <div class="modal-header">
        <h3>{{ button.label }}</h3>
        <button type="button" class="modal-close" @click="close" aria-label="Close">
          ×
        </button>
      </div>

      <div class="modal-body">
        <!-- Command Section -->
        <div v-if="button.command" class="command-section">
          <span class="section-label">Command:</span>
          <code class="command-text">{{ button.command }}</code>
        </div>

        <!-- Status Section -->
        <div class="status-section">
          <div class="status-row">
            <span class="status-label">Status:</span>
            <span :class="['status-badge', `status-${statusDisplay.color}`]" data-testid="button-status-badge">
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
            <div class="detail-row">
              <span class="detail-label">Run ID:</span>
              <span class="detail-value monospace">{{ latestRun.runId }}</span>
            </div>
          </div>

          <!-- Success status details -->
          <div v-else-if="latestRun.status === 'success'" class="status-details">
            <div v-if="duration" class="detail-row">
              <span class="detail-label">Duration:</span>
              <span class="detail-value">{{ duration }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Exit Code:</span>
              <span class="detail-value">{{ latestRun.exitCode ?? 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Started:</span>
              <span class="detail-value">{{ formatTime(latestRun.startedAt) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Completed:</span>
              <span class="detail-value">{{ formatTime(latestRun.completedAt) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Run ID:</span>
              <span class="detail-value monospace">{{ latestRun.runId }}</span>
            </div>
          </div>

          <!-- Error status details -->
          <div v-else-if="latestRun.status === 'error'" class="status-details">
            <div v-if="duration" class="detail-row">
              <span class="detail-label">Duration:</span>
              <span class="detail-value">{{ duration }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Exit Code:</span>
              <span class="detail-value">{{ latestRun.exitCode ?? 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Started:</span>
              <span class="detail-value">{{ formatTime(latestRun.startedAt) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Failed:</span>
              <span class="detail-value">{{ formatTime(latestRun.completedAt) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Run ID:</span>
              <span class="detail-value monospace">{{ latestRun.runId }}</span>
            </div>
          </div>
        </div>

        <!-- Output Section (collapsible) -->
        <div v-if="latestRun && latestRun.output" class="output-section">
          <div class="output-header" @click="showOutput = !showOutput" data-testid="output-header">
            <span class="expand-icon">{{ showOutput ? '▼' : '▶' }}</span>
            <span class="output-label">Process Output</span>
          </div>

          <div v-if="showOutput" class="output-content" data-testid="output-content">
            <div v-if="outputIsTruncatedForDisplay" class="output-truncated" data-testid="output-truncated">
              ↑ Showing last 200 lines of output
            </div>
            <div
              ref="outputContainerRef"
              class="output-text"
              v-html="formattedOutput || '(no output)'"
              data-testid="output-text"
            ></div>
          </div>
        </div>
      </div>

      <div class="modal-footer" :class="{ 'modal-footer-spaced': canRemoveRun }">
        <div v-if="canRemoveRun" class="remove-run-area">
          <template v-if="!showConfirmation">
            <button
              class="btn btn-danger"
              data-testid="remove-run-button"
              @click="showConfirmation = true"
            >Remove Run</button>
          </template>
          <template v-else>
            <span class="confirm-text">Are you sure?</span>
            <button
              class="btn btn-danger"
              data-testid="confirm-remove-button"
              :disabled="deleting"
              @click="handleRemoveRun"
            >{{ deleting ? 'Removing...' : 'Confirm' }}</button>
            <button
              class="btn btn-secondary"
              data-testid="cancel-remove-button"
              :disabled="deleting"
              @click="showConfirmation = false"
            >Cancel</button>
          </template>
        </div>
        <button class="btn btn-primary" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { ansiToHtml } from '../utils/ansi.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

const commandButtonsStore = useCommandButtonsStore();

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
  sessionId: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['close']);

const elapsedTime = ref('0:00');
const showConfirmation = ref(false);
const deleting = ref(false);
let timerInterval = null;

// Output section state
const showOutput = ref(false);
const formattedOutput = ref('');
const outputIsTruncatedForDisplay = ref(false);
const outputContainerRef = ref(null);
const DISPLAY_LINE_LIMIT = 200;

const updateFormattedOutput = () => {
  const output = props.latestRun?.output || '';
  if (!output) {
    formattedOutput.value = '';
    outputIsTruncatedForDisplay.value = false;
    return;
  }

  const lines = output.split('\n');
  if (lines.length > DISPLAY_LINE_LIMIT) {
    outputIsTruncatedForDisplay.value = true;
    const displayOutput = lines.slice(-DISPLAY_LINE_LIMIT).join('\n');
    formattedOutput.value = ansiToHtml(displayOutput);
  } else {
    outputIsTruncatedForDisplay.value = false;
    formattedOutput.value = ansiToHtml(output);
  }
};

// Simple debounce for output updates
const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

const debouncedUpdateOutput = debounce(updateFormattedOutput, 250);

const canRemoveRun = computed(() => {
  return props.latestRun && props.latestRun.status !== 'running';
});

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

const duration = computed(() => {
  if (!props.latestRun?.completedAt || !props.latestRun?.startedAt) {
    return null;
  }
  const durationMs = props.latestRun.completedAt - props.latestRun.startedAt;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
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

const handleRemoveRun = async () => {
  deleting.value = true;
  try {
    await commandButtonsStore.deleteRun(props.sessionId, props.latestRun.runId);
    emit('close');
  } catch (err) {
    console.error('Failed to remove run:', err);
  } finally {
    deleting.value = false;
    showConfirmation.value = false;
  }
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

// Watch for output changes and update formatted output
let isFirstOutputUpdate = true;
watch(
  () => props.latestRun?.output,
  () => {
    // Call immediately on first update to avoid delay, debounce subsequent updates
    if (isFirstOutputUpdate) {
      isFirstOutputUpdate = false;
      updateFormattedOutput();
    } else {
      debouncedUpdateOutput();
    }
  },
  { immediate: true }
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
  max-width: 600px;
  width: 90%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
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
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.command-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.section-label {
  font-weight: 600;
  color: var(--color-text-soft);
  font-size: 0.85rem;
}

.command-text {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
  font-size: 0.85rem;
  background-color: rgba(0, 0, 0, 0.3);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  color: var(--color-text);
  word-break: break-all;
  overflow-x: auto;
  max-height: 100px;
  display: block;
}

.monospace {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
  font-size: 0.8rem;
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
  gap: 0.5rem;
}

.modal-footer-spaced {
  justify-content: space-between;
}

.remove-run-area {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.confirm-text {
  font-size: 0.85rem;
  color: var(--color-text-soft);
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

.btn-danger {
  background-color: rgba(248, 81, 73, 0.2);
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.4);
}

.btn-danger:hover {
  background-color: rgba(248, 81, 73, 0.3);
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: rgba(75, 85, 99, 0.3);
  color: var(--color-text-soft);
  border-color: rgba(75, 85, 99, 0.5);
}

.btn-secondary:hover {
  background-color: rgba(75, 85, 99, 0.4);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.output-section {
  margin-top: 1rem;
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.output-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  cursor: pointer;
  user-select: none;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: background-color 0.2s;
}

.output-header:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

.expand-icon {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  transition: transform 0.2s;
}

.output-label {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.9rem;
}

.output-content {
  margin-top: 0.5rem;
  max-height: 400px;
  overflow-y: auto;
  background-color: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 0.75rem;
}

.output-truncated {
  padding: 0.5rem;
  background-color: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 4px;
  color: #60a5fa;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.output-text {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
  font-size: 0.8rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
}

.output-text :deep(span) {
  display: inline;
}
</style>
