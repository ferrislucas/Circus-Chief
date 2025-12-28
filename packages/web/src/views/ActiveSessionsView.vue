<template>
  <div class="container">
    <div class="page-header">
      <div>
        <p class="page-description">All active sessions across your projects</p>
      </div>
    </div>

    <div class="status-filters">
      <span class="filter-label">Filter:</span>
      <button
        v-for="status in ['running', 'idle']"
        :key="status"
        :class="['filter-btn', { active: sessionsStore.statusFilter === status }]"
        @click="toggleFilter(status)"
      >
        {{ status }}
      </button>
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

    <div v-else-if="filteredSessions.length === 0" class="empty-state">
      <p>No sessions match the current filter.</p>
    </div>

    <div v-else class="session-list">
      <SessionCard
        v-for="session in filteredSessions"
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
import { onMounted, onUnmounted, reactive, watch, ref, computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useGlobalSessionSubscription } from '../composables/useWebSocket.js';
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';

const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();

// Statuses that count as "idle" (not actively running)
const IDLE_STATUSES = ['waiting', 'stopped', 'error'];
// Statuses that count as "running" (actively processing or starting up)
const RUNNING_STATUSES = ['running', 'starting'];

// Track which projects we've already fetched buttons for
const fetchedProjectIds = ref(new Set());

const toggleFilter = (status) => {
  // If the clicked filter is already active, clear all filters (show all)
  if (sessionsStore.statusFilter === status) {
    sessionsStore.setStatusFilter(null);
  } else {
    // Otherwise, set this filter as the only active one (exclusive)
    sessionsStore.setStatusFilter(status);
  }
};

const filteredSessions = computed(() => {
  const sessions = sessionsStore.activeSessions;
  if (!sessionsStore.statusFilter) return sessions;

  return sessions.filter(session => {
    const status = session.status;
    // "idle" filter matches waiting, stopped, or error statuses
    if (sessionsStore.statusFilter === 'idle' && IDLE_STATUSES.includes(status)) {
      return true;
    }
    // "running" filter matches running and starting statuses
    if (sessionsStore.statusFilter === 'running' && RUNNING_STATUSES.includes(status)) {
      return true;
    }
    return false;
  });
});

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

let refreshInterval = null;

// Store cleanup functions for WebSocket listeners
const cleanups = [];

// Get global session subscription for real-time updates across all projects
const { onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated } = useGlobalSessionSubscription();

/**
 * Fetch buttons for projects that have active sessions
 * Only fetches for projects we haven't already loaded
 */
async function ensureButtonsLoadedForSessions() {
  const uniqueProjectIds = new Set(
    sessionsStore.activeSessions
      .map((s) => s.projectId)
      .filter((id) => id && !fetchedProjectIds.value.has(id))
  );

  for (const projectId of uniqueProjectIds) {
    try {
      await commandButtonsStore.fetchButtons(projectId);
      fetchedProjectIds.value.add(projectId);
    } catch (error) {
      console.error(`Failed to fetch buttons for project ${projectId}:`, error);
    }
  }
}

onMounted(async () => {
  sessionsStore.restoreStatusFilter();
  await sessionsStore.fetchActiveSessions();

  // Fetch buttons for projects with active sessions
  await ensureButtonsLoadedForSessions();

  // Set up WebSocket listeners for real-time updates
  cleanups.push(
    onSessionCreated((session) => {
      // Add if it's an active session (running/waiting/starting)
      if (['running', 'waiting', 'starting'].includes(session.status)) {
        // Check if session already exists to avoid duplicates
        const exists = sessionsStore.activeSessions.some((s) => s.id === session.id);
        if (!exists) {
          sessionsStore.activeSessions.unshift(session);
          // Fetch buttons for this project if we haven't already
          if (session.projectId && !fetchedProjectIds.value.has(session.projectId)) {
            commandButtonsStore.fetchButtons(session.projectId);
            fetchedProjectIds.value.add(session.projectId);
          }
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

// Watch for sessions changes and fetch summaries + command buttons
watch(
  () => sessionsStore.activeSessions,
  () => {
    fetchSummaries();
    // Also ensure buttons are loaded for any new projects
    ensureButtonsLoadedForSessions();
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

.status-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.filter-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.filter-btn {
  background: none;
  border: 1px solid var(--color-border);
  padding: 0.375rem 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-soft);
  cursor: pointer;
  border-radius: var(--border-radius);
  transition: all 0.15s;
  text-transform: capitalize;
}

.filter-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.filter-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}
</style>
