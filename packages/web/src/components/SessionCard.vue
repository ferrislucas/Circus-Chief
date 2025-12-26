<template>
  <router-link :to="`/sessions/${session.id}`" class="session-card card">
    <div class="session-header-row">
      <div class="session-info">
        <h3 class="session-name">{{ session.name }}</h3>
        <p class="session-meta">
          <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
          <span class="session-mode">{{ formattedMode }}</span>
          <span class="session-model">{{ formattedModel }}</span>
        </p>
        <div v-if="session.gitBranch || session.prUrl" class="branch-row">
          <span v-if="session.gitBranch" class="session-branch">{{ session.gitBranch }}</span>
          <PrIndicators
            v-if="session.prUrl"
            :pr-url="session.prUrl"
            :summary="summary"
          />
        </div>
        <p v-if="showProject && session.projectName" class="session-project">
          <span class="project-name">{{ session.projectName }}</span>
        </p>
      </div>
      <div class="session-header-actions">
        <div class="session-date">
          {{ formatDate(dateToShow) }}
        </div>
        <div v-if="showArchive || showUnarchive" class="archive-actions">
          <button
            v-if="showArchive && canArchive"
            class="archive-btn"
            title="Archive session"
            @click.stop.prevent="$emit('archive', session.id)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
              <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
              <path d="M10 13h4"></path>
            </svg>
          </button>
          <button
            v-if="showUnarchive"
            class="archive-btn"
            title="Unarchive session"
            @click.stop.prevent="$emit('unarchive', session.id)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
              <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
              <path d="M12 11v6"></path>
              <path d="M9 14l3-3 3 3"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div v-if="showSummary">
      <div v-if="summary" class="session-summary">
        <p class="summary-text">{{ summary.shortSummary }}</p>
        <div class="summary-meta">
          <span v-if="summary.filesModified?.length" class="summary-files">
            {{ summary.filesModified.length }} files modified
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
        <button class="retry-btn" @click.prevent="$emit('retrySummary', session.id)">Retry</button>
      </div>
    </div>
  </router-link>
</template>

<script setup>
import { computed } from 'vue';
import { formatDate } from '../utils/formatters.js';
import { useModelInfo } from '../composables/useModelInfo.js';
import PrIndicators from './PrIndicators.vue';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  showSummary: {
    type: Boolean,
    default: false,
  },
  showProject: {
    type: Boolean,
    default: false,
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
  showArchive: {
    type: Boolean,
    default: false,
  },
  showUnarchive: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['retrySummary', 'archive', 'unarchive']);

const { getModelDisplayName } = useModelInfo();

// Show archive for any status except running
const canArchive = computed(() => {
  return props.session.status !== 'running';
});

const dateToShow = computed(() => {
  // For active sessions view, prefer updatedAt; for project view, prefer createdAt
  return props.showProject ? props.session.updatedAt : props.session.createdAt;
});

const formattedMode = computed(() => {
  const mode = props.session.mode;
  if (mode === 'yolo') return 'YOLO';
  // Capitalize first letter for other modes
  return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '';
});

const formattedModel = computed(() => {
  return getModelDisplayName(props.session.model);
});
</script>

<style scoped>
.session-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: var(--color-text);
  text-decoration: none;
  transition: border-color 0.2s;
}

.session-card:hover {
  border-color: var(--color-primary);
  text-decoration: none;
}

.session-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.session-name {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.session-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-mode {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.branch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.375rem;
}

.session-branch {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.session-date {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.archive-actions {
  display: flex;
  gap: 0.25rem;
}

.archive-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.archive-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

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

@media (max-width: 480px) {
  .session-header-row {
    flex-direction: column;
    gap: 0.5rem;
  }

  .session-date {
    flex-shrink: 1;
    align-self: flex-start;
  }
}
</style>
