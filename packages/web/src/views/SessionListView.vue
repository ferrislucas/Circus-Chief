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
          <button
            v-if="projectsStore.currentProject?.kanbanEnabled"
            class="tab"
            :class="{ active: activeTab === 'kanban' }"
            @click="router.push(`/projects/${route.params.id}/kanban`)"
          >
            Kanban
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
          <option v-if="projectsStore.currentProject?.kanbanEnabled" value="kanban">Kanban</option>
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
    <div v-if="showLaneSelectorModal" class="modal-backdrop" @click.self="closeLaneSelectorModal">
      <div class="modal-content lane-selector-modal">
        <div class="modal-header">
          <h2 class="modal-title">Add to Kanban Board</h2>
          <button @click="closeLaneSelectorModal" class="close-btn" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-description">Select a lane to add "{{ sessionToAdd?.name }}" to:</p>
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
          <p v-if="!kanbanStore.board?.lanes?.length" class="empty-lanes">
            No lanes available. Go to the Kanban tab to create lanes first.
          </p>
        </div>
        <div class="modal-footer">
          <button @click="closeLaneSelectorModal" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, watch, computed } from 'vue';
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

async function handleArchive(sessionId) {
  try {
    await sessionsStore.archiveSession(sessionId);
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

// Add to Board modal state
import { ref } from 'vue';
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

// Restore expanded sessions state from localStorage on mount
onMounted(() => {
  sessionsStore.restoreExpandedState();
  sessionsStore.restoreStatusFilter();
  sessionsStore.restoreStarredFilter();
  sessionsStore.restoreScheduledFilter();

  // Fetch kanban board for SessionCard "Add to Board" button and lane indicators
  const projectId = route.params.id;
  if (projectId) {
    kanbanStore.fetchBoard(projectId).catch(err => {
      console.warn('Failed to fetch kanban board:', err);
    });
  }
});

// Save expanded state and cleanup on unmount
onUnmounted(() => {
  sessionsStore.saveExpandedState();
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

.tab-spacer {
  height: 1rem;
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

/* Lane Selector Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem;
}

.modal-description {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--color-text-soft);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.lane-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lane-option-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.lane-option-btn:hover {
  border-color: var(--color-primary);
  background: rgba(34, 197, 255, 0.05);
}

.lane-option-name {
  font-weight: 500;
}

.lane-option-count {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.empty-lanes {
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}
</style>
