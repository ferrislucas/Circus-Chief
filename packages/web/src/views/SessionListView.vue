<template>
  <div class="container">
    <div class="page-header">
      <div>
        <div class="project-title">
          <h1>{{ projectsStore.currentProject?.name || 'Sessions' }}</h1>
          <a v-if="projectsStore.currentProject?.repoUrl" :href="projectsStore.currentProject.repoUrl" target="_blank" rel="noopener noreferrer" class="repo-link" title="Open repository">
            <svg class="repo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3l6 6m0 0l-6 6m6-6H9"></path>
            </svg>
          </a>
        </div>
      </div>
      <router-link v-if="activeTab === 'sessions'" :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary mobile-only">
        New Session
      </router-link>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <!-- Desktop tabs -->
      <div class="tabs-desktop">
        <div class="tabs-left">
          <button
            class="tab"
            :class="{ active: activeTab === 'sessions' }"
            @click="router.push(`/projects/${route.params.id}/sessions`)"
          >
            Sessions
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'archived' }"
            @click="router.push(`/projects/${route.params.id}/archived`)"
          >
            Archived
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'templates' }"
            @click="router.push(`/projects/${route.params.id}/templates`)"
          >
            Templates
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'commands' }"
            @click="router.push(`/projects/${route.params.id}/commands`)"
          >
            Commands
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'scheduled' }"
            @click="router.push(`/projects/${route.params.id}/scheduled`)"
          >
            Scheduled
          </button>
        </div>
        <router-link v-if="activeTab === 'sessions'" :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary desktop-only">
          New Session
        </router-link>
      </div>

      <!-- Mobile dropdown -->
      <div class="tabs-mobile">
        <select :value="activeTab" @change="handleTabChange($event.target.value)" class="tab-select">
          <option value="sessions">Sessions</option>
          <option value="archived">Archived</option>
          <option value="templates">Templates</option>
          <option value="commands">Commands</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>
    </div>

    <SessionFilters :active-tab="activeTab" />

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
          New Session
        </router-link>
      </div>

      <div v-else-if="filteredGroupedSessions.length === 0" class="empty-state">
        <p>No sessions match the current filter.</p>
      </div>

      <div v-else class="session-list">
        <template v-for="group in filteredGroupedSessions" :key="group.parent.id">
          <SessionCard
            :session="group.parent"
            :show-summary="true"
            :summary="summaries[group.parent.id]"
            :summary-loading="loadingSummaries[group.parent.id]"
            :summary-error="summaryErrors[group.parent.id]"
            :children="group.children"
            :summaries="summaries"
            :show-archive="true"
            :pr-url="group.parent.prUrl"
            :pr-summary="summaries[group.parent.id]"
            @retry-summary="retryFetchSummary"
            @archive="handleArchive"
          />
        </template>
      </div>
    </div>

    <!-- Archived Tab -->
    <div v-if="activeTab === 'archived'">
      <div v-if="sessionsStore.archivedPagination.loading && sessionsStore.archivedSessions.length === 0" class="skeleton-list">
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
          :pr-url="session.prUrl"
          :pr-summary="summaries[session.id]"
          @retry-summary="retryFetchSummary"
          @unarchive="handleUnarchive"
        />

        <!-- Load More Button -->
        <div v-if="sessionsStore.archivedPagination.hasMore" class="load-more-container">
          <button
            class="btn btn-secondary"
            :disabled="sessionsStore.archivedPagination.loading"
            @click="loadMoreArchived"
          >
            <span v-if="sessionsStore.archivedPagination.loading">Loading...</span>
            <span v-else>Load More ({{ archivedRemaining }} remaining)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Templates Tab -->
    <div v-if="activeTab === 'templates'">
      <TemplatesPanel :project-id="route.params.id" />
    </div>

    <!-- Commands Tab -->
    <div v-if="activeTab === 'commands'">
      <CommandButtonsPanel :project-id="route.params.id" />
    </div>

    <!-- Scheduled Tab -->
    <div v-if="activeTab === 'scheduled'">
      <div v-if="loadingScheduled" class="skeleton-list">
        <div v-for="i in 3" :key="i" class="skeleton card" style="height: 120px"></div>
      </div>

      <div v-else-if="scheduledSessions.length === 0" class="empty-state">
        <p>No scheduled sessions. Use scheduling options when creating a new session to schedule it for later.</p>
      </div>

      <div v-else class="session-list">
        <ScheduledSessionCard
          v-for="session in scheduledSessions"
          :key="session.id"
          :session="session"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useProjectSubscription } from '../composables/useWebSocket.js';
import { useSessionFiltering } from '../composables/useSessionFiltering.js';
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';
import SessionFilters from '../components/SessionFilters.vue';
import TemplatesPanel from '../components/TemplatesPanel.vue';
import CommandButtonsPanel from '../components/CommandButtonsPanel.vue';
import ScheduledSessionCard from '../components/ScheduledSessionCard.vue';

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();

// Compute activeTab from route name
const activeTab = computed(() => {
  const routeName = route.name;
  switch (routeName) {
    case 'ArchivedSessions': return 'archived';
    case 'ProjectTemplates': return 'templates';
    case 'ProjectCommands': return 'commands';
    case 'ScheduledSessions': return 'scheduled';
    default: return 'sessions';
  }
});

// Session filtering composable
const { filteredGroupedSessions } = useSessionFiltering();

// Handle tab change from mobile dropdown
function handleTabChange(tab) {
  const projectId = route.params.id;
  const routes = {
    sessions: `/projects/${projectId}/sessions`,
    archived: `/projects/${projectId}/archived`,
    templates: `/projects/${projectId}/templates`,
    commands: `/projects/${projectId}/commands`,
    scheduled: `/projects/${projectId}/scheduled`,
  };
  router.push(routes[tab]);
}

// Get projectId as computed to handle route changes
const projectId = computed(() => route.params.id);

// Store summaries keyed by session ID
const summaries = reactive({});
const loadingSummaries = reactive({});
const summaryErrors = reactive({});

// Track if archived sessions have been loaded
const archivedLoaded = ref(false);

// Computed property for remaining archived sessions
const archivedRemaining = computed(() => {
  const { total, offset } = sessionsStore.archivedPagination;
  return Math.max(0, total - offset);
});

// Scheduled sessions state - use store instead of local refs
const scheduledSessions = computed(() => sessionsStore.scheduledSessions || []);
const loadingScheduled = computed(() => sessionsStore.loadingScheduled || false);

// Store cleanup functions for WebSocket listeners
const cleanups = [];

// Track current unsubscribe function for cleanup when projectId changes
let currentUnsubscribe = null;

// Watch for projectId changes to properly subscribe/unsubscribe
watch(
  projectId,
  async (newProjectId) => {
    if (!newProjectId) return;

    // Reset archived sessions loaded flag when changing projects
    archivedLoaded.value = false;

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
    await commandButtonsStore.fetchButtons(newProjectId); // Still needed for button labels/config
    // Note: fetchLatestRunsForProject() is no longer needed - latestCommandRuns are now
    // included in the sessions API response (merged from DB + in-memory running commands)
    fetchSummaries();

    // Create new subscription for new project
    const {
      subscribe,
      unsubscribe,
      onSessionCreated,
      onSessionUpdated,
      onSessionDeleted,
      onSessionSummaryUpdated,
      onCommandRunOutput,
      onCommandRunComplete,
      onCommandRunError,
    } = useProjectSubscription(newProjectId);

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

    // Handle command run output (for real-time status icon updates)
    cleanups.push(
      onCommandRunOutput((runId, sessionId, buttonId, output) => {
        // Get the actual startedAt from the commandButtons store or existing session run
        // to avoid resetting the timer on every output event
        const existingRun = commandButtonsStore.runs[runId];
        const sessions = sessionsStore.sessions;
        const storeSession = sessions.find(s => s.id === sessionId);
        const existingSessionRun = storeSession?.latestCommandRuns?.find(r => r.runId === runId);
        const startedAt = existingRun?.startedAt || existingSessionRun?.startedAt || Date.now();

        // Ensure run exists in commandButtonsStore (still needed for SessionDetailView output display)
        if (!commandButtonsStore.runs[runId]) {
          commandButtonsStore.runs[runId] = {
            runId,
            buttonId,
            sessionId,
            status: 'running',
            output: '',
            exitCode: null,
            startedAt,
            outputTruncated: false,
          };
        }
        commandButtonsStore.appendOutput(runId, output);

        // Update session's latestCommandRuns for session list display
        sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
          buttonId,
          status: 'running',
          runId,
          startedAt,
        });
      })
    );

    // Handle command run complete
    cleanups.push(
      onCommandRunComplete((runId, sessionId, buttonId, exitCode, output) => {
        // Create run if it doesn't exist (handles edge case of no output before completion)
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
        commandButtonsStore.completeRun(runId, exitCode, output);

        // Update session's latestCommandRuns for session list display
        const status = exitCode === 0 ? 'success' : 'error';
        sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
          buttonId,
          status,
          exitCode,
          runId,
          completedAt: Date.now(),
        });
      })
    );

    // Handle command run error
    cleanups.push(
      onCommandRunError((runId, sessionId, buttonId, error) => {
        // Create run if it doesn't exist (handles edge case of no output before error)
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
        commandButtonsStore.errorRun(runId, error);

        // Update session's latestCommandRuns for session list display
        sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
          buttonId,
          status: 'error',
          runId,
          completedAt: Date.now(),
        });
      })
    );
  },
  { immediate: true }
);

// Watch for sessions changes and fetch summaries (debounced to avoid burst of API calls
// when multiple WebSocket updates arrive in quick succession)
let fetchSummariesTimer = null;
watch(
  () => sessionsStore.sessions,
  () => {
    clearTimeout(fetchSummariesTimer);
    fetchSummariesTimer = setTimeout(() => {
      fetchSummaries();
    }, 400);
  }
);

// Watch for route changes to load archived sessions and scheduled sessions when needed
watch(
  () => route.name,
  async (newRouteName) => {
    if (newRouteName === 'ArchivedSessions') {
      await loadArchivedSessions();
    } else if (newRouteName === 'ScheduledSessions') {
      await fetchScheduledSessions();
    }
  },
  { immediate: true }
);

// Watch for filter changes when archived tab is active
watch(
  () => sessionsStore.starredFilter,
  async (newFilter, oldFilter) => {
    // Only re-fetch if:
    // 1. We're on the archived tab
    // 2. Archived sessions have been loaded at least once
    // 3. The filter actually changed (not initial setup)
    if (
      activeTab.value === 'archived' &&
      archivedLoaded.value &&
      newFilter !== oldFilter
    ) {
      await sessionsStore.fetchArchivedSessions(projectId.value, { reset: true });
      fetchArchivedSummaries(); // No await - parallel load
    }
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

async function loadArchivedSessions() {
  if (!archivedLoaded.value) {
    // Always reset when loading - this ensures filter is applied on initial tab load
    await sessionsStore.fetchArchivedSessions(projectId.value, { reset: true });
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

async function loadMoreArchived() {
  await sessionsStore.loadMoreArchivedSessions(projectId.value);
  fetchArchivedSummaries(); // Fetch summaries for newly loaded sessions
}

async function fetchScheduledSessions() {
  await sessionsStore.fetchScheduledSessions(projectId.value);
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

// Restore expanded sessions state from localStorage on mount
onMounted(() => {
  sessionsStore.restoreExpandedState();
  sessionsStore.restoreStatusFilter();
  sessionsStore.restoreStarredFilter();
  sessionsStore.restoreScheduledFilter();
});

// Save expanded state and cleanup WebSocket listeners on unmount
onUnmounted(() => {
  sessionsStore.saveExpandedState();
  cleanups.forEach((cleanup) => cleanup());
  if (currentUnsubscribe) {
    currentUnsubscribe();
  }
  // Clear debounce timer
  clearTimeout(fetchSummariesTimer);
});
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.page-header h1 {
  margin: 0;
}

.project-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.repo-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--color-primary);
  transition: color 0.15s, transform 0.15s;
  padding: 0.25rem;
}

.repo-link:hover {
  color: var(--color-primary-bright, #06ffff);
  transform: scale(1.1);
}

.repo-icon {
  width: 100%;
  height: 100%;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
  /* Sticky positioning - accounts for header + safe area on iOS */
  position: -webkit-sticky; /* Safari prefix */
  position: sticky;
  /* Default for phones/small screens */
  top: calc(var(--header-height-computed, 51px) + var(--viewport-offset-top, 0px));
  background-color: var(--color-background);
  z-index: 99;
  padding: 0.5rem 0.5rem 0 0.5rem;
}

/* iPad and larger screens - account for safe area */
@media (min-width: 768px) {
  .tabs {
    top: calc(var(--header-height-computed, 80px) + var(--viewport-offset-top, 0px));
  }
}

.tabs-desktop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.tabs-mobile {
  display: none;
  width: 100%;
}

.tab-select {
  width: 100%;
  padding: 0.75rem;
  font-size: 0.9rem;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
}

.tabs-left {
  display: flex;
  gap: 0;
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

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
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

  /* Hide desktop tabs on mobile */
  .tabs-desktop {
    display: none !important;
  }

  /* Show mobile tabs on mobile */
  .tabs-mobile {
    display: block;
  }

  /* Hide desktop-only elements on mobile */
  .desktop-only {
    display: none !important;
  }
}

/* Responsive utility classes */
.mobile-only {
  display: block;
}

/* Hide desktop-only elements by default (mobile) */
.desktop-only {
  display: none;
}

/* Hide mobile-only elements on desktop */
@media (min-width: 481px) {
  .mobile-only {
    display: none !important;
  }
}

/* Show desktop-only elements on desktop */
@media (min-width: 481px) {
  .desktop-only {
    display: inline-flex !important;
  }
}
</style>
