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
        <!-- Truncation warning -->
        <div v-if="run.outputTruncated" class="output-truncated-warning">
          ⚠️ Output truncated (showing last 2000 lines)
        </div>
        <!-- Loading skeleton while output is being processed -->
        <div v-if="isLoadingOutput" class="output-skeleton">
          <div class="skeleton-line" v-for="i in 5" :key="i"></div>
        </div>
        <!-- Prominent rendering spinner overlay for large outputs -->
        <div v-if="isRenderingLargeOutput" class="output-rendering-overlay">
          <div class="spinner-container">
            <div class="spinner-large"></div>
            <p class="rendering-text">Processing large output...</p>
          </div>
        </div>
        <div
          v-else
          class="output-text"
          @scroll="onScroll"
          v-html="formattedOutput || '(no output)'"
          data-output-container
        ></div>

        <!-- Output Actions (success/error states) -->
        <div v-if="run.status !== 'running'" class="output-actions">
          <button
            class="btn btn-sm btn-outline-secondary"
            :class="{ copied: isCopied }"
            @click="handleCopy"
            :title="isCopied ? 'Copied!' : 'Copy to clipboard'"
          >
            {{ isCopied ? '✓' : '📋' }} {{ isCopied ? 'Copied!' : 'Copy' }}
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

// NEW: Track if user has manually scrolled up from the bottom
const userHasScrolledUp = ref(false);

// NEW: Flag to prevent onScroll from firing during programmatic scrolls
const isProgrammaticScroll = ref(false);

/**
 * Get the output container element from the DOM
 * Uses querySelector instead of template ref to avoid Vue ref setup issues in tests
 */
const getOutputContainer = () => {
  return document.querySelector('[data-output-container]');
};

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
 * Track if output is being processed (for loading skeleton)
 * True when there's raw output but formatted output is not yet ready
 */
const isLoadingOutput = computed(() => {
  return showOutput.value && !!props.run?.output && !formattedOutput.value;
});

/**
 * Track if we're rendering a large output (for prominent spinner overlay)
 * Stays true while formatting and DOM rendering, then fades out
 * Only shown for outputs > 1000 lines to avoid visual clutter on small outputs
 */
const isRenderingLargeOutput = ref(false);
let renderingTimeoutId = null;
let renderingFrameId = null;

/**
 * Show prominent spinner overlay while processing large outputs
 * @param {string} output - The raw output text
 */
const showRenderingSpinner = (output) => {
  // Only show spinner for large outputs (>1000 lines is ~50KB typically)
  const lineCount = (output || '').split('\n').length;
  if (lineCount <= 1000) {
    return;
  }

  // Show the spinner
  isRenderingLargeOutput.value = true;

  // Clear existing timeouts
  if (renderingTimeoutId) clearTimeout(renderingTimeoutId);
  if (renderingFrameId) cancelAnimationFrame(renderingFrameId);

  // Keep spinner visible for minimum 500ms to avoid flash
  renderingTimeoutId = setTimeout(() => {
    // Schedule checking when rendering actually completes
    const checkRenderingComplete = () => {
      // If formatted output is ready, we can hide the spinner
      if (formattedOutput.value) {
        isRenderingLargeOutput.value = false;
      } else {
        // Keep checking - DOM might still be rendering
        renderingFrameId = requestAnimationFrame(checkRenderingComplete);
      }
    };
    checkRenderingComplete();
  }, 500);
};

/**
 * Debounced function to update formatted output
 * First call is immediate for responsive UI, subsequent calls debounced every 250ms
 */
const updateFormattedOutput = debounceLeading((output) => {
  formattedOutput.value = ansiToHtml(output);
}, 250);

/**
 * Watch for output changes and update formatted output (debounced)
 * Only processes when output section is expanded (lazy loading)
 * For large outputs (>1000 lines), show a prominent rendering spinner
 */
watch(
  () => [props.run?.output, showOutput.value],
  ([newOutput, isVisible]) => {
    if (!newOutput) {
      formattedOutput.value = '';
      isRenderingLargeOutput.value = false;
      return;
    }
    // Only process ANSI conversion when output is visible (lazy load)
    if (isVisible) {
      // Show spinner for large outputs before starting formatting
      showRenderingSpinner(newOutput);
      updateFormattedOutput(newOutput);
    }
  },
  { immediate: true }
);

/**
 * Detect scroll position: has user scrolled up from the bottom?
 *
 * If scrollTop is more than 50px from bottom, user has scrolled up.
 * This allows auto-scroll to pause while user reads earlier output.
 * Threshold of 50px is forgiving for trackpad/mouse wheel jumps.
 *
 * FIX: Ignore scroll events that we triggered programmatically to prevent
 * race conditions where auto-scroll causes onScroll to fire and incorrectly
 * set userHasScrolledUp to true.
 */
const onScroll = () => {
  // Ignore scroll events triggered by our own programmatic scrolling
  if (isProgrammaticScroll.value) {
    isProgrammaticScroll.value = false;
    return;
  }

  const element = getOutputContainer();
  if (!element) return;

  const { scrollTop, scrollHeight, clientHeight } = element;

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
 *
 * FIX: Set isProgrammaticScroll flag before scrolling so the scroll event
 * handler knows not to treat this as a user-initiated scroll.
 */
watch(
  () => props.run?.output,
  () => {
    // Skip auto-scroll if user has scrolled up to read earlier output
    if (userHasScrolledUp.value) {
      return;
    }

    // Wait for DOM to update with new content, then scroll to bottom
    nextTick(() => {
      const element = getOutputContainer();
      if (element && element.scrollHeight !== undefined) {
        try {
          // Mark this scroll as programmatic so onScroll handler ignores it
          isProgrammaticScroll.value = true;
          element.scrollTop = element.scrollHeight;
        } catch (e) {
          // Silently fail if element no longer exists (component cleanup)
          // This can happen during test teardown
        }
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
 * Clean up the timer and rendering state to prevent memory leaks.
 */
onBeforeUnmount(() => {
  stopTimer();
  // Clean up rendering timeouts
  if (renderingTimeoutId) clearTimeout(renderingTimeoutId);
  if (renderingFrameId) cancelAnimationFrame(renderingFrameId);
});

// Expose methods and state for testing
defineExpose({
  handleRun,
  handleKill,
  handleCopy,
  handleCanvas,
  isRenderingLargeOutput,
  formattedOutput,
  showOutput,
  showRenderingSpinner, // Expose for testing
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
  position: relative;
}

.output-truncated-warning {
  background-color: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: var(--color-warning, #fbbf24);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
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

.output-actions .btn.copied {
  background-color: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.4);
  transition: background-color 0.3s ease, border-color 0.3s ease;
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

/* Loading Skeleton */
.output-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.skeleton-line {
  height: 0.9rem;
  background: linear-gradient(
    90deg,
    var(--color-border) 0%,
    rgba(88, 166, 255, 0.15) 50%,
    var(--color-border) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-line:nth-child(1) { width: 80%; }
.skeleton-line:nth-child(2) { width: 95%; }
.skeleton-line:nth-child(3) { width: 70%; }
.skeleton-line:nth-child(4) { width: 85%; }
.skeleton-line:nth-child(5) { width: 60%; }

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Rendering Overlay for Large Outputs */
.output-rendering-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(2px);
  border-radius: 4px;
  z-index: 10;
  animation: fade-in 0.2s ease-in-out;
}

.spinner-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.spinner-large {
  display: inline-block;
  width: 3rem;
  height: 3rem;
  border: 3px solid rgba(88, 166, 255, 0.2);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.rendering-text {
  color: var(--color-text-soft);
  font-size: 0.95rem;
  text-align: center;
  margin: 0;
  font-weight: 500;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
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
