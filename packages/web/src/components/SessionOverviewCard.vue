<template>
  <div
    v-if="hasPrInfo || summary?.shortSummary || hasMetrics || scheduledSessions?.length > 0 || loading"
    class="session-overview card"
  >
    <div
      v-if="hasPrInfo || summary?.shortSummary || hasMetrics || loading"
      class="overview-header"
    >
      <h3>Workspace Overview</h3>
    </div>

    <!-- Summary in Overview -->
    <div
      v-if="summary?.shortSummary"
      class="overview-summary"
    >
      <p class="summary-text">
        {{ summary.shortSummary }}
      </p>
    </div>
    <div
      v-else-if="loading"
      class="overview-summary overview-summary-loading"
    >
      <span class="loading-spinner-small" />
      <span>Loading summary...</span>
    </div>

    <!-- Overview Metrics -->
    <div
      v-if="hasMetrics"
      class="overview-metrics"
    >
      <div
        v-if="sessionCount > 1"
        class="metric"
      >
        <span class="metric-value">{{ sessionCount }}</span>
        <span class="metric-label">Workspaces</span>
      </div>
      <div
        v-if="hasNonZeroTokens"
        class="metric"
      >
        <span class="metric-value">{{ formattedTokens }}</span>
        <span class="metric-label">Tokens</span>
      </div>
      <div
        v-if="formattedDuration"
        class="metric"
      >
        <span class="metric-value">{{ formattedDuration }}</span>
        <span class="metric-label">Work Time</span>
      </div>
      <div
        v-if="filesCount > 0"
        class="metric"
      >
        <span class="metric-value">{{ filesCount }}</span>
        <span class="metric-label">{{ filesCount === 1 ? 'File' : 'Files' }}</span>
      </div>
    </div>

    <!-- PR Info in Overview -->
    <div
      v-if="hasPrInfo"
      class="pr-section"
      data-testid="pr-section"
    >
      <div
        class="overview-pr"
        data-testid="pr-overview-badge"
      >
        <a
          :href="prUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="pr-link"
        >
          {{ extractPrNumber(prUrl) }}
        </a>
        <span :class="['status-badge', `pr-${summary?.prState}`]">
          {{ formatPrState(summary?.prState) }}
        </span>
        <span
          v-if="summary?.ciStatus === 'success' || summary?.ciStatus === 'pending'"
          :class="['status-badge', `ci-${summary.ciStatus}`]"
          data-testid="ci-status"
        >
          {{ summary.ciStatus === 'success' ? 'CI Passing' : 'CI Pending' }}
        </span>
      </div>

      <!-- Warnings: merge conflicts and CI failures -->
      <div
        v-if="hasWarnings"
        class="pr-warnings"
        data-testid="pr-warnings"
      >
        <div
          v-if="summary?.hasMergeConflicts"
          class="warning-item"
        >
          Merge conflicts detected
        </div>
        <div
          v-if="summary?.ciStatus === 'failure'"
          class="warning-item"
        >
          CI checks failing
        </div>
        <div
          v-if="summary?.ciFailures?.length"
          class="ci-failure-list"
        >
          <div
            v-for="failure in summary.ciFailures"
            :key="failure"
            class="ci-failure-item"
            data-testid="pr-ci-failure-item"
          >
            {{ failure }}
          </div>
        </div>
      </div>
    </div>

    <!-- Scheduled sessions (parent + children) -->
    <div
      v-if="scheduledSessions.length > 0"
      class="overview-scheduled-sessions"
    >
      <h4 class="scheduled-sessions-heading">
        Scheduled Workspaces ({{ scheduledSessions.length }})
      </h4>
      <div class="scheduled-sessions-list">
        <ScheduledChildCard
          v-for="s in scheduledSessions"
          :key="s.id"
          :session="s"
          :project-id="projectId"
          class="scheduled-session-card"
          @open-session-overlay="(sessionId) => $emit('open-session-overlay', sessionId)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { formatPrState, extractPrNumber } from '../composables/useSummaryHelpers.js';
import ScheduledChildCard from './ScheduledChildCard.vue';

defineProps({
  summary: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  hasPrInfo: {
    type: Boolean,
    default: false,
  },
  hasMetrics: {
    type: Boolean,
    default: false,
  },
  sessionCount: {
    type: Number,
    default: 1,
  },
  hasNonZeroTokens: {
    type: Boolean,
    default: false,
  },
  formattedTokens: {
    type: String,
    default: '',
  },
  formattedDuration: {
    type: String,
    default: '',
  },
  filesCount: {
    type: Number,
    default: 0,
  },
  prUrl: {
    type: String,
    default: null,
  },
  hasWarnings: {
    type: Boolean,
    default: false,
  },
  scheduledSessions: {
    type: Array,
    default: () => [],
  },
  projectId: {
    type: String,
    default: null,
  },
});

defineEmits(['open-session-overlay']);

</script>

<style scoped>
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

.loading-spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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

.overview-scheduled-sessions {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.scheduled-sessions-heading {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
}

.scheduled-sessions-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scheduled-session-card {
  padding: 0.75rem;
}

</style>
