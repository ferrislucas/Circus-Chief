<template>
  <div class="container">
    <div class="page-header">
      <div>
        <h1>{{ projectsStore.currentProject?.name || 'Sessions' }}</h1>
        <p v-if="projectsStore.currentProject" class="project-path">
          {{ projectsStore.currentProject.workingDirectory }}
        </p>
      </div>
      <router-link v-if="activeTab === 'sessions'" :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary">
        New Session
      </router-link>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: activeTab === 'sessions' }"
        @click="activeTab = 'sessions'"
      >
        Sessions
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'archived' }"
        @click="handleArchivedTabClick"
      >
        Archived
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'templates' }"
        @click="activeTab = 'templates'"
      >
        Templates
      </button>
    </div>

    <!-- Status Filters -->
    <div v-if="activeTab === 'sessions'" class="status-filters">
      <span class="filter-label">Filter:</span>
      <button
        v-for="status in ['running', 'waiting']"
        :key="status"
        :class="['filter-btn', { active: statusFilters.includes(status) }]"
        @click="toggleFilter(status)"
      >
        {{ status }}
      </button>
    </div>

    <!-- Sessions Tab -->
    <div v-if="activeTab === 'sessions'">
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

      <div v-else-if="filteredSessions.length === 0" class="empty-state">
        <p>No sessions match the current filter.</p>
      </div>

      <div v-else class="session-list">
        <SessionCard
          v-for="session in filteredSessions"
          :key="session.id"
          :session="session"
          :show-summary="true"
          :summary="summaries[session.id]"
          :summary-loading="loadingSummaries[session.id]"
          :summary-error="summaryErrors[session.id]"
          :show-archive="true"
          @retry-summary="retryFetchSummary"
          @archive="handleArchive"
        />
      </div>
    </div>

    <!-- Archived Tab -->
    <div v-if="activeTab === 'archived'">
      <div v-if="sessionsStore.loading" class="skeleton-list">
        <div v-for="i in 3" :key="i" class="skeleton card" style="height: 120px"></div>
      </div>

      <div v-else-if="sessionsStore.error" class="error-message">
        {{ sessionsStore.error }}
      </div>

      <div v-else-if="sessionsStore.archivedSessions.length === 0" class="empty-state">
        <p>No archived sessions. Archive completed sessions to keep your session list tidy.</p>
      </div>

      <div v-else class="session-list">
        <SessionCard
          v-for="session in sessionsStore.archivedSessions"
          :key="session.id"
          :session="session"
          :show-summary="true"
          :summary="summaries[session.id]"
          :summary-loading="loadingSummaries[session.id]"
          :summary-error="summaryErrors[session.id]"
          :show-unarchive="true"
          @retry-summary="retryFetchSummary"
          @unarchive="handleUnarchive"
        />
      </div>
    </div>

    <!-- Templates Tab -->
    <div v-if="activeTab === 'templates'">
      <TemplatesPanel :project-id="route.params.id" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useProjectSubscription } from '../composables/useWebSocket.js';
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';
import TemplatesPanel from '../components/TemplatesPanel.vue';

const route = useRoute();
const activeTab = ref('sessions');
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();

// Filter state - empty means show all
const statusFilters = ref([]);

const toggleFilter = (status) => {
  const index = statusFilters.value.indexOf(status);
  if (index >= 0) {
    statusFilters.value.splice(index, 1);
  } else {
    statusFilters.value.push(status);
  }
};

const filteredSessions = computed(() => {
  const sessions = sessionsStore.sessions;
  if (statusFilters.value.length === 0) return sessions;
  return sessions.filter(s => statusFilters.value.includes(s.status));
});

// Get projectId as computed to handle route changes
const projectId = computed(() => route.params.id);

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

// Track if archived sessions have been loaded
const archivedLoaded = ref(false);

// Store cleanup functions for WebSocket listeners
const cleanups = [];

// Track current unsubscribe function for cleanup when projectId changes
let currentUnsubscribe = null;

// Watch for projectId changes to properly subscribe/unsubscribe
watch(
  projectId,
  async (newProjectId) => {
    if (!newProjectId) return;

    // Clean up previous subscription handlers
    cleanups.forEach((cleanup) => cleanup());
    cleanups.length = 0;

    // Unsubscribe from old project
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
    }

    // Fetch new project data
    projectsStore.fetchProject(newProjectId);
    await sessionsStore.fetchSessions(newProjectId);
    fetchSummaries();

    // Create new subscription for new project
    const { subscribe, unsubscribe, onSessionCreated, onSessionUpdated, onSessionDeleted, onSessionSummaryUpdated } =
      useProjectSubscription(newProjectId);

    currentUnsubscribe = unsubscribe;
    subscribe();

    // Handle new session created
    cleanups.push(
      onSessionCreated((session) => {
        sessionsStore.addSessionToList(session);
      })
    );

    // Handle session updated
    cleanups.push(
      onSessionUpdated((session) => {
        sessionsStore.updateSession(session);
      })
    );

    // Handle session deleted
    cleanups.push(
      onSessionDeleted((sessionId) => {
        sessionsStore.removeSessionFromList(sessionId);
        // Clean up summary data for deleted session
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
  },
  { immediate: true }
);

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

async function handleArchivedTabClick() {
  activeTab.value = 'archived';
  if (!archivedLoaded.value) {
    await sessionsStore.fetchArchivedSessions(projectId.value);
    archivedLoaded.value = true;
    fetchArchivedSummaries();
  }
}

function fetchArchivedSummaries() {
  const archived = sessionsStore.archivedSessions;
  for (const session of archived) {
    if (!summaries[session.id] && !loadingSummaries[session.id]) {
      fetchSummary(session.id);
    }
  }
}

async function handleArchive(sessionId) {
  try {
    await sessionsStore.archiveSession(sessionId);
    // If archived tab has been loaded, the session will already be in archivedSessions
    // via the store action
  } catch (error) {
    console.error('Failed to archive session:', error);
  }
}

async function handleUnarchive(sessionId) {
  try {
    await sessionsStore.unarchiveSession(sessionId);
  } catch (error) {
    console.error('Failed to unarchive session:', error);
  }
}

// Cleanup WebSocket listeners on unmount
onUnmounted(() => {
  cleanups.forEach((cleanup) => cleanup());
  if (currentUnsubscribe) {
    currentUnsubscribe();
  }
});
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
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

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
}

.tab {
  background: none;
  border: none;
  padding: 0.75rem 1.25rem;
  font-size: 0.9rem;
  color: var(--color-text-soft);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover {
  color: var(--color-text);
}

.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 500;
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
