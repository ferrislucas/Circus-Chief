<template>
  <div class="container">
    <div class="page-header">
      <div>
        <div class="project-title">
          <h1>{{ projectsStore.currentProject?.name || 'Sessions' }}</h1>
          <a
            v-if="projectsStore.currentProject?.repoUrl"
            :href="projectsStore.currentProject.repoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="repo-link"
            title="Open repository"
          >
            <svg
              class="repo-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3l6 6m0 0l-6 6m6-6H9" />
            </svg>
          </a>
          <router-link
            :to="`/projects/${route.params.id}/edit`"
            class="settings-link"
            title="Project settings"
          >
            <svg
              class="settings-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
              <circle
                cx="12"
                cy="12"
                r="3"
              />
            </svg>
          </router-link>
        </div>
      </div>
      <router-link
        v-if="activeTab === 'sessions'"
        :to="`/projects/${route.params.id}/sessions/new`"
        class="btn btn-primary mobile-only"
      >
        + Session
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
          <button
            v-if="projectsStore.currentProject?.kanbanEnabled"
            class="tab"
            :class="{ active: activeTab === 'kanban' }"
            @click="router.push(`/projects/${route.params.id}/kanban`)"
          >
            Kanban
            <span class="ml-1 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
              Experimental
            </span>
          </button>
        </div>
        <router-link
          v-if="activeTab === 'sessions'"
          :to="`/projects/${route.params.id}/sessions/new`"
          class="btn btn-primary desktop-only"
          aria-label="New Session"
        >
          <span class="add-session-label-full">+ Session</span><span class="add-session-label-short">+</span>
        </router-link>
      </div>

      <!-- Mobile dropdown -->
      <div class="tabs-mobile">
        <select
          :value="activeTab"
          class="tab-select"
          @change="handleTabChange($event.target.value)"
        >
          <option value="sessions">
            Sessions
          </option>
          <option value="archived">
            Archived
          </option>
          <option value="templates">
            Templates
          </option>
          <option value="commands">
            Commands
          </option>
          <option value="scheduled">
            Scheduled
          </option>
          <option
            v-if="projectsStore.currentProject?.kanbanEnabled"
            value="kanban"
          >
            Kanban (experimental)
          </option>
        </select>
      </div>
    </div>

    <!-- Status Filters -->
    <SessionFiltersPanel
      v-if="activeTab === 'sessions'"
      :show-status-filters="true"
      :show-scheduled-filter="true"
    />

    <!-- Status/Starred Filters for Archived Tab -->
    <SessionFiltersPanel
      v-else-if="activeTab === 'archived'"
      :show-status-filters="false"
      :show-scheduled-filter="false"
    />

    <!-- Spacer for other tabs to match structure -->
    <div
      v-else
      class="tab-spacer"
    />

    <!-- Sessions Tab -->
    <div v-if="activeTab === 'sessions'">
      <div
        v-if="sessionsStore.loading"
        class="skeleton-list"
      >
        <div
          v-for="i in 3"
          :key="i"
          class="skeleton card"
          style="height: 120px"
        />
      </div>

      <div
        v-else-if="sessionsStore.error"
        class="error-message"
      >
        {{ sessionsStore.error }}
      </div>

      <div
        v-else-if="sessionsStore.sessions.length === 0"
        class="empty-state"
      >
        <p>No sessions yet. Start a new session to interact with the agent.</p>
        <router-link
          :to="`/projects/${route.params.id}/sessions/new`"
          class="btn btn-primary"
        >
          New Session
        </router-link>
      </div>

      <div
        v-else-if="filteredGroupedSessions.length === 0"
        class="empty-state"
      >
        <p>No sessions match the current filter.</p>
      </div>

      <div
        v-else
        class="session-list"
      >
        <template
          v-for="group in filteredGroupedSessions"
          :key="group.parent.id"
        >
          <SessionCard
            :session="group.parent"
            :show-summary="true"
            :summary="summaries[group.parent.id]"
            :summary-loading="loadingSummaries[group.parent.id]"
            :summary-error="summaryErrors[group.parent.id]"
            :show-archive="true"
            :kanban-enabled="projectsStore.currentProject?.kanbanEnabled ?? true"
            :pr-url="group.parent.prUrl"
            :pr-summary="summaries[group.parent.id]"
            @retry-summary="retryFetchSummary"
            @archive="handleArchive"
            @add-to-board="handleAddToBoard"
          />
        </template>
      </div>
    </div>

    <!-- Archived Tab -->
    <ArchivedTabContent
      v-if="activeTab === 'archived'"
      :summaries="summaries"
      :loading-summaries="loadingSummaries"
      :summary-errors="summaryErrors"
      @retry-summary="retryFetchSummary"
      @unarchive="handleUnarchive"
      @load-more="loadMoreArchived"
    />

    <!-- Templates Tab -->
    <div v-if="activeTab === 'templates'">
      <TemplatesPanel :project-id="route.params.id" />
    </div>

    <!-- Commands Tab -->
    <div v-if="activeTab === 'commands'">
      <CommandButtonsPanel :project-id="route.params.id" />
    </div>

    <!-- Scheduled Tab -->
    <ScheduledTabContent
      v-if="activeTab === 'scheduled'"
      :sessions="scheduledSessions"
      :loading="loadingScheduled"
    />

    <!-- Kanban Tab -->
    <KanbanBoard
      v-if="activeTab === 'kanban'"
      :project-id="route.params.id"
    />

    <!-- Add Session to Lane Modal (for SessionCard add-to-board action) -->
    <AddSessionToLaneModal
      :is-open="showAddToLaneModal"
      :project-id="route.params.id"
      :lane-id="selectedLaneForAdd?.id"
      :lane-name="selectedLaneForAdd?.name"
      @update:is-open="showAddToLaneModal = $event"
      @close="closeAddToLaneModal"
    />

    <!-- Lane Selector Modal (to select which lane to add session to) -->
    <div
      v-if="showLaneSelectorModal"
      class="modal-backdrop"
      @click.self="closeLaneSelectorModal"
    >
      <div class="modal-content lane-selector-modal">
        <div class="modal-header">
          <h2 class="modal-title">
            Add to Kanban Board
          </h2>
          <button
            class="close-btn"
            aria-label="Close"
            @click="closeLaneSelectorModal"
          >
            &times;
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-description">
            Select a lane to add "{{ sessionToAdd?.name }}" to:
          </p>
          <div class="lane-options">
            <button
              v-for="lane in kanbanStore.board?.lanes"
              :key="lane.id"
              class="lane-option-btn"
              @click="addSessionToLane(lane)"
            >
              <span class="lane-option-name">{{ lane.name }}</span>
              <span class="lane-option-count">{{ lane.cards?.length || 0 }} cards</span>
            </button>
          </div>
          <p
            v-if="!kanbanStore.board?.lanes?.length"
            class="empty-lanes"
          >
            No lanes available. Go to the Kanban tab to create lanes first.
          </p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-secondary"
            @click="closeLaneSelectorModal"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Archive Confirm Modal -->
    <ArchiveConfirmModal
      :is-open="showArchiveModal"
      :session-name="sessionToArchive?.name || 'this session'"
      :has-cleanup-script="!!(projectsStore.currentProject?.onSessionDeleted && sessionToArchive?.gitWorktree && !sessionToArchive?.parentSessionId)"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, watch, computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useSummaries } from '../composables/useSummaries.js';
import { useSessionFiltering } from '../composables/useSessionFiltering.js';
import { useProjectSessionSubscription } from '../composables/useProjectSessionSubscription.js';
import { useRunningSessionSubscriptions } from '../composables/useRunningSessionSubscriptions.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import SessionCard from '../components/SessionCard.vue';
import SessionFiltersPanel from '../components/SessionFiltersPanel.vue';
import ArchivedTabContent from '../components/ArchivedTabContent.vue';
import ScheduledTabContent from '../components/ScheduledTabContent.vue';
import TemplatesPanel from '../components/TemplatesPanel.vue';
import CommandButtonsPanel from '../components/CommandButtonsPanel.vue';
import KanbanBoard from '../components/KanbanBoard.vue';
import AddSessionToLaneModal from '../components/AddSessionToLaneModal.vue';
import ArchiveConfirmModal from '../components/ArchiveConfirmModal.vue';
import './SessionListView.css';

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const kanbanStore = useKanbanStore();
const streamingStore = useSessionStreamingStore();

// Auto-subscribe to all running sessions' WebSocket streams for live output
useRunningSessionSubscriptions();
streamingStore.restoreCollapsedLogState();

// Compute activeTab from route name
const activeTab = computed(() => {
  const routeName = route.name;
  switch (routeName) {
    case 'ArchivedSessions': return 'archived';
    case 'ProjectTemplates': return 'templates';
    case 'ProjectCommands': return 'commands';
    case 'ScheduledSessions': return 'scheduled';
    case 'ProjectKanban': return 'kanban';
    default: return 'sessions';
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
    kanban: `/projects/${projectId}/kanban`,
  };
  router.push(routes[tab]);
}

// Get projectId as computed to handle route changes
const projectId = computed(() => route.params.id);

// Use composable for summary management
const {
  summaries,
  loadingSummaries,
  summaryErrors,
  fetchSummariesBatch,
  retryFetchSummary,
  updateSummary,
  cleanupSummary,
} = useSummaries();

// Use composable for filtering (provides filteredGroupedSessions + filter toggles)
const { filteredGroupedSessions } = useSessionFiltering();

// Use composable for WebSocket subscription management
const { archivedLoaded } = useProjectSessionSubscription(projectId, {
  fetchSummariesBatch,
  updateSummary,
  cleanupSummary,
});

// Scheduled sessions state - use store instead of local refs
const scheduledSessions = computed(() => sessionsStore.scheduledSessions || []);
const loadingScheduled = computed(() => sessionsStore.loadingScheduled || false);

// Watch for sessions changes and fetch summaries (debounced to avoid burst of API calls
// when multiple WebSocket updates arrive in quick succession)
let fetchSummariesTimer = null;
watch(
  () => sessionsStore.sessions,
  () => {
    clearTimeout(fetchSummariesTimer);
    fetchSummariesTimer = setTimeout(() => {
      fetchSummariesBatch(sessionsStore.sessions);
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

// Redirect away from the Kanban tab when the feature is experimentally disabled
// for the current project. Covers direct navigation to /projects/:id/kanban.
watch(
  [activeTab, () => projectsStore.currentProject?.kanbanEnabled],
  ([tab, kanbanEnabled]) => {
    if (tab === 'kanban' && kanbanEnabled === false) {
      router.replace(`/projects/${route.params.id}/sessions`);
    }
  },
  { immediate: true }
);

// Watch for filter changes when archived tab is active
watch(
  () => sessionsStore.starredFilter,
  async (newFilter, oldFilter) => {
    if (
      activeTab.value === 'archived' &&
      archivedLoaded.value &&
      newFilter !== oldFilter
    ) {
      await sessionsStore.fetchArchivedSessions(projectId.value, { reset: true });
      fetchSummariesBatch(sessionsStore.archivedSessions);
    }
  }
);

async function loadArchivedSessions() {
  if (!archivedLoaded.value) {
    await sessionsStore.fetchArchivedSessions(projectId.value, { reset: true });
    archivedLoaded.value = true;
    fetchSummariesBatch(sessionsStore.archivedSessions);
  }
}

async function loadMoreArchived() {
  await sessionsStore.loadMoreArchivedSessions(projectId.value);
  fetchSummariesBatch(sessionsStore.archivedSessions);
}

async function fetchScheduledSessions() {
  await sessionsStore.fetchScheduledSessions(projectId.value);
}

// Archive modal state
const showArchiveModal = ref(false);
const sessionToArchive = ref(null);
const archiving = ref(false);

function handleArchive(sessionId) {
  const session = sessionsStore.sessions.find(s => s.id === sessionId);
  sessionToArchive.value = session || { id: sessionId };
  showArchiveModal.value = true;
}

async function confirmArchive(runCleanup) {
  if (!sessionToArchive.value) return;
  archiving.value = true;
  try {
    await sessionsStore.archiveSession(sessionToArchive.value.id, { cleanup: runCleanup });
    uiStore.success('Session archived');
  } catch (error) {
    uiStore.error(error.message || 'Failed to archive session');
  } finally {
    archiving.value = false;
    showArchiveModal.value = false;
    sessionToArchive.value = null;
  }
}

function cancelArchive() {
  showArchiveModal.value = false;
  sessionToArchive.value = null;
}

async function handleUnarchive(sessionId) {
  try {
    await sessionsStore.unarchiveSession(sessionId);
  } catch (error) {
    console.error('Failed to unarchive session:', error);
  }
}

// Add to Board modal state
import { useUiStore } from '../stores/ui.js';
const uiStore = useUiStore();
const showAddToLaneModal = ref(false);
const selectedLaneForAdd = ref(null);
const showLaneSelectorModal = ref(false);
const sessionToAdd = ref(null);

function handleAddToBoard(session) {
  sessionToAdd.value = session;
  showLaneSelectorModal.value = true;
}

function closeLaneSelectorModal() {
  showLaneSelectorModal.value = false;
  sessionToAdd.value = null;
}

async function addSessionToLane(lane) {
  if (!sessionToAdd.value || !lane) return;

  try {
    await kanbanStore.addSessionToBoard(route.params.id, sessionToAdd.value.id, lane.id);
    uiStore.success(`Session added to "${lane.name}"`);
    closeLaneSelectorModal();
  } catch (err) {
    console.error('Failed to add session to board:', err);
    uiStore.error(err.message || 'Failed to add session to board');
  }
}

function closeAddToLaneModal() {
  showAddToLaneModal.value = false;
  selectedLaneForAdd.value = null;
}

// Restore filter states from localStorage on mount
onMounted(() => {
  sessionsStore.restoreStatusFilter();
  sessionsStore.restoreStarredFilter();
  sessionsStore.restoreScheduledFilter();

  // Fetch kanban board for SessionCard "Add to Board" button and lane indicators
  const mountProjectId = route.params.id;
  if (mountProjectId) {
    kanbanStore.fetchBoard(mountProjectId).catch(err => {
      console.warn('Failed to fetch kanban board:', err);
    });
  }
});

// Cleanup on unmount
onUnmounted(() => {
  clearTimeout(fetchSummariesTimer);
});
</script>
