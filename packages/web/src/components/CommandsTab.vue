<template>
  <div class="commands-tab">
    <!-- Header with Configure Link -->
    <div class="tab-header">
      <h3>Command Buttons</h3>
      <router-link
        :to="`/projects/${projectId}/sessions`"
        class="btn btn-sm btn-outline-secondary"
      >
        ⚙️ Configure
      </router-link>
    </div>

    <!-- Loading State -->
    <div v-if="commandButtonsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading command buttons...
    </div>

    <!-- Error State -->
    <div v-else-if="commandButtonsStore.error" class="error-message">
      {{ commandButtonsStore.error }}
    </div>

    <!-- Empty State -->
    <div v-else-if="commandButtonsStore.buttons.length === 0" class="empty-state">
      <p>No command buttons configured for this project.</p>
      <router-link
        :to="`/projects/${projectId}/sessions`"
        class="btn btn-primary"
      >
        Configure Command Buttons
      </router-link>
    </div>

    <!-- Commands List -->
    <div v-else class="commands-list">
      <CommandButtonItem
        v-for="button in commandButtonsStore.buttons"
        :key="button.id"
        :button="button"
        :run="commandButtonsStore.getRun(currentRunIds[button.id])"
        :session-id="sessionId"
        @run="onButtonRun(button.id)"
        @kill="onButtonKill(button.id)"
        @copy-output="onCopyOutput"
        @send-to-canvas="onSendToCanvas"
      />
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineExpose, ref, onMounted, onUnmounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useUiStore } from '../stores/ui.js';
import { api } from '../composables/useApi.js';
import { stripAnsi } from '../utils/ansi.js';
import CommandButtonItem from './CommandButtonItem.vue';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  projectId: {
    type: String,
    required: true,
  },
});

const router = useRouter();
const commandButtonsStore = useCommandButtonsStore();
const uiStore = useUiStore();

// Map button ID to current run ID
const currentRunIds = reactive({});

// Store cleanup functions for WebSocket handlers
const cleanups = [];

/**
 * Handle button run event
 */
const onButtonRun = async (buttonId) => {
  try {
    const runId = await commandButtonsStore.runButton(props.sessionId, buttonId);
    currentRunIds[buttonId] = runId;
  } catch (err) {
    uiStore.error(`Failed to run command: ${err.message}`);
  }
};

/**
 * Handle button kill event
 */
const onButtonKill = async (buttonId) => {
  // Try to find runId from local map first
  let runId = currentRunIds[buttonId];

  // Fallback: search through store's runs for matching buttonId
  if (!runId) {
    const storeRuns = Object.values(commandButtonsStore.runs);
    const matchingRun = storeRuns.find(
      (r) => r.buttonId === buttonId && r.status === 'running'
    );
    if (matchingRun) {
      runId = matchingRun.runId;
    }
  }

  if (!runId) {
    uiStore.error('Cannot kill command: run not found');
    return;
  }

  try {
    await commandButtonsStore.killRun(props.sessionId, runId);
  } catch (err) {
    uiStore.error(`Failed to kill command: ${err.message}`);
  }
};

/**
 * Handle copy output event
 */
const onCopyOutput = async (output) => {
  // Validate output
  if (!output) {
    uiStore.error('No output to copy');
    return;
  }

  if (typeof output !== 'string') {
    uiStore.error('Output is not text');
    return;
  }

  // Check for clipboard API availability
  if (!navigator.clipboard) {
    uiStore.error('Clipboard API not available in this browser');
    return;
  }

  try {
    await navigator.clipboard.writeText(stripAnsi(output));
    uiStore.success('Output copied to clipboard');
  } catch (err) {
    // Provide more specific error messages
    if (err.name === 'NotAllowedError') {
      uiStore.error('Clipboard access denied - check browser permissions');
    } else if (err.name === 'NotFoundError') {
      uiStore.error('Clipboard API not available');
    } else {
      uiStore.error(`Failed to copy output: ${err.message}`);
    }
  }
};

/**
 * Handle send to canvas event
 */
const onSendToCanvas = async (buttonLabel, output) => {
  // Validate output
  if (!output) {
    uiStore.error('No output to send to canvas');
    return;
  }

  if (typeof output !== 'string') {
    uiStore.error('Output must be text');
    return;
  }

  try {
    // Sanitize filename from button label
    const sanitizedLabel = buttonLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    await api.createCanvasItem(props.sessionId, {
      type: 'text',
      filename: `${sanitizedLabel}-output.txt`,
      content: stripAnsi(output),
      label: `${buttonLabel} output`,
    });

    uiStore.success('Output sent to canvas');
  } catch (err) {
    uiStore.error(`Failed to send to canvas: ${err.message}`);
  }
};

/**
 * Setup WebSocket handlers for command events
 */
const setupWebSocketHandlers = () => {
  const { subscribe, unsubscribe, onCommandOutput, onCommandComplete, onCommandError } =
    useSessionSubscription(props.sessionId);

  // Subscribe to session updates
  subscribe();

  // Handle command output updates
  cleanups.push(
    onCommandOutput((runId, text) => {
      commandButtonsStore.appendOutput(runId, text);
    })
  );

  // Handle command completion
  cleanups.push(
    onCommandComplete((runId, exitCode, output) => {
      commandButtonsStore.completeRun(runId, exitCode, output);
    })
  );

  // Handle command errors
  cleanups.push(
    onCommandError((runId, error) => {
      commandButtonsStore.errorRun(runId, error);
    })
  );

  // Add unsubscribe to cleanups
  cleanups.push(unsubscribe);
};

onMounted(async () => {
  // Setup WebSocket handlers immediately for live updates
  setupWebSocketHandlers();

  // Fetch buttons and active runs in parallel for faster loading
  const [, activeRuns] = await Promise.all([
    commandButtonsStore.fetchButtons(props.projectId),
    commandButtonsStore.fetchActiveRuns(props.sessionId),
  ]);

  // Map button IDs to their current run IDs
  for (const run of activeRuns) {
    currentRunIds[run.buttonId] = run.runId;
  }
});

onUnmounted(() => {
  // Cleanup all WebSocket handlers
  cleanups.forEach((cleanup) => cleanup());
  cleanups.length = 0;
});

// Expose methods for testing
defineExpose({
  onCopyOutput,
  onSendToCanvas,
  onButtonRun,
  onButtonKill,
});
</script>

<style scoped>
.commands-tab {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.tab-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}

.loading-state,
.error-message,
.empty-state {
  padding: 2rem;
  text-align: center;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text-soft);
}

.error-message {
  color: var(--color-error);
  background-color: rgba(248, 81, 73, 0.1);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

.commands-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (max-width: 640px) {
  .tab-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .commands-list {
    gap: 1rem;
  }
}
</style>
