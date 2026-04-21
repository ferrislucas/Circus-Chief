<template>
  <div
    class="command-button-item"
    :data-testid="`command-button-item-${button.id}`"
  >
    <!-- Header: Label and Run Button -->
    <div class="button-header">
      <div class="button-info">
        <div class="button-label">
          {{ button.label }}
        </div>
        <div class="button-command">
          {{ truncateCommand(button.command) }}
        </div>
        <RunTimestamps
          ref="timestampsRef"
          :run="run"
        />
      </div>

      <div class="button-actions">
        <!-- Status Indicator -->
        <div
          v-if="run"
          :class="['status-indicator', `status-${run.status}`]"
          :aria-label="run.status"
          data-testid="command-status"
        >
          <!-- eslint-disable vue/no-v-html -->
          <span v-html="statusIcon" />
          <!-- eslint-enable vue/no-v-html -->
        </div>

        <!-- Action Menu (copy/canvas/copy-command) -->
        <ActionMenu
          v-if="run && run.status !== 'running'"
          :items="menuItems"
          aria-label="Command output actions"
          @action-click="handleMenuAction"
        />

        <!-- Run Button (idle state) -->
        <button
          v-if="!run || run.status !== 'running'"
          class="btn btn-primary btn-sm"
          :disabled="run?.status === 'running' || isSubmitting || disabled"
          :class="{ 'is-loading': isSubmitting }"
          data-testid="run-button"
          @click="handleRun"
        >
          <span
            v-if="isSubmitting"
            class="spinner-inline"
          />
          {{ isSubmitting ? 'Starting...' : '▶ Run' }}
        </button>

        <!-- Kill Button (running state) -->
        <button
          v-if="run?.status === 'running'"
          class="btn btn-outline-danger btn-sm kill-button"
          title="Kill running command"
          data-testid="kill-button"
          @click="handleKill"
        >
          ✕ Kill
        </button>
      </div>
    </div>

    <!-- Output Section (collapsible) -->
    <div
      v-if="run"
      class="output-section"
      data-testid="output-section"
    >
      <div
        class="output-header"
        @click="showOutput = !showOutput"
      >
        <span class="expand-icon">{{ showOutput ? '▼' : '▶' }}</span>
        <span class="output-label">
          Output
          <span
            v-if="run.exitCode !== null"
            class="exit-code"
          >(exit code: {{ run.exitCode }})</span>
        </span>
      </div>

      <!-- Output Content (when expanded) -->
      <div
        v-if="showOutput"
        class="output-content"
      >
        <!-- Display truncation indicator (200 lines for performance) -->
        <div
          v-if="outputIsTruncatedForDisplay"
          class="output-display-truncated"
        >
          ↑ Showing last 200 lines. Use Copy to get full output.
        </div>
        <!-- eslint-disable vue/no-v-html -->
        <div
          ref="outputContainerRef"
          class="output-text"
          v-html="formattedOutput || '(no output)'"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>

    <!-- Loading Spinner (running state) -->
    <div
      v-if="run?.status === 'running'"
      class="running-indicator"
    >
      <span class="spinner" />
      Running <span class="elapsed-time">{{ timestampsRef?.elapsedTime ?? '0:00' }}</span>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, ref, computed, watch, nextTick } from 'vue';
import { ansiToHtml, stripAnsi } from '../utils/ansi.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useUiStore } from '../stores/ui.js';
import { getStatusIconSvg } from './statusIcons';
import ActionMenu from './ActionMenu.vue';
import RunTimestamps from './RunTimestamps.vue';

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
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['run', 'kill', 'send-to-canvas']);

// Initialize stores
const commandButtonsStore = useCommandButtonsStore();
const uiStore = useUiStore();

// Use store to persist collapse state across tab navigation
// Computed property syncs with store: get returns !isCollapsed, set updates store
const showOutput = computed({
  get() {
    if (!props.run?.runId) {
      return false;
    }
    return !commandButtonsStore.isOutputCollapsed(props.run.runId);
  },
  set(value) {
    if (props.run?.runId) {
      commandButtonsStore.setOutputCollapsed(props.run.runId, !value);
    }
  }
});

// Track if button click is in flight (prevents double-clicks)
const isSubmitting = ref(false);

// Menu items for ActionMenu component
const menuItems = computed(() => [
  { icon: '📋', label: 'Copy output', action: 'copy-output' },
  { icon: '🎨', label: 'Send to canvas', action: 'send-to-canvas' },
  { icon: '📄', label: 'Copy command', action: 'copy-command' }
]);

// Template ref for output container (used for auto-scroll)
const outputContainerRef = ref(null);

// Template ref for the <RunTimestamps> child, which owns the single
// 1-second interval that drives the live elapsed counter. The footer's
// .running-indicator reads `timestampsRef.elapsedTime` so there is exactly
// one source of truth for the ticking value.
const timestampsRef = ref(null);

const truncateCommand = (command) => {
  const maxLength = 80;
  if (command.length > maxLength) {
    return `${command.substring(0, maxLength)  }...`;
  }
  return command;
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
    // Fetch output from server if pane is expanded but output isn't loaded yet.
    // Note: empty string is falsy, so this triggers for runs loaded from list
    // queries (which exclude output). Runs that genuinely produced no output
    // will re-fetch each time, which is an acceptable single lightweight GET.
    if (isVisible && !newOutput && props.run?.runId && props.run?.status !== 'running') {
      commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
      return; // Output will arrive reactively once fetch completes, triggering this watcher again
    }

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

// Note: the elapsed-time ticking is owned by the <RunTimestamps /> child
// (single 1-second interval). See `timestampsRef` above.

const statusIcon = computed(() => {
  if (!props.run) return '';
  return getStatusIconSvg(props.run.status);
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

/**
 * Handle menu action selection
 * Dispatches to appropriate handler based on action type
 */
const handleMenuAction = async (action) => {
  switch (action) {
    case 'copy-output':
      await handleCopyOutput();
      break;
    case 'send-to-canvas':
      await handleSendToCanvas();
      break;
    case 'copy-command':
      await handleCopyCommand();
      break;
  }
};

/**
 * Copy command output to clipboard
 * Shows toast notification on success
 */
const handleCopyOutput = async () => {
  // Fetch output if not loaded yet
  if (!props.run?.output && props.run?.runId) {
    await commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
  }
  // Read from store directly to avoid reactivity timing issues with props
  const runData = commandButtonsStore.runs[props.run?.runId];
  const output = runData?.output;
  if (!output) return;

  if (await copyToClipboard(stripAnsi(output))) {
    uiStore.success('Output copied to clipboard');
  }
};

/**
 * Send command output to canvas
 * Toast is shown in parent component (CommandsTab.vue)
 */
const handleSendToCanvas = async () => {
  // Fetch output if not loaded yet
  if (!props.run?.output && props.run?.runId) {
    await commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
  }
  const runData = commandButtonsStore.runs[props.run?.runId];
  const output = runData?.output;
  if (!output) return;

  emit('send-to-canvas', props.button.label, output);
};

/**
 * Copy command text to clipboard
 * Shows toast notification on success
 */
const handleCopyCommand = async () => {
  if (!props.button?.command) return;
  if (await copyToClipboard(props.button.command)) {
    uiStore.success('Command copied to clipboard');
  }
};

// Expose methods and state for testing
defineExpose({
  handleRun,
  handleKill,
  handleMenuAction,
  handleCopyOutput,
  handleSendToCanvas,
  handleCopyCommand,
  formattedOutput,
  showOutput,
  outputIsTruncatedForDisplay,
  timestampsRef,
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

.status-indicator {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-indicator :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
}

.status-success {
  background-color: rgba(63, 185, 80, 0.2);
  color: var(--color-success);
}

.status-success :deep(svg) {
  animation: pop-in 0.3s ease-out;
}

.status-error {
  background-color: rgba(248, 81, 73, 0.2);
  color: var(--color-error);
}

.status-error :deep(svg) {
  animation: shake 0.4s ease-in-out;
}

.status-running {
  background-color: rgba(210, 153, 34, 0.3);
  color: #d29922;
  border-color: #d29922;
  animation: hourglass-flip 2s ease-in-out infinite;
}

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
  /* Wider min-width accommodates H:MM:SS output for runs ≥ 1 h without
     causing layout shift when the counter crosses the 1 h boundary. */
  min-width: 3.5rem;
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

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes hourglass-flip {
  0%, 80%   { transform: rotate(0deg); }
  90%       { transform: rotate(180deg); }
  100%      { transform: rotate(180deg); }
}

@keyframes pop-in {
  0%   { transform: scale(0); }
  70%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-2px); }
  75%      { transform: translateX(2px); }
}

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
