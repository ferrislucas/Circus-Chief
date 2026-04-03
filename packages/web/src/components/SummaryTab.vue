<template>
  <div class="summary-tab">
    <!-- Live output for running sessions -->
    <SessionLogStream
      v-if="isRunning"
      :session-ids="[sessionId]"
    />

    <!-- Most Recent Agent Response -->
    <div v-if="latestResponse" class="latest-response card">
      <div class="latest-response-header">
        <h3>Latest Response</h3>
        <div class="latest-response-meta">
          <span v-if="latestResponse.sessionName" class="response-session-name">
            from {{ latestResponse.sessionName }}
          </span>
          <span class="response-timestamp">
            {{ formatRelativeTime(latestResponse.message.timestamp) }}
          </span>
        </div>
      </div>
      <div class="latest-response-content" :class="{ collapsed: !latestResponseExpanded && isContentLong }">
        <MarkdownViewer :content="displayedContent" />
      </div>
      <button
        v-if="isContentLong"
        class="btn-link expand-toggle"
        @click="latestResponseExpanded = !latestResponseExpanded"
      >
        {{ latestResponseExpanded ? 'Show less' : 'Show full response' }}
      </button>
    </div>

    <!-- Session Overview Section -->
    <div v-if="hasPrInfo || summary?.shortSummary || hasMetrics || loading" class="session-overview card">
      <div class="overview-header">
        <h3>Session Overview</h3>
      </div>

      <!-- Summary in Overview -->
      <div v-if="summary?.shortSummary" class="overview-summary">
        <p class="summary-text">{{ summary.shortSummary }}</p>
      </div>

      <!-- Overview Metrics -->
      <div v-if="hasMetrics" class="overview-metrics">
        <div class="metric" v-if="sessionCount > 1">
          <span class="metric-value">{{ sessionCount }}</span>
          <span class="metric-label">Sessions</span>
        </div>
        <div class="metric" v-if="hasNonZeroCost">
          <span class="metric-value">{{ formattedCost }}</span>
          <span class="metric-label">Cost</span>
        </div>
        <div class="metric" v-if="formattedDuration">
          <span class="metric-value">{{ formattedDuration }}</span>
          <span class="metric-label">Work Time</span>
        </div>
        <div class="metric" v-if="filesCount > 0">
          <span class="metric-value">{{ filesCount }}</span>
          <span class="metric-label">{{ filesCount === 1 ? 'File' : 'Files' }}</span>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { formatTokenCount } from '@claudetools/shared';
import SummaryContent from './SummaryContent.vue';
import SessionLogStream from './SessionLogStream.vue';
import MarkdownViewer from './MarkdownViewer.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();
const streamingStore = useSessionStreamingStore();
const { onSummaryUpdate, onSummaryGenerating, onWorkLog, onPartial, onThinkingPartial } = useSessionSubscription(props.sessionId);

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
const latestResponse = ref(null);
const latestResponseExpanded = ref(false);

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

// Overview metrics computed properties
const sessionCount = computed(() => {
  const descendants = sessionsStore.getAllDescendants(props.sessionId);
  return descendants.length + 1; // +1 for the session itself
});

const hasNonZeroCost = computed(() => {
  const bte = sessionsStore.getSessionBillableTokens(props.sessionId);
  return bte > 0;
});

const formattedCost = computed(() => {
  const bte = sessionsStore.getSessionBillableTokens(props.sessionId);
  return formatTokenCount(bte);
});

const workTimeMs = computed(() => {
  const s = session.value;
  if (!s) return null;
  const start = s.createdAt;
  const end = s.lastActivityAt || s.updatedAt || Date.now();
  return end - start;
});

const formattedDuration = computed(() => formatDuration(workTimeMs.value));

const hasMetrics = computed(() =>
  sessionCount.value > 1 || hasNonZeroCost.value || formattedDuration.value || filesCount.value > 0
);

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
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

const isContentLong = computed(() =>
  latestResponse.value?.message?.content?.length > 500
);

const displayedContent = computed(() => {
  const content = latestResponse.value?.message?.content || '';
  if (latestResponseExpanded.value || content.length <= 500) {
    return content;
  }
  return content.slice(0, 500) + '...';
});

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}

onMounted(async () => {
  // Fetch session summary
  loading.value = true;
  try {
    summary.value = await api.getSessionSummary(props.sessionId);

    // Fetch latest workflow response
    try {
      latestResponse.value = await api.getWorkflowLatestResponse(props.sessionId);
    } catch (error) {
      console.warn('Failed to fetch workflow latest response:', error);
    }

    // Fetch files count
    try {
      const result = await api.getSessionFilesCount(props.sessionId);
      filesCount.value = result.count || 0;
      // Fall back to summary's filesModified if API returns 0
      if (!filesCount.value && summary.value?.filesModified?.length) {
        filesCount.value = summary.value.filesModified.length;
      }
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
  onSummaryUpdate(async (newSummary) => {
    summary.value = newSummary;
    generating.value = false;       // Belt-and-suspenders: summary arrived = not generating
    generatingManual.value = false;

    // Re-fetch latest response when summary updates (triggered by session status transitions)
    try {
      latestResponse.value = await api.getWorkflowLatestResponse(props.sessionId);
    } catch (error) {
      // Non-fatal
    }
  });

  onSummaryGenerating((isGenerating) => {
    generating.value = isGenerating;
  });
});

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

.overview-metrics {
  display: flex;
  gap: 1.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--color-border);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.metric-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
}

.metric-label {
  font-size: 0.6875rem;
  color: var(--color-text-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

/* Latest Response Styles */
.latest-response {
  margin-bottom: 1.5rem;
}

.latest-response-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.latest-response-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.latest-response-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.response-session-name {
  opacity: 0.8;
}

.latest-response-content {
  position: relative;
  font-size: 0.875rem;
  line-height: 1.5;
}

.latest-response-content.collapsed {
  max-height: 300px;
  overflow: hidden;
}

.latest-response-content.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(transparent, var(--color-background-soft, #1e1e1e));
  pointer-events: none;
}

.expand-toggle {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
}

.expand-toggle:hover {
  text-decoration: underline;
}

</style>
