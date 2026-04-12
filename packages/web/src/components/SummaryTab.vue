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
      :is-scheduled="isScheduled"
      :session-count="sessionCount"
      :has-non-zero-cost="hasNonZeroCost"
      :formatted-cost="formattedCost"
      :formatted-duration="formattedDuration"
      :files-count="filesCount"
      :pr-url="prUrl"
      :has-warnings="hasWarnings"
      :scheduled-time-display="scheduledTimeDisplay"
      :scheduling-countdown="schedulingCountdown"
      @edit-schedule="showScheduleTimeModal = true"
    />

    <!-- Scheduling Edit Modal -->
    <SchedulingEditModal
      v-if="isScheduled"
      :is-open="showScheduleTimeModal"
      :session="session"
      @close="showScheduleTimeModal = false"
      @saved="showScheduleTimeModal = false"
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
      v-else-if="!latestResponse && !isRunning"
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { format, formatDistanceToNow } from 'date-fns';
import { formatTokenCount } from '@claudetools/shared';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionsStore } from '../stores/sessions.js';
import SummaryContent from './SummaryContent.vue';
import SessionLogStream from './SessionLogStream.vue';
import SchedulingEditModal from './SchedulingEditModal.vue';
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
const showScheduleTimeModal = ref(false);
const nowTick = ref(Date.now());
let countdownInterval = null;

const session = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId)
  || (sessionsStore.currentSession?.id === props.sessionId ? sessionsStore.currentSession : null)
);
const isRunning = computed(() => {
  const status = session.value?.status;
  return status === 'running' || status === 'starting';
});
const isScheduled = computed(() => session.value?.status === 'scheduled');

const scheduledTimeDisplay = computed(() =>
  session.value?.scheduledAt
    ? format(new Date(session.value.scheduledAt), 'EEEE, MMMM d, yyyy h:mm a')
    : ''
);

const schedulingCountdown = computed(() =>
  session.value?.scheduledAt
    ? formatDistanceToNow(new Date(session.value.scheduledAt), { addSuffix: true, now: new Date(nowTick.value) })
    : ''
);

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

const hasNonZeroCost = computed(() => sessionsStore.getSessionBillableTokens(props.sessionId) > 0);

const formattedCost = computed(() => {
  const bte = sessionsStore.getSessionBillableTokens(props.sessionId);
  return formatTokenCount(bte);
});

const workTimeMs = computed(() => {
  const s = session.value;
  if (!s) return null;
  if (s.activeTimeMs && s.activeTimeMs > 0) return s.activeTimeMs;
  if (s.status === 'running' || s.status === 'starting') {
    return computeActiveSessionTime(s);
  }
  return computeIdleSessionTime(s, (id) => sessionsStore.getSessionBillableTokens(id));
});

const formattedDuration = computed(() => formatDuration(workTimeMs.value));

const hasMetrics = computed(() =>
  sessionCount.value > 1 || hasNonZeroCost.value || formattedDuration.value || filesCount.value > 0
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

  countdownInterval = setInterval(() => { nowTick.value = Date.now(); }, 1000);
});

onUnmounted(() => {
  if (countdownInterval) clearInterval(countdownInterval);
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
</style>
