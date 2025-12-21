<template>
  <div class="container">
    <div class="page-header">
      <div>
        <router-link to="/" class="back-link">&larr; Projects</router-link>
        <p class="page-description">Sessions that are running or waiting for input</p>
      </div>
    </div>

    <div v-if="sessionsStore.loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton card" style="height: 120px"></div>
    </div>

    <div v-else-if="sessionsStore.error" class="error-message">
      {{ sessionsStore.error }}
    </div>

    <div v-else-if="sessionsStore.activeSessions.length === 0" class="empty-state">
      <p>No active sessions. All sessions are completed or there are no sessions yet.</p>
      <router-link to="/" class="btn btn-primary">View Projects</router-link>
    </div>

    <div v-else class="session-list">
      <SessionCard
        v-for="session in sessionsStore.activeSessions"
        :key="session.id"
        :session="session"
        :show-project="true"
        :show-summary="true"
        :summary="summaries[session.id]"
        :summary-loading="loadingSummaries[session.id]"
        :summary-error="summaryErrors[session.id]"
        @retry-summary="retryFetchSummary"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, reactive, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';

const sessionsStore = useSessionsStore();

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

let refreshInterval = null;

onMounted(() => {
  sessionsStore.fetchActiveSessions();

  // Auto-refresh every 10 seconds
  refreshInterval = setInterval(() => {
    sessionsStore.fetchActiveSessions(false);
  }, 10000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

// Watch for sessions changes and fetch summaries
watch(
  () => sessionsStore.activeSessions,
  () => {
    fetchSummaries();
  },
  { immediate: true }
);

async function fetchSummaries() {
  const sessions = sessionsStore.activeSessions;
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
  } catch (error) {
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

.page-description {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
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
</style>
