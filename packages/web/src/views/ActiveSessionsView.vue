<template>
  <div class="container">
    <div class="page-header">
      <div>
        <p class="page-description">All active sessions across your projects</p>
      </div>
    </div>

    <div class="filters-container">
      <div class="status-filters">
        <button
          v-for="status in ['running', 'idle']"
          :key="status"
          :class="['filter-btn', { active: sessionsStore.statusFilter === status }]"
          @click="toggleFilter(status)"
        >
          {{ status }}
        </button>
        <button
          :class="[
            'filter-btn star-btn',
            {
              'star-filter-active': sessionsStore.starredFilter === 'starred',
              'star-filter-unstarred': sessionsStore.starredFilter === 'unstarred',
              'star-filter-all': sessionsStore.starredFilter === null
            }
          ]"
          :title="starFilterTooltip"
          @click="toggleStarFilterIcon"
        >
          <span class="star-icon" v-if="sessionsStore.starredFilter === 'starred'">⭐</span>
          <span class="star-icon star-crossed" v-else-if="sessionsStore.starredFilter === 'unstarred'">⭐</span>
          <span class="star-icon" v-else>☆</span>
        </button>
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
import { useGlobalSessionSubscription, useWebSocket } from '../composables/useWebSocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
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

const toggleStarredFilter = (filter) => {
  // If the clicked filter is already active, clear the filter (show all)
  if (sessionsStore.starredFilter === filter) {
    sessionsStore.setStarredFilter(null);
  } else {
    // Otherwise, set this filter as the only active one
    sessionsStore.setStarredFilter(filter);
  }
};

const toggleStarFilterIcon = () => {
  // Cycle through three states: null -> starred -> unstarred -> null
  if (sessionsStore.starredFilter === null) {
    sessionsStore.setStarredFilter('starred');
  } else if (sessionsStore.starredFilter === 'starred') {
    sessionsStore.setStarredFilter('unstarred');
  } else {
    sessionsStore.setStarredFilter(null);
  }
};

const starFilterTooltip = computed(() => {
  if (sessionsStore.starredFilter === 'starred') {
    return 'Showing starred sessions only. Click to filter unstarred.';
  } else if (sessionsStore.starredFilter === 'unstarred') {
    return 'Showing unstarred sessions only. Click to show all.';
  } else {
    return 'Showing all sessions. Click to filter by starred.';
  }
});

const filteredSessions = computed(() => {
  let sessions = sessionsStore.activeSessions;

  // Apply status filter if set
  if (sessionsStore.statusFilter) {
    sessions = sessions.filter(session => {
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
  }

  // Apply starred filter if set
  if (sessionsStore.starredFilter === 'starred') {
    sessions = sessions.filter(session => session.starred);
  } else if (sessionsStore.starredFilter === 'unstarred') {
    sessions = sessions.filter(session => !session.starred);
  }

  return sessions;
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
      await commandButtonsStore.fetchLatestRunsForProject(projectId);
      fetchedProjectIds.value.add(projectId);
    } catch (error) {
      console.error(`Failed to fetch buttons for project ${projectId}:`, error);
    }
  }
}

/**
 * Register session event handlers (created, updated, deleted, summary).
 */
function registerSessionEventHandlers(handlers, summaryState) {
  const { onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated } = handlers;

  cleanups.push(
    onSessionCreated((session) => {
      if (['running', 'waiting', 'starting'].includes(session.status)) {
        const exists = sessionsStore.activeSessions.some((s) => s.id === session.id);
        if (!exists) {
          sessionsStore.activeSessions.unshift(session);
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
      const isActive = ['running', 'waiting', 'starting'].includes(session.status);
      const existingIndex = sessionsStore.activeSessions.findIndex((s) => s.id === session.id);

      if (isActive) {
        if (existingIndex >= 0) {
          sessionsStore.activeSessions[existingIndex] = session;
        } else {
          sessionsStore.activeSessions.unshift(session);
        }
      } else if (existingIndex >= 0) {
        sessionsStore.activeSessions.splice(existingIndex, 1);
        delete summaryState.summaries[session.id];
        delete summaryState.loading[session.id];
        delete summaryState.errors[session.id];
      }
    })
  );

  cleanups.push(
    onSessionDeleted((sessionId) => {
      const existingIndex = sessionsStore.activeSessions.findIndex((s) => s.id === sessionId);
      if (existingIndex >= 0) {
        sessionsStore.activeSessions.splice(existingIndex, 1);
      }
      delete summaryState.summaries[sessionId];
      delete summaryState.loading[sessionId];
      delete summaryState.errors[sessionId];
    })
  );

  cleanups.push(
    onSessionSummaryUpdated((sessionId, summary) => {
      summaryState.summaries[sessionId] = summary;
      summaryState.loading[sessionId] = false;
      summaryState.errors[sessionId] = false;
    })
  );
}

/**
 * Ensure a command run entry exists in the store, creating one if needed.
 */
function ensureCommandRunExists(runId, buttonId, sessionId) {
  if (!commandButtonsStore.runs[runId]) {
    commandButtonsStore.runs[runId] = {
      runId,
      buttonId,
      sessionId,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: Date.now(),
      outputTruncated: false,
    };
  }
}

/**
 * Register command run WebSocket handlers.
 */
function registerCommandRunHandlers(ws) {
  const { on, off } = ws;

  const commandOutputHandler = (msg) => {
    ensureCommandRunExists(msg.runId, msg.buttonId, msg.sessionId);
    commandButtonsStore.appendOutput(msg.runId, msg.output);
  };
  on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, commandOutputHandler);
  cleanups.push(() => off(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, commandOutputHandler));

  const commandCompleteHandler = (msg) => {
    ensureCommandRunExists(msg.runId, msg.buttonId, msg.sessionId);
    commandButtonsStore.completeRun(msg.runId, msg.exitCode, msg.output);
  };
  on(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, commandCompleteHandler);
  cleanups.push(() => off(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, commandCompleteHandler));

  const commandErrorHandler = (msg) => {
    ensureCommandRunExists(msg.runId, msg.buttonId, msg.sessionId);
    commandButtonsStore.errorRun(msg.runId, msg.error);
  };
  on(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, commandErrorHandler);
  cleanups.push(() => off(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, commandErrorHandler));
}

onMounted(async () => {
  sessionsStore.restoreStatusFilter();
  sessionsStore.restoreStarredFilter();
  await sessionsStore.fetchActiveSessions();
  await ensureButtonsLoadedForSessions();

  const summaryState = { summaries, loading: loadingSummaries, errors: summaryErrors };
  registerSessionEventHandlers(
    { onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated },
    summaryState
  );
  registerCommandRunHandlers(useWebSocket());

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
  // Uses batch endpoint to fetch all summaries in a single HTTP request.
  const sessions = sessionsStore.activeSessions;
  const idsToFetch = sessions
    .filter(s => !summaries[s.id] && !loadingSummaries[s.id])
    .map(s => s.id);

  if (idsToFetch.length === 0) return;

  // Mark all as loading
  for (const id of idsToFetch) {
    loadingSummaries[id] = true;
    summaryErrors[id] = false;
  }

  try {
    const batchResult = await api.getSessionSummariesBatch(idsToFetch);
    for (const id of idsToFetch) {
      if (batchResult[id]) {
        summaries[id] = batchResult[id];
      }
      loadingSummaries[id] = false;
    }
  } catch (error) {
    console.warn('Failed to fetch summaries batch:', error.message);
    for (const id of idsToFetch) {
      summaryErrors[id] = true;
      loadingSummaries[id] = false;
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

/* Star icon wrapper - enables positioning for the slash */
.star-icon {
  position: relative;
  display: inline-block;
}

/* Default state - no filter (show all) */
.filter-btn.star-filter-all {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-soft);
}

.filter-btn.star-filter-all:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

/* Active state - filter by starred */
.filter-btn.star-filter-active,
.filter-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Unstarred state - filter by not starred (EXCLUDE starred) */
.filter-btn.star-filter-unstarred {
  background: transparent;
  border-color: #f97316; /* Orange for "exclude/negative" action */
  color: #f97316; /* Orange star */
}

/* Add diagonal line through the star */
.star-crossed::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -10%;
  right: -10%;
  height: 2px;
  background: currentColor; /* Inherits orange color */
  transform: translateY(-50%) rotate(-45deg);
  pointer-events: none;
}
</style>
