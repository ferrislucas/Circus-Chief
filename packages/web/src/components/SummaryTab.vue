<template>
  <div class="summary-tab">
    <!-- Live output for running sessions (includes child sessions) -->
    <SessionLogStream
      v-if="runningSessionIds.length > 0"
      :session-ids="runningSessionIds"
    />

    <!-- Most Recent Agent Response -->
    <LatestResponseCard :latest-response="latestResponse" />

    <!-- Session Overview Section -->
    <SessionOverviewCard
      :summary="summary"
      :loading="loading"
      :has-pr-info="hasPrInfo"
      :has-metrics="hasMetrics"
      :session-count="sessionCount"
      :has-non-zero-tokens="hasNonZeroTokens"
      :formatted-tokens="formattedTokens"
      :formatted-duration="formattedDuration"
      :files-count="filesCount"
      :pr-url="prUrl"
      :has-warnings="hasWarnings"
      :scheduled-sessions="allScheduledSessions"
      :project-id="projectId"
      :show-not-started-state="showNotStartedStateInOverview"
    />

    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading summary...
    </div>

    <div
      v-else-if="generating"
      class="generating-state"
    >
      <span class="loading-spinner" />
      Generating summary...
    </div>

    <SummaryContent
      v-else-if="summary"
      :summary="summary"
      :generating="generating"
      :regenerating="generatingManual"
      @regenerate="handleRegenerate"
    />

    <!-- Empty state for sessions with no content -->
    <div
      v-else-if="showStandaloneNotStartedState"
      class="summary-empty-state"
    >
      <div class="summary-empty-state-content">
        <p class="summary-empty-state-text">
          This session hasn't started yet.
        </p>
        <p class="summary-empty-state-hint">
          Start the session or send a message to see a summary here.
        </p>
      </div>
    </div>

    <div
      v-else-if="latestResponse"
      class="missing-summary-action"
    >
      <span class="missing-summary-text">No summary has been generated yet.</span>
      <button
        class="btn-link"
        :disabled="generatingManual"
        @click="handleRegenerate"
      >
        <span
          v-if="generatingManual"
          class="loading-spinner"
        />
        Generate summary
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { formatTokenCount } from '@circuschief/shared';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionsStore } from '../stores/sessions.js';
import SummaryContent from './SummaryContent.vue';
import SessionLogStream from './SessionLogStream.vue';
import LatestResponseCard from './LatestResponseCard.vue';
import SessionOverviewCard from './SessionOverviewCard.vue';
import { useSummaryStreaming } from '../composables/useSummaryStreaming.js';
import {
  computeActiveSessionTime,
  computeIdleSessionTime,
  formatDuration,
} from '../composables/useSummaryHelpers.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const uiStore = useUiStore();
const sessionsStore = useSessionsStore();

// Set up streaming subscriptions (primary + descendants)
const { onSummaryUpdate, onSummaryGenerating, onMessage } = useSummaryStreaming(props.sessionId);

// Listen for new assistant messages to update Latest Response in real time
onMessage((message) => {
  if (message.role === 'assistant' && message.content) {
    latestResponse.value = {
      message,
      sessionName: session.value?.name || null,
    };
  }
});

const summary = ref(null);
const loading = ref(false);
const generating = ref(false);
const generatingManual = ref(false);
const filesCount = ref(0);
const latestResponse = ref(null);

const session = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId)
  || (sessionsStore.currentSession?.id === props.sessionId ? sessionsStore.currentSession : null)
);
const isRunning = computed(() => {
  const status = session.value?.status;
  return status === 'running' || status === 'starting';
});

const allScheduledSessions = computed(() => {
  const result = [];
  // Include parent if scheduled
  if (session.value?.status === 'scheduled') {
    result.push(session.value);
  }
  // Include all scheduled descendants
  const descendants = sessionsStore.getAllDescendants(props.sessionId);
  for (const d of descendants) {
    if (d.status === 'scheduled') {
      result.push(d);
    }
  }
  return result;
});

const projectId = computed(() => session.value?.projectId || null);

const runningSessionIds = computed(() => {
  const ids = [];
  if (isRunning.value) {
    ids.push(props.sessionId);
  }
  const descendants = sessionsStore.getAllDescendants(props.sessionId);
  for (const d of descendants) {
    if (d.status === 'running' || d.status === 'starting') {
      ids.push(d.id);
    }
  }
  return ids;
});

const prUrl = computed(() => session.value?.prUrl || null);
const hasPrInfo = computed(() => prUrl.value && summary.value?.prState);
const hasWarnings = computed(() => summary.value?.hasMergeConflicts || summary.value?.ciStatus === 'failure');

const sessionCount = computed(() => {
  const descendants = sessionsStore.getAllDescendants(props.sessionId);
  return descendants.length + 1;
});

const hasNonZeroTokens = computed(() => sessionsStore.getSessionTokenTotal(props.sessionId) > 0);

const formattedTokens = computed(() => {
  const tokens = sessionsStore.getSessionTokenTotal(props.sessionId);
  return formatTokenCount(tokens);
});

const workTimeMs = computed(() => {
  const s = session.value;
  if (!s) return null;
  if (s.activeTimeMs && s.activeTimeMs > 0) return s.activeTimeMs;
  if (s.status === 'running' || s.status === 'starting') {
    return computeActiveSessionTime(s);
  }
  return computeIdleSessionTime(s, (id) => sessionsStore.getSessionTokenTotal(id));
});

const formattedDuration = computed(() => formatDuration(workTimeMs.value));

const hasMetrics = computed(() =>
  sessionCount.value > 1 || hasNonZeroTokens.value || formattedDuration.value || filesCount.value > 0
);

const isNotStartedEmptyState = computed(() => !latestResponse.value && !isRunning.value);
const showNotStartedStateInOverview = computed(() =>
  Boolean(isNotStartedEmptyState.value && (hasMetrics.value || allScheduledSessions.value.length > 0))
);
const showStandaloneNotStartedState = computed(() =>
  Boolean(isNotStartedEmptyState.value && !showNotStartedStateInOverview.value)
);

onMounted(async () => {
  loading.value = true;
  try {
    summary.value = await api.getSessionSummary(props.sessionId);

    try {
      latestResponse.value = await api.getWorkflowLatestResponse(props.sessionId);
    } catch (error) {
      console.warn('Failed to fetch workflow latest response:', error);
    }

    try {
      const result = await api.getSessionFilesCount(props.sessionId);
      filesCount.value = result.count || 0;
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
    if (!err.message.includes('404')) {
      uiStore.error(err.message);
    }
  } finally {
    loading.value = false;
  }

  onSummaryUpdate(async (newSummary) => {
    summary.value = newSummary;
    generating.value = false;
    generatingManual.value = false;

    try {
      latestResponse.value = await api.getWorkflowLatestResponse(props.sessionId);
    } catch (_error) {
      // Non-fatal
    }
  });

  onSummaryGenerating((isGenerating) => {
    generating.value = isGenerating;
  });
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

.summary-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  text-align: center;
}

.summary-empty-state-content {
  max-width: 320px;
}

.summary-empty-state-text {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text);
  margin: 0 0 0.5rem;
}

.summary-empty-state-hint {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  margin: 0;
  line-height: 1.4;
}

.missing-summary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  color: var(--color-text-soft);
}

.missing-summary-text {
  font-size: 0.875rem;
}
</style>
