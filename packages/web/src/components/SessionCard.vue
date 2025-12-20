<template>
  <router-link :to="`/sessions/${session.id}`" class="session-card card">
    <div class="session-header-row">
      <div class="session-info">
        <h3 class="session-name">{{ session.name }}</h3>
        <p class="session-meta">
          <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
          <span class="session-mode">{{ session.mode }}</span>
          <span v-if="session.gitBranch" class="session-branch">{{ session.gitBranch }}</span>
          <a
            v-if="session.prUrl"
            :href="session.prUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="pr-link"
            @click.stop
          >
            <svg class="pr-icon" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
            </svg>
            {{ extractPrNumber(session.prUrl) }}
          </a>
        </p>
        <p v-if="showProject && session.projectName" class="session-project">
          <span class="project-name">{{ session.projectName }}</span>
        </p>
      </div>
      <div class="session-date">
        {{ formatDate(dateToShow) }}
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
});

defineEmits(['retrySummary']);

const dateToShow = computed(() => {
  // For active sessions view, prefer updatedAt; for project view, prefer createdAt
  return props.showProject ? props.session.updatedAt : props.session.createdAt;
});

function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR ${match[1]}` : 'PR';
}
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
  text-transform: capitalize;
}

.session-branch {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.pr-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: white;
  background: var(--color-primary);
  border-radius: 3px;
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
}

.pr-link:hover {
  background: var(--color-primary-hover, var(--color-primary));
  filter: brightness(1.1);
  color: white;
}

.pr-icon {
  width: 12px;
  height: 12px;
}

.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-date {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  flex-shrink: 0;
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
