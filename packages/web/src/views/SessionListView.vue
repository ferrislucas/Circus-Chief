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
      <router-link v-if="activeTab === 'sessions'" :to="`/projects/${route.params.id}/sessions/new`" class="btn btn-primary">
        New Session
      </router-link>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <!-- Desktop tabs -->
      <div class="tabs-desktop">
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

    <!-- Status Filters -->
    <div v-if="activeTab === 'sessions'" class="filters-container">
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

    <!-- Status/Starred Filters for Archived Tab -->
    <div v-else-if="activeTab === 'archived'" class="filters-container">
      <div class="status-filters">
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

    <!-- Spacer for other tabs to match structure -->
    <div v-else class="tab-spacer"></div>

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
import { api } from '../composables/useApi.js';
import SessionCard from '../components/SessionCard.vue';
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

// Statuses that count as "idle" (not actively running)
const IDLE_STATUSES = ['waiting', 'stopped', 'error'];
// Statuses that count as "running" (actively processing or starting up)
const RUNNING_STATUSES = ['running', 'starting'];

const filteredGroupedSessions = computed(() => {
  let groups = sessionsStore.groupedSessions;

  // Apply status filter if set
  if (sessionsStore.statusFilter) {
    groups = groups.filter(group => {
      const parentStatus = group.parent.status;
      // "idle" filter matches waiting, stopped, or error statuses
      if (sessionsStore.statusFilter === 'idle' && IDLE_STATUSES.includes(parentStatus)) {
        return true;
      }
      // "running" filter matches running and starting statuses
      if (sessionsStore.statusFilter === 'running' && RUNNING_STATUSES.includes(parentStatus)) {
        return true;
      }
      return false;
    });
  }

  // Apply starred filter if set
  if (sessionsStore.starredFilter === 'starred') {
    groups = groups.filter(group => group.parent.starred);
  } else if (sessionsStore.starredFilter === 'unstarred') {
    groups = groups.filter(group => !group.parent.starred);
  }

  return groups;
});

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
        // Ensure run exists in commandButtonsStore (still needed for SessionDetailView output display)
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
        commandButtonsStore.appendOutput(runId, output);

        // Update session's latestCommandRuns for session list display
        sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
          buttonId,
          status: 'running',
          runId,
          startedAt: Date.now(),
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

// Watch for sessions changes and fetch summaries
watch(
  () => sessionsStore.sessions,
  () => {
    fetchSummaries();
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
});

// Save expanded state and cleanup WebSocket listeners on unmount
onUnmounted(() => {
  sessionsStore.saveExpandedState();
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

.status-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-spacer {
  height: 1rem;
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

@media (max-width: 480px) {
  .page-header {
    flex-direction: column;
    gap: 1rem;
  }

  .page-header .btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
