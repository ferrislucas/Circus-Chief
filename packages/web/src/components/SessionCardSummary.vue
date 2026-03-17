<template>
  <div v-if="summary" class="session-summary">
    <p class="summary-text">{{ summary.shortSummary }}</p>
    <div class="summary-meta">
      <span v-if="filesCount > 0" class="summary-files">
        {{ filesCount }} {{ filesCount === 1 ? 'file' : 'files' }} modified
      </span>
    </div>
  </div>
  <div v-else-if="summaryLoading" class="session-summary session-summary-loading">
    <span class="loading-spinner-small"></span>
    <span>Loading summary...</span>
  </div>
  <div v-else-if="summaryError" class="session-summary session-summary-error">
    <span class="error-icon">!</span>
    <span>Summary unavailable</span>
    <button class="retry-btn" @click.prevent="$emit('retrySummary')">Retry</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  summary: {
    type: Object,
    default: null,
  },
  summaryLoading: {
    type: Boolean,
    default: false,
  },
  summaryError: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['retrySummary']);

const filesCount = ref(0);

onMounted(async () => {
  try {
    const result = await api.getSessionFilesCount(props.sessionId);
    filesCount.value = result.count || 0;
  } catch (error) {
    console.warn('Failed to fetch files count:', error);
    if (props.summary?.filesModified?.length) {
      filesCount.value = props.summary.filesModified.length;
    }
  }
});
</script>

<style scoped>
.session-summary {
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}

.session-summary-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.session-summary-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background-color: var(--color-warning);
  color: white;
  border-radius: 50%;
  font-size: 0.625rem;
  font-weight: bold;
}

.retry-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
}

.retry-btn:hover {
  text-decoration: underline;
}

.summary-text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.summary-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.summary-files {
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
</style>
