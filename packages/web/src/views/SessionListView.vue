<template>
  <div class="container">
    <div class="page-header">
      <div>
        <router-link to="/" class="back-link">&larr; Projects</router-link>
        <h1>{{ projectsStore.currentProject?.name || 'Sessions' }}</h1>
        <p v-if="projectsStore.currentProject" class="project-path">
          {{ projectsStore.currentProject.workingDirectory }}
        </p>
      </div>
      <router-link :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary">
        New Session
      </router-link>
    </div>

    <div v-if="sessionsStore.loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton card" style="height: 120px"></div>
    </div>

    <div v-else-if="sessionsStore.error" class="error-message">
      {{ sessionsStore.error }}
    </div>

    <div v-else-if="sessionsStore.sessions.length === 0" class="empty-state">
      <p>No sessions yet. Start a new session to interact with Claude.</p>
      <router-link :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary">
        Start Session
      </router-link>
    </div>

    <div v-else class="session-list">
      <router-link
        v-for="session in sessionsStore.sessions"
        :key="session.id"
        :to="`/sessions/${session.id}`"
        class="session-card card"
      >
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
                PR
              </a>
            </p>
          </div>
          <div class="session-date">
            {{ formatDate(session.createdAt) }}
          </div>
        </div>
        <div v-if="summaries[session.id]" class="session-summary">
          <p class="summary-text">{{ summaries[session.id].shortSummary }}</p>
          <div class="summary-meta">
            <span v-if="summaries[session.id].filesModified?.length" class="summary-files">
              {{ summaries[session.id].filesModified.length }} files modified
            </span>
            <span v-if="session.costUsd" class="summary-cost">
              ${{ session.costUsd.toFixed(2) }}
            </span>
          </div>
        </div>
        <div v-else-if="loadingSummaries[session.id]" class="session-summary session-summary-loading">
          <span class="loading-spinner-small"></span>
          <span>Loading summary...</span>
        </div>
        <div v-else-if="summaryErrors[session.id]" class="session-summary session-summary-error">
          <span class="error-icon">!</span>
          <span>Summary unavailable</span>
          <button class="retry-btn" @click.prevent="retryFetchSummary(session.id)">Retry</button>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { api } from '../composables/useApi.js';

const route = useRoute();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

onMounted(async () => {
  projectsStore.fetchProject(route.params.id);
  await sessionsStore.fetchSessions(route.params.id);
  // Fetch summaries for loaded sessions
  fetchSummaries();
});

// Watch for sessions changes and fetch summaries
watch(
  () => sessionsStore.sessions,
  () => {
    fetchSummaries();
  }
);

async function fetchSummaries() {
  // Fetch summaries for all sessions (in parallel, but with some rate limiting)
  const sessions = sessionsStore.sessions;
  for (const session of sessions) {
    if (!summaries[session.id] && !loadingSummaries[session.id]) {
      fetchSummary(session.id);
    }
  }
}

async function fetchSummary(sessionId) {
  loadingSummaries[sessionId] = true;
  summaryErrors[sessionId] = false;
  try {
    const summary = await api.getSessionSummary(sessionId);
    if (summary) {
      summaries[sessionId] = summary;
    }
    // No summary yet is not an error - it just means one hasn't been generated
  } catch (error) {
    // Log error for debugging but don't show as error if it's just a 404 (no summary yet)
    if (error.response?.status !== 404) {
      console.warn(`Failed to fetch summary for session ${sessionId}:`, error.message);
      summaryErrors[sessionId] = true;
    }
  } finally {
    loadingSummaries[sessionId] = false;
  }
}

async function retryFetchSummary(sessionId) {
  summaryErrors[sessionId] = false;
  await fetchSummary(sessionId);
}

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
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.5rem;
}

.page-header h1 {
  margin: 0;
}

.project-path {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

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
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 3px;
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
}

.pr-link:hover {
  background: var(--color-primary);
  color: white;
}

.pr-icon {
  width: 12px;
  height: 12px;
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

.summary-cost {
  font-family: var(--font-mono);
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
  .page-header {
    flex-direction: column;
    gap: 1rem;
  }

  .page-header .btn {
    width: 100%;
    justify-content: center;
  }

  .project-path {
    word-break: break-all;
  }
}
</style>
