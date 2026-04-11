<template>
  <div
    v-if="hasPrInfo || summary?.shortSummary || hasMetrics || isScheduled || loading"
    class="session-overview card"
  >
    <div
      v-if="hasPrInfo || summary?.shortSummary || hasMetrics || loading"
      class="overview-header"
    >
      <h3>Session Overview</h3>
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
        <span class="metric-label">Sessions</span>
      </div>
      <div
        v-if="hasNonZeroCost"
        class="metric"
      >
        <span class="metric-value">{{ formattedCost }}</span>
        <span class="metric-label">Cost</span>
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

    <!-- Scheduling section (only for scheduled sessions) -->
    <div
      v-if="isScheduled"
      class="overview-scheduling"
    >
      <span class="scheduling-icon">⏰</span>
      <div class="scheduling-details">
        <p class="scheduling-time">
          Scheduled for <strong>{{ scheduledTimeDisplay }}</strong>
        </p>
        <p class="scheduling-countdown">
          {{ schedulingCountdown }}
        </p>
      </div>
      <button
        class="btn-link scheduling-edit-link"
        @click="$emit('edit-schedule')"
      >
        Edit time
      </button>
    </div>
  </div>
</template>

<script setup>
import { formatPrState, extractPrNumber } from '../composables/useSummaryHelpers.js';

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
  isScheduled: {
    type: Boolean,
    default: false,
  },
  sessionCount: {
    type: Number,
    default: 1,
  },
  hasNonZeroCost: {
    type: Boolean,
    default: false,
  },
  formattedCost: {
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
  scheduledTimeDisplay: {
    type: String,
    default: '',
  },
  schedulingCountdown: {
    type: String,
    default: '',
  },
});

defineEmits(['edit-schedule']);
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

.overview-scheduling {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.overview-scheduling .scheduling-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.scheduling-details {
  flex: 1;
  min-width: 0;
}

.scheduling-time {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
}

.scheduling-time strong {
  color: var(--color-primary);
  font-weight: 600;
}

.scheduling-countdown {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}

.scheduling-edit-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  padding: 0;
}

.scheduling-edit-link:hover {
  text-decoration: underline;
}
</style>
