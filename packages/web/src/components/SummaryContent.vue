<template>
  <div class="summary-content card">
    <div v-if="generating" class="summary-updating">
      <span class="loading-spinner"></span>
      Updating summary...
    </div>

    <section class="summary-section">
      <h3>Overview</h3>
      <p class="full-summary">{{ summary.fullSummary }}</p>
    </section>

    <section v-if="summary.keyActions && summary.keyActions.length > 0" class="summary-section">
      <h3>Key Actions</h3>
      <ul class="key-actions-list">
        <li v-for="(action, index) in summary.keyActions" :key="index">
          <span class="action-icon">&#10003;</span>
          {{ action }}
        </li>
      </ul>
    </section>

    <section v-if="summary.filesModified && summary.filesModified.length > 0" class="summary-section">
      <h3>Files Modified</h3>
      <ul class="files-list">
        <li v-for="(file, index) in summary.filesModified" :key="index" class="file-item">
          <span class="file-icon">&#128196;</span>
          <code>{{ file }}</code>
        </li>
      </ul>
    </section>

    <section class="summary-section">
      <h3>Outcome</h3>
      <span :class="['outcome-badge', `outcome-${summary.outcome}`]">
        {{ formatOutcome(summary.outcome) }}
      </span>
    </section>

    <section v-if="hasPrInfo" class="summary-section" data-testid="pr-section">
      <h3>Pull Request</h3>
      <div class="pr-info">
        <div class="pr-header">
          <a :href="prUrl" target="_blank" class="pr-link">
            {{ extractPrNumber(prUrl) }}
          </a>
          <span :class="['status-badge', `pr-${summary.prState}`]">
            {{ formatPrState(summary.prState) }}
          </span>
        </div>

        <div v-if="summary.hasMergeConflicts || summary.ciStatus === 'failure'" class="pr-warnings" data-testid="pr-warnings">
          <div v-if="summary.hasMergeConflicts" class="warning-item conflict-warning">
            <span class="warning-icon">&#x26A0;&#xFE0F;</span>
            <span>Merge conflicts detected</span>
          </div>

          <div v-if="summary.ciStatus === 'failure'" class="warning-item ci-warning">
            <span class="warning-icon">&#x274C;</span>
            <span>CI checks failing</span>
            <ul v-if="summary.ciFailures?.length" class="failure-list">
              <li v-for="failure in summary.ciFailures" :key="failure" data-testid="pr-ci-failure-item">
                {{ failure }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="summary.ciStatus && summary.ciStatus !== 'failure'" class="ci-status" data-testid="ci-status">
          <span :class="['status-badge', `ci-${summary.ciStatus}`]">
            {{ summary.ciStatus === 'success' ? '&#x2713; CI Passing' : '&#x23F3; CI Pending' }}
          </span>
        </div>
      </div>
    </section>

    <div class="summary-footer">
      <span class="summary-date">
        Last updated: {{ formatDate(summary.generatedAt) }}
      </span>
      <button class="btn-link" @click="$emit('regenerate')" :disabled="regenerating">
        <span v-if="regenerating" class="loading-spinner"></span>
        Regenerate
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  summary: { type: Object, required: true },
  generating: { type: Boolean, default: false },
  regenerating: { type: Boolean, default: false },
  hasPrInfo: { type: Boolean, default: false },
  prUrl: { type: String, default: null },
});

defineEmits(['regenerate']);

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOutcome(outcome) {
  const labels = {
    completed: 'Task Completed Successfully',
    partial: 'Partial Progress',
    failed: 'Task Failed',
    ongoing: 'In Progress',
  };
  return labels[outcome] || outcome;
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
</script>

<style scoped>
.summary-content {
  position: relative;
}

.summary-updating {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.summary-section {
  margin-bottom: 1.5rem;
}

.summary-section:last-of-type {
  margin-bottom: 0;
}

.summary-section h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  margin: 0 0 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.full-summary {
  margin: 0;
  line-height: 1.6;
}

.key-actions-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.key-actions-list li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.action-icon {
  color: var(--color-success);
  flex-shrink: 0;
}

.files-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.file-icon {
  flex-shrink: 0;
}

.file-item code {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background-color: var(--color-bg-soft);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.outcome-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
}

.outcome-completed {
  background-color: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.outcome-partial {
  background-color: rgba(210, 153, 34, 0.15);
  color: var(--color-warning);
}

.outcome-failed {
  background-color: rgba(248, 81, 73, 0.15);
  color: var(--color-error);
}

.outcome-ongoing {
  background-color: rgba(88, 166, 255, 0.15);
  color: var(--color-primary);
}

.summary-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.summary-date {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* PR Status Styles */
.pr-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pr-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pr-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.pr-link:hover {
  text-decoration: underline;
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

.pr-warnings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.warning-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
}

.conflict-warning {
  background-color: rgba(248, 81, 73, 0.1);
  color: var(--color-error);
}

.ci-warning {
  background-color: rgba(248, 81, 73, 0.1);
  color: var(--color-error);
  flex-wrap: wrap;
}

.failure-list {
  width: 100%;
  margin: 0.25rem 0 0 1.5rem;
  padding: 0;
  font-size: 0.8rem;
  opacity: 0.9;
  list-style: disc;
}

.ci-status {
  margin-top: 0.25rem;
}
</style>
