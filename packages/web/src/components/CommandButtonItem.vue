<template>
  <div class="command-button-item">
    <!-- Header: Label and Run Button -->
    <div class="button-header">
      <div class="button-info">
        <div class="button-label">{{ button.label }}</div>
        <div class="button-command">{{ truncateCommand(button.command) }}</div>
      </div>

      <div class="button-actions">
        <!-- Status Indicator -->
        <div v-if="run" :class="['status-indicator', `status-${run.status}`]">
          {{ statusIcon }}
        </div>

        <!-- Run Button (idle state) -->
        <button
          v-if="!run || run.status !== 'running'"
          class="btn btn-primary btn-sm"
          @click="handleRun"
          :disabled="run?.status === 'running'"
          data-testid="run-button"
        >
          ▶ Run
        </button>

        <!-- Kill Button (running state) -->
        <button
          v-if="run?.status === 'running'"
          class="btn btn-outline-danger btn-sm kill-button"
          @click="handleKill"
          title="Kill running command"
          data-testid="kill-button"
        >
          ✕ Kill
        </button>
      </div>
    </div>

    <!-- Output Section (collapsible) -->
    <div v-if="run" class="output-section">
      <div class="output-header" @click="showOutput = !showOutput">
        <span class="expand-icon">{{ showOutput ? '▼' : '▶' }}</span>
        <span class="output-label">
          Output
          <span v-if="run.exitCode !== null" class="exit-code">(exit code: {{ run.exitCode }})</span>
        </span>
      </div>

      <!-- Output Content (when expanded) -->
      <div v-if="showOutput" class="output-content">
        <div
          class="output-text"
          v-html="formattedOutput || '(no output)'"
        ></div>

        <!-- Output Actions (success/error states) -->
        <div v-if="run.status !== 'running'" class="output-actions">
          <button class="btn btn-sm btn-outline-secondary" @click="handleCopy">
            📋 Copy
          </button>
          <button class="btn btn-sm btn-outline-secondary" @click="handleCanvas">
            🎨 Send to Canvas
          </button>
        </div>
      </div>
    </div>

    <!-- Loading Spinner (running state) -->
    <div v-if="run?.status === 'running'" class="running-indicator">
      <span class="spinner"></span>
      Running...
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, ref, computed, watch, nextTick } from 'vue';
import { ansiToHtml } from '../utils/ansi.js';

const props = defineProps({
  button: {
    type: Object,
    required: true,
  },
  run: {
    type: Object,
    default: null,
  },
  sessionId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['run', 'kill', 'copy-output', 'send-to-canvas']);

// CHANGED: Default to true (output visible by default)
const showOutput = ref(true);

// NEW: Ref to the output container div for scrolling
const outputRef = ref(null);

// NEW: Track if user has manually scrolled up from the bottom
const userHasScrolledUp = ref(false);

const truncateCommand = (command) => {
  const maxLength = 80;
  if (command.length > maxLength) {
    return command.substring(0, maxLength) + '...';
  }
  return command;
};

/**
 * Computed property: Format output with ANSI codes converted to HTML
 *
 * This converts raw terminal output containing ANSI escape codes
 * (colors, bold, dim, etc.) into styled HTML that renders correctly.
 * Falls back to plain text if run.output is not available.
 */
const formattedOutput = computed(() => {
  if (!props.run?.output) {
    return '';
  }
  return ansiToHtml(props.run.output);
});

/**
 * Detect scroll position: has user scrolled up from the bottom?
 *
 * If scrollTop is more than 50px from bottom, user has scrolled up.
 * This allows auto-scroll to pause while user reads earlier output.
 * Threshold of 50px is forgiving for trackpad/mouse wheel jumps.
 */
const onScroll = () => {
  if (!outputRef.value) return;

  const { scrollTop, scrollHeight, clientHeight } = outputRef.value;

  // Calculate how far from bottom (pixels)
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  // Consider "at bottom" if within 50px threshold
  const isAtBottom = distanceFromBottom < 50;

  // Update state: true = user scrolled up, false = at/near bottom
  userHasScrolledUp.value = !isAtBottom;
};

/**
 * Watch for output changes and auto-scroll to bottom
 *
 * Triggers when run.output property changes (when new text arrives).
 * Only auto-scrolls if user hasn't manually scrolled up.
 * Uses nextTick to ensure DOM has updated before scrolling.
 */
watch(
  () => props.run?.output,
  () => {
    // Skip auto-scroll if user has scrolled up to read earlier output
    if (userHasScrolledUp.value || !outputRef.value) {
      return;
    }

    // Wait for DOM to update with new content, then scroll to bottom
    nextTick(() => {
      if (outputRef.value) {
        outputRef.value.scrollTop = outputRef.value.scrollHeight;
      }
    });
  },
  { immediate: false } // Don't fire on component mount, only on prop changes
);

/**
 * Watch for new run ID and reset scroll tracking
 *
 * When a new command starts, reset the "user scrolled up" flag
 * so auto-scroll works for the fresh output.
 */
watch(
  () => props.run?.runId,
  () => {
    userHasScrolledUp.value = false;
  },
  { immediate: false } // Don't fire on component mount
);

const statusIcon = computed(() => {
  if (!props.run) return '';
  switch (props.run.status) {
    case 'running':
      return '⊙';
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    default:
      return '';
  }
});

const handleRun = () => {
  emit('run');
};

const handleKill = () => {
  emit('kill');
};

const handleCopy = () => {
  emit('copy-output', props.run.output);
};

const handleCanvas = () => {
  emit('send-to-canvas', props.button.label, props.run.output);
};

// Expose methods for testing
defineExpose({
  handleRun,
  handleKill,
  handleCopy,
  handleCanvas,
});

</script>

<style scoped>
.command-button-item {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Header Section */
.button-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.button-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.button-label {
  font-weight: 500;
  color: var(--color-text);
  font-size: 1rem;
}

.button-command {
  color: var(--color-text-soft);
  font-size: 0.85rem;
  font-family: var(--font-mono);
}

.button-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Status Indicator */
.status-indicator {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: bold;
}

.status-success {
  background-color: rgba(63, 185, 80, 0.2);
  color: var(--color-success);
}

.status-error {
  background-color: rgba(248, 81, 73, 0.2);
  color: var(--color-error);
}

.status-running {
  animation: pulse 1.5s ease-in-out infinite;
}

/* Output Section */
.output-section {
  border-top: 1px solid var(--color-border);
  padding-top: 0.75rem;
}

.output-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
  user-select: none;
}

.output-header:hover {
  background-color: rgba(88, 166, 255, 0.1);
}

.expand-icon {
  color: var(--color-text-soft);
  font-size: 0.85rem;
}

.output-label {
  color: var(--color-text);
  font-size: 0.9rem;
}

.exit-code {
  color: var(--color-text-soft);
  font-size: 0.8rem;
  margin-left: 0.5rem;
}

.output-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding: 0.75rem;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.output-text {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--color-text-soft);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  line-height: 1.4;
}

.output-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  padding-top: 0.75rem;
}

/* Running Indicator */
.running-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Animations */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}

/* Responsive Design */
@media (max-width: 640px) {
  .button-header {
    flex-direction: column;
    align-items: stretch;
  }

  .button-actions {
    width: 100%;
    justify-content: space-between;
  }

  .button-actions button {
    flex: 1;
  }

  .output-actions {
    flex-direction: column;
  }

  .output-actions button {
    width: 100%;
  }
}
</style>
