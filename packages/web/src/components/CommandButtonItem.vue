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

        <!-- Copy Button (in header for quick access) -->
        <button
          v-if="run?.output && run.status !== 'running'"
          class="btn btn-sm btn-icon"
          :class="{ copied: isCopied }"
          @click="handleCopy"
          :title="isCopied ? 'Copied!' : 'Copy output to clipboard'"
        >
          {{ isCopied ? '✓' : '📋' }}
        </button>

        <!-- Canvas Button (in header for quick access) -->
        <button
          v-if="run?.output && run.status !== 'running'"
          class="btn btn-sm btn-icon"
          @click="handleCanvas"
          title="Send output to canvas"
        >
          🎨
        </button>

        <!-- Run Button (idle state) -->
        <button
          v-if="!run || run.status !== 'running'"
          class="btn btn-primary btn-sm"
          @click="handleRun"
          :disabled="run?.status === 'running' || isSubmitting"
          :class="{ 'is-loading': isSubmitting }"
          data-testid="run-button"
        >
          <span v-if="isSubmitting" class="spinner-inline"></span>
          {{ isSubmitting ? 'Starting...' : '▶ Run' }}
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
        <!-- Display truncation indicator (200 lines for performance) -->
        <div v-if="outputIsTruncatedForDisplay" class="output-display-truncated">
          ↑ Showing last 200 lines. Use Copy to get full output.
        </div>
        <div
          ref="outputContainerRef"
          class="output-text"
          v-html="formattedOutput || '(no output)'"
        ></div>
      </div>
    </div>

    <!-- Loading Spinner (running state) -->
    <div v-if="run?.status === 'running'" class="running-indicator">
      <span class="spinner"></span>
      Running <span class="elapsed-time">{{ elapsedTime }}</span>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { ansiToHtml, stripAnsi } from '../utils/ansi.js';

/**
 * Debounce with leading edge - first call is immediate, subsequent calls are debounced
 * This provides instant feedback on first render while throttling rapid updates
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function with leading edge
 */
const debounceLeading = (fn, delay) => {
  let timeoutId = null;
  let lastCalled = 0;
  return (...args) => {
    const now = Date.now();
    if (timeoutId) clearTimeout(timeoutId);

    // If enough time has passed, call immediately (leading edge)
    if (now - lastCalled >= delay) {
      lastCalled = now;
      fn(...args);
    } else {
      // Otherwise schedule for later (trailing edge)
      timeoutId = setTimeout(() => {
        lastCalled = Date.now();
        fn(...args);
      }, delay);
    }
  };
};

// Display limit: only render last 200 lines in DOM for performance
// Full output is still available via props.run.output for copy/canvas
const DISPLAY_LINE_LIMIT = 200;

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

const emit = defineEmits(['run', 'kill', 'send-to-canvas']);

// Default to true only if command is running, false otherwise
const showOutput = ref(props.run?.status === 'running');

// Track if button click is in flight (prevents double-clicks)
const isSubmitting = ref(false);

// Track if copy button was recently clicked (for visual feedback)
const isCopied = ref(false);

// Template ref for output container (used for auto-scroll)
const outputContainerRef = ref(null);

// NEW: Elapsed time for running commands
const elapsedTime = ref('0:00');
let timerInterval = null;

const truncateCommand = (command) => {
  const maxLength = 80;
  if (command.length > maxLength) {
    return command.substring(0, maxLength) + '...';
  }
  return command;
};

/**
 * Update the elapsed time display for running commands
 * Calculates time since startedAt and formats as MM:SS
 */
const updateElapsedTime = () => {
  if (!props.run || props.run.status !== 'running') {
    return;
  }

  const elapsed = Date.now() - props.run.startedAt;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  elapsedTime.value = `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Start the timer for running commands
 * Updates elapsed time every 1 second
 */
const startTimer = () => {
  if (!props.run || props.run.status !== 'running') {
    return;
  }

  // Clear any existing timer
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Update immediately
  updateElapsedTime();

  // Update every 1 second
  timerInterval = setInterval(() => {
    updateElapsedTime();
  }, 1000);
};

/**
 * Stop the timer and reset elapsed time
 */
const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  elapsedTime.value = '0:00';
};

/**
 * Ref for formatted HTML output (debounced for performance)
 *
 * This converts raw terminal output containing ANSI escape codes
 * (colors, bold, dim, etc.) into styled HTML that renders correctly.
 * Debounced to avoid excessive re-renders during rapid output streaming.
 */
const formattedOutput = ref('');

/**
 * Track if the display output is truncated (different from store truncation)
 * True when we have more than DISPLAY_LINE_LIMIT lines
 */
const outputIsTruncatedForDisplay = ref(false);

/**
 * Debounced function to update formatted output
 * Only formats last DISPLAY_LINE_LIMIT lines for performance
 * Full output is still in props.run.output for copy/canvas
 */
const updateFormattedOutput = debounceLeading((output) => {
  const lines = output.split('\n');
  if (lines.length > DISPLAY_LINE_LIMIT) {
    outputIsTruncatedForDisplay.value = true;
    const displayOutput = lines.slice(-DISPLAY_LINE_LIMIT).join('\n');
    formattedOutput.value = ansiToHtml(displayOutput);
  } else {
    outputIsTruncatedForDisplay.value = false;
    formattedOutput.value = ansiToHtml(output);
  }
}, 250);

/**
 * Watch for output changes and update formatted output (debounced)
 * Only processes when output section is expanded (lazy loading)
 * Simplified - no spinner logic needed
 */
watch(
  () => [props.run?.output, showOutput.value],
  ([newOutput, isVisible]) => {
    if (!newOutput) {
      formattedOutput.value = '';
      outputIsTruncatedForDisplay.value = false;
      return;
    }
    // Only process ANSI conversion when output is visible (lazy load)
    if (isVisible) {
      updateFormattedOutput(newOutput);
    }
  },
  { immediate: true }
);

/**
 * Scroll to bottom of output container
 * Uses requestAnimationFrame after nextTick for reliable timing
 */
const scrollToBottom = () => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = outputContainerRef.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  });
};

/**
 * Check if user is near the bottom of the output container
 * Returns true if within 100px of bottom
 */
const isNearBottom = () => {
  const el = outputContainerRef.value;
  if (!el) return true; // Default to true if element not mounted
  return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
};

/**
 * Watch for output changes and auto-scroll to bottom
 * Only auto-scrolls if user is near the bottom (not scrolled up)
 */
watch(
  () => props.run?.output,
  () => {
    // Only auto-scroll if user hasn't scrolled up to read earlier output
    // Check on next tick when DOM is ready
    nextTick(() => {
      if (showOutput.value && isNearBottom()) {
        scrollToBottom();
      }
    });
  },
  { immediate: false }
);

/**
 * Watch for new run ID and scroll to bottom for fresh output
 */
watch(
  () => props.run?.runId,
  () => {
    if (showOutput.value) {
      scrollToBottom();
    }
  },
  { immediate: false }
);

/**
 * Watch for run status changes to start/stop the timer
 *
 * When status changes to 'running', start the elapsed time timer.
 * When status changes away from 'running', stop the timer.
 * Note: Output pane remains collapsed by default; user can expand manually.
 */
watch(
  () => props.run?.status,
  (newStatus) => {
    if (newStatus === 'running') {
      startTimer();
    } else {
      stopTimer();
    }
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

const handleRun = async () => {
  if (isSubmitting.value) return; // Prevent double-click

  isSubmitting.value = true;
  try {
    emit('run');
  } finally {
    // Reset after a brief delay to let state updates propagate
    // If store immediately creates run, button will disable via run.status
    // This is a safety timeout to reset if something goes wrong
    setTimeout(() => {
      isSubmitting.value = false;
    }, 100);
  }
};

const handleKill = () => {
  emit('kill');
};

const handleCopy = async () => {
  if (!props.run?.output) {
    return;
  }

  const textToCopy = stripAnsi(props.run.output);
  let copySucceeded = false;

  // Try modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      copySucceeded = true;
    } catch (err) {
      console.error('Clipboard API failed:', err);
    }
  }

  // Fallback for older browsers
  if (!copySucceeded) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copySucceeded = true;
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
    }
  }

  // Show visual feedback if copy succeeded
  if (copySucceeded) {
    isCopied.value = true;
    setTimeout(() => {
      isCopied.value = false;
    }, 1500);
    // Copy handling is complete - visual feedback shown to user
  }
};

const handleCanvas = () => {
  emit('send-to-canvas', props.button.label, props.run.output);
};

/**
 * Lifecycle hook: On component mount
 *
 * If a command is already running, start the timer.
 */
onMounted(() => {
  if (props.run?.status === 'running') {
    startTimer();
  }
});

/**
 * Lifecycle hook: Before component unmount
 *
 * Clean up the timer to prevent memory leaks.
 */
onBeforeUnmount(() => {
  stopTimer();
});

// Expose methods and state for testing
defineExpose({
  handleRun,
  handleKill,
  handleCopy,
  handleCanvas,
  formattedOutput,
  showOutput,
  outputIsTruncatedForDisplay,
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

/* Icon Buttons (Copy/Canvas in header) */
.btn-icon {
  padding: 0.35rem 0.5rem;
  min-width: auto;
  font-size: 0.9rem;
  background-color: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background-color: rgba(88, 166, 255, 0.1);
  border-color: var(--color-primary);
  color: var(--color-text);
}

.btn-icon.copied {
  background-color: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.4);
  color: var(--color-success);
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
  position: relative;
}

.output-display-truncated {
  background-color: rgba(88, 166, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.2);
  color: var(--color-text-soft);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
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

/* Running Indicator */
.running-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.elapsed-time {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--color-text);
  font-weight: 500;
  min-width: 2.5rem;
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

.spinner-inline {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 0.5rem;
  opacity: 0.8;
}

.btn.is-loading {
  opacity: 0.8;
  position: relative;
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
}
</style>
