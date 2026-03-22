<template>
  <div class="summary-content card">
    <div v-if="generating" class="summary-updating">
      <span class="loading-spinner"></span>
      Updating summary...
    </div>

    <section v-if="summary.keyActions && summary.keyActions.length > 0" class="summary-section last-action-section">
      <h3>Last Action</h3>
      <div class="last-action-content">
        <span class="last-action-icon">&#8594;</span>
        <div class="last-action-details">
          <span class="last-action-text">{{ summary.keyActions[0] }}</span>
          <span class="action-timestamp">{{ formatActionTimestamp(summary.generatedAt) }}</span>
        </div>
      </div>
    </section>

    <section v-if="summary.keyActions && summary.keyActions.length > 1" class="summary-section">
      <h3>Key Actions</h3>
      <ul class="key-actions-list">
        <li v-for="(action, index) in summary.keyActions.slice(1)" :key="index">
          <span class="action-icon">&#10003;</span>
          <div class="action-details">
            {{ action }}
            <span class="action-timestamp">{{ formatActionTimestamp(summary.generatedAt) }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="summary-section">
      <h3>Overview</h3>
      <p class="full-summary">{{ summary.fullSummary }}</p>
    </section>

    <div class="summary-footer">
      <span class="summary-date">
        Last updated: {{ formatDate(summary.generatedAt) }}
      </span>
      <button class="btn-link" @click="$emit('regenerate')" :disabled="regenerating">
        <span v-if="regenerating" class="loading-spinner"></span>
        Generate summary
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  summary: { type: Object, required: true },
  generating: { type: Boolean, default: false },
  regenerating: { type: Boolean, default: false },
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

function formatActionTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
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

.last-action-section {
  background: rgba(0, 188, 212, 0.08);
  border-left: 3px solid var(--color-primary);
  padding: 1rem;
  border-radius: 6px;
}

.last-action-content {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.last-action-icon {
  color: var(--color-primary);
  font-size: 1.2rem;
  flex-shrink: 0;
}

.last-action-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.last-action-text {
  line-height: 1.5;
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

.action-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.action-timestamp {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-weight: 400;
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
</style>
