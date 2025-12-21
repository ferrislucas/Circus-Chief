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
        :class="{ active: activeTab === 'templates' }"
        @click="activeTab = 'templates'"
      >
        Templates
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

      <div v-else class="session-list">
        <SessionCard
          v-for="session in sessionsStore.sessions"
          :key="session.id"
          :session="session"
          :show-summary="true"
          :summary="summaries[session.id]"
          :summary-loading="loadingSummaries[session.id]"
          :summary-error="summaryErrors[session.id]"
          @retry-summary="retryFetchSummary"
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

// Get projectId as computed to handle route changes
const projectId = computed(() => route.params.id);

// Subscribe to project updates for real-time session list changes
const { subscribe, onSessionCreated, onSessionUpdated, onSessionDeleted } = useProjectSubscription(projectId.value);

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

// Store cleanup functions for WebSocket listeners
const cleanups = [];

onMounted(async () => {
  projectsStore.fetchProject(route.params.id);
  await sessionsStore.fetchSessions(route.params.id);
  // Fetch summaries for loaded sessions
  fetchSummaries();

  // Subscribe to project updates
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

// Cleanup WebSocket listeners on unmount
onUnmounted(() => {
  cleanups.forEach((cleanup) => cleanup());
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
