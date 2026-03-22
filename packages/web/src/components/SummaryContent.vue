<template>
  <div class="summary-content card">
    <div v-if="generating" class="summary-updating">
      <span class="loading-spinner"></span>
      Updating summary...
    </div>

    <section v-if="summary.keyActions && summary.keyActions.length > 0" class="summary-section">
      <h3>Key Actions</h3>
      <ul class="key-actions-list">
        <li v-for="(action, index) in summary.keyActions" :key="index">
          <span class="action-icon">&#10003;</span>
          {{ action }}
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
