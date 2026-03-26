<template>
  <div class="summary-tab">
    <!-- Live output for running sessions -->
    <SessionLogStream
      v-if="isRunning"
      :session-ids="[sessionId]"
    />

    <!-- Session Overview Section -->
    <div v-if="hasPrInfo || summary?.shortSummary || loading" class="session-overview card">
      <div class="overview-header">
        <h3>Session Overview</h3>
      </div>

      <!-- Summary in Overview -->
      <div v-if="summary?.shortSummary" class="overview-summary">
        <p class="summary-text">{{ summary.shortSummary }}</p>
        <div v-if="filesCount > 0" class="summary-meta">
          <span class="summary-files">
            {{ filesCount }} {{ filesCount === 1 ? 'file' : 'files' }} modified
          </span>
        </div>
      </div>
      <div v-else-if="loading" class="overview-summary overview-summary-loading">
        <span class="loading-spinner-small"></span>
        <span>Loading summary...</span>
      </div>

      <!-- PR Info in Overview -->
      <div v-if="hasPrInfo" class="pr-section" data-testid="pr-section">
        <div class="overview-pr" data-testid="pr-overview-badge">
          <a :href="prUrl" target="_blank" rel="noopener noreferrer" class="pr-link">
            {{ extractPrNumber(prUrl) }}
          </a>
          <span :class="['status-badge', `pr-${summary?.prState}`]">
            {{ formatPrState(summary?.prState) }}
          </span>
          <span v-if="summary?.ciStatus === 'success' || summary?.ciStatus === 'pending'" :class="['status-badge', `ci-${summary.ciStatus}`]" data-testid="ci-status">
            {{ summary.ciStatus === 'success' ? 'CI Passing' : 'CI Pending' }}
          </span>
        </div>

        <!-- Warnings: merge conflicts and CI failures -->
        <div v-if="hasWarnings" class="pr-warnings" data-testid="pr-warnings">
          <div v-if="summary?.hasMergeConflicts" class="warning-item">
            Merge conflicts detected
          </div>
          <div v-if="summary?.ciStatus === 'failure'" class="warning-item">
            CI checks failing
          </div>
          <div v-if="summary?.ciFailures?.length" class="ci-failure-list">
            <div v-for="failure in summary.ciFailures" :key="failure" class="ci-failure-item" data-testid="pr-ci-failure-item">
              {{ failure }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity Log Card -->
    <WhatJustHappenedCard
      v-if="session"
      :session="session"
      :summary="summary"
      :descendant-summaries="descendantSummaries"
    />

    <!-- Child Sessions Section -->
    <SessionCardWorkflowPanel
      v-if="childSessions.length > 0"
      variant="detail"
      :session="session"
      :summaries="descendantSummaries"
      :summary="summary"
      :command-buttons="commandButtons"
    />

    <!-- Session Summary Section -->
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading summary...
    </div>

    <div v-else-if="generating" class="generating-state">
      <span class="loading-spinner"></span>
      Generating summary...
    </div>

    <SummaryContent
      v-else-if="summary"
      :summary="summary"
      :generating="generating"
      :regenerating="generatingManual"
      @regenerate="handleRegenerate"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useSummaries } from '../composables/useSummaries.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import WhatJustHappenedCard from './WhatJustHappenedCard.vue';
import SessionCardWorkflowPanel from './SessionCardWorkflowPanel.vue';
import SummaryContent from './SummaryContent.vue';
import SessionLogStream from './SessionLogStream.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
const streamingStore = useSessionStreamingStore();
const { onSummaryUpdate, onSummaryGenerating, onWorkLog, onPartial, onThinkingPartial } = useSessionSubscription(props.sessionId);
const { summaries: descendantSummaries, fetchSummariesBatch } = useSummaries();

// Restore collapsed log state for this session
streamingStore.restoreCollapsedLogState();

// Always listen for streaming data for live output
// The SessionLogStream component will only display when there's content

// Listen for work logs
onWorkLog((log) => {
  streamingStore.addSessionWorkLog(props.sessionId, log);
});

// Listen for partial text (streaming response)
onPartial((text) => {
  if (text) {
    streamingStore.setSessionPartialText(props.sessionId, text);
  }
});

// Listen for thinking
onThinkingPartial((thinking) => {
  if (thinking) {
    streamingStore.setPartialThinking(thinking, props.sessionId);
  }
});

// Hydrate streaming state from server on mount (browser only)
onMounted(async () => {
  // Skip hydration in test environment (fetch doesn't work with relative URLs in vitest)
  if (typeof window === 'undefined') return;

  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/streaming-state`);
    if (response.ok) {
      const snapshot = await response.json();
      if (snapshot && (snapshot.workLogs?.length || snapshot.partialText || snapshot.thinking)) {
        streamingStore.hydrateSessionState(props.sessionId, snapshot);
      }
    }
  } catch (error) {
    // Hydration failure is non-fatal
    // Silently ignore in test environment
  }
});

const summary = ref(null);
const loading = ref(false);
const generating = ref(false);
const generatingManual = ref(false);
const filesCount = ref(0);

// Computed property to get the session's prUrl
// Check both sessions array and currentSession (the latter is always populated on session detail page)
const session = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId)
  || (sessionsStore.currentSession?.id === props.sessionId ? sessionsStore.currentSession : null)
);
const isRunning = computed(() => {
  const status = session.value?.status;
  return status === 'running' || status === 'starting';
});
const prUrl = computed(() => session.value?.prUrl || null);
const hasPrInfo = computed(() => prUrl.value && summary.value?.prState);
const hasWarnings = computed(() => summary.value?.hasMergeConflicts || summary.value?.ciStatus === 'failure');

// Get child sessions for this session
const childSessions = computed(() => {
  return sessionsStore.getChildSessions(props.sessionId);
});

// Command buttons for child session indicators
const commandButtons = computed(() => {
  const projectId = session.value?.projectId;
  if (!projectId) return [];
  return commandButtonsStore.getButtonsByProjectId(projectId);
});

// Fetch summaries for all descendant sessions
async function fetchDescendantSummaries() {
  const descendants = sessionsStore.getAllDescendants(props.sessionId);
  if (descendants.length > 0) {
    await fetchSummariesBatch(descendants);
  }
}

function formatPrState(state) {
  const labels = {
    merged: 'Merged',
    open: 'Open',
    closed: 'Closed',
    draft: 'Draft',
  };
  return labels[state] || state;
}

function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}

onMounted(async () => {
  // Fetch summaries for descendant sessions (don't await - not critical path)
  fetchDescendantSummaries();

  // Fetch session summary
  loading.value = true;
  try {
    summary.value = await api.getSessionSummary(props.sessionId);

    // Fetch files count
    try {
      const result = await api.getSessionFilesCount(props.sessionId);
      filesCount.value = result.count || 0;
    } catch (error) {
      console.warn('Failed to fetch files count:', error);
      if (summary.value?.filesModified?.length) {
        filesCount.value = summary.value.filesModified.length;
      }
    }
  } catch (err) {
    // Don't show error for missing summary
    if (!err.message.includes('404')) {
      uiStore.error(err.message);
    }
  } finally {
    loading.value = false;
  }

  // Listen for WebSocket updates
  onSummaryUpdate((newSummary) => {
    summary.value = newSummary;
    generating.value = false;       // Belt-and-suspenders: summary arrived = not generating
    generatingManual.value = false;
  });

  onSummaryGenerating((isGenerating) => {
    generating.value = isGenerating;
  });
});

// Watch for changes in descendants and fetch summaries reactively
watch(
  () => sessionsStore.getAllDescendants(props.sessionId),
  (descendants) => {
    if (descendants.length > 0) {
      fetchDescendantSummaries();
    }
  },
  { deep: true }
);

onUnmounted(() => {
  // Clean up if needed
});

async function handleRegenerate() {
  generatingManual.value = true;
  try {
    summary.value = await api.generateSessionSummary(props.sessionId);
    uiStore.success('Summary regenerated');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    generatingManual.value = false;
  }
}
</script>

<style scoped>
.summary-tab {
  padding: 1rem 0;
}

.loading-state,
.generating-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

/* Session Overview Styles */
.session-overview {
  margin-bottom: 1.5rem;
}

.overview-header {
  margin-bottom: 1rem;
}

.overview-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.overview-summary {
  padding: 0.75rem 0;
  border-top: 1px solid var(--color-border);
}

.overview-summary-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.overview-summary .summary-text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text);
  line-height: 1.4;
}

.overview-summary .summary-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.overview-summary .summary-files {
  opacity: 0.8;
}

.loading-spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge.pr-merged {
  background: rgba(130, 80, 223, 0.15);
  color: #8250df;
}

.status-badge.pr-open {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-badge.pr-closed {
  background: rgba(110, 119, 129, 0.15);
  color: #6e7781;
}

.status-badge.pr-draft {
  background: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.status-badge.ci-success {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-badge.ci-pending {
  background: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.pr-section {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.overview-pr {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pr-warnings {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(207, 34, 46, 0.08);
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--color-error, #cf222e);
}

.warning-item {
  padding: 0.125rem 0;
}

.ci-failure-list {
  margin-top: 0.25rem;
  padding-left: 1rem;
}

.ci-failure-item {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8b949e);
  padding: 0.0625rem 0;
}

.pr-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.pr-link:hover {
  text-decoration: underline;
}

</style>
