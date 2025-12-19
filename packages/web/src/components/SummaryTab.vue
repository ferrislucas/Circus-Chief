<template>
  <div class="summary-tab">
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading summary...
    </div>

    <div v-else-if="generating" class="generating-state">
      <span class="loading-spinner"></span>
      Generating summary...
    </div>

    <div v-else-if="!summary" class="empty-state">
      <p>No summary available yet.</p>
      <button class="btn btn-primary" @click="handleGenerate" :disabled="generatingManual">
        <span v-if="generatingManual" class="loading-spinner"></span>
        Generate Summary
      </button>
    </div>

    <div v-else class="summary-content card">
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

      <div class="summary-footer">
        <span class="summary-date">
          Last updated: {{ formatDate(summary.generatedAt) }}
        </span>
        <button class="btn-link" @click="handleRegenerate" :disabled="generatingManual">
          <span v-if="generatingManual" class="loading-spinner"></span>
          Regenerate
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const uiStore = useUiStore();
const { onSummaryUpdate, onSummaryGenerating } = useSessionSubscription(props.sessionId);

const summary = ref(null);
const loading = ref(false);
const generating = ref(false);
const generatingManual = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    summary.value = await api.getSessionSummary(props.sessionId);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    loading.value = false;
  }

  // Listen for WebSocket updates
  onSummaryUpdate((newSummary) => {
    summary.value = newSummary;
    generatingManual.value = false;
  });

  onSummaryGenerating((isGenerating) => {
    generating.value = isGenerating;
  });
});

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

async function handleGenerate() {
  generatingManual.value = true;
  try {
    summary.value = await api.generateSessionSummary(props.sessionId);
    uiStore.success('Summary generated');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    generatingManual.value = false;
  }
}

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

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

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
</style>
