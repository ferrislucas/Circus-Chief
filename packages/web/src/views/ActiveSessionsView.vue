<template>
  <div class="container">
    <div class="page-header">
      <div>
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
import { useGlobalSessionSubscription } from '../composables/useWebSocket.js';
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';

const sessionsStore = useSessionsStore();

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

let refreshInterval = null;

// Store cleanup functions for WebSocket listeners
const cleanups = [];

// Get global session subscription for real-time updates across all projects
const { onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated } = useGlobalSessionSubscription();

onMounted(() => {
  sessionsStore.fetchActiveSessions();

  // Set up WebSocket listeners for real-time updates
  cleanups.push(
    onSessionCreated((session) => {
      // Add if it's an active session (running/waiting/starting)
      if (['running', 'waiting', 'starting'].includes(session.status)) {
        // Check if session already exists to avoid duplicates
        const exists = sessionsStore.activeSessions.some((s) => s.id === session.id);
        if (!exists) {
          sessionsStore.activeSessions.unshift(session);
        }
      }
    })
  );

  cleanups.push(
    onSessionUpdated((session) => {
      // Handle status transitions: add to active if becoming active, remove if not
      const isActive = ['running', 'waiting', 'starting'].includes(session.status);
      const existingIndex = sessionsStore.activeSessions.findIndex((s) => s.id === session.id);

      if (isActive) {
        if (existingIndex >= 0) {
          // Update existing session
          sessionsStore.activeSessions[existingIndex] = session;
        } else {
          // Add to active sessions
          sessionsStore.activeSessions.unshift(session);
        }
      } else {
        // Remove from active sessions if no longer active
        if (existingIndex >= 0) {
          sessionsStore.activeSessions.splice(existingIndex, 1);
          // Clean up summary data
          delete summaries[session.id];
          delete loadingSummaries[session.id];
          delete summaryErrors[session.id];
        }
      }
    })
  );

  cleanups.push(
    onSessionDeleted((sessionId) => {
      const existingIndex = sessionsStore.activeSessions.findIndex((s) => s.id === sessionId);
      if (existingIndex >= 0) {
        sessionsStore.activeSessions.splice(existingIndex, 1);
      }
      // Clean up summary data
      delete summaries[sessionId];
      delete loadingSummaries[sessionId];
      delete summaryErrors[sessionId];
    })
  );

  // Handle session summary updated (real-time updates when summaries are generated)
  cleanups.push(
    onSessionSummaryUpdated((sessionId, summary) => {
      summaries[sessionId] = summary;
      loadingSummaries[sessionId] = false;
      summaryErrors[sessionId] = false;
    })
  );

  // Keep polling as a fallback (increased to 30s since we have real-time updates)
  refreshInterval = setInterval(() => {
    sessionsStore.fetchActiveSessions(false);
  }, 30000);
});

onUnmounted(() => {
  // Clean up WebSocket listeners
  cleanups.forEach((cleanup) => cleanup());
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
