<template>
  <div class="container">
    <div class="page-header">
      <div>
        <div class="project-title">
          <h1>{{ projectsStore.currentProject?.name || 'Workspaces' }}</h1>
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
        + Workspace
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
            Workspaces
          </button>
          <button
            class="tab"
            :class="{ active: activeTab === 'kanban' }"
            @click="router.push(`/projects/${route.params.id}/kanban`)"
          >
            Kanban
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
            :class="{ active: activeTab === 'circus-time' }"
            @click="router.push(`/projects/${route.params.id}/circus-time`)"
          >
            Circus Time
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
            :class="{ active: activeTab === 'archived' }"
            @click="router.push(`/projects/${route.params.id}/archived`)"
          >
            Archive
          </button>
        </div>
        <router-link
          v-if="activeTab === 'sessions'"
          :to="`/projects/${route.params.id}/sessions/new`"
          class="btn btn-primary desktop-only"
          aria-label="New Workspace"
        >
          <span class="add-session-label-full">+ Workspace</span><span class="add-session-label-short">+</span>
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
            Workspaces
          </option>
          <option value="kanban">
            Kanban
          </option>
          <option value="commands">
            Commands
          </option>
          <option value="circus-time">
            Circus Time
          </option>
          <option value="templates">
            Templates
          </option>
          <option value="archived">
            Archive
          </option>
        </select>
      </div>
    </div>

    <!-- Status Filters -->
    <SessionFiltersPanel
      v-if="activeTab === 'sessions'"
      :show-status-filters="true"
      :show-scheduled-filter="true"
      :status-counts="workspaceList.facets"
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
        v-if="workspaceList.loading && workspaceList.cards.length === 0"
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
        v-else-if="workspaceList.error && workspaceList.cards.length === 0"
        class="error-message"
        role="alert"
      >
        {{ workspaceList.error }}
      </div>

      <div
        v-else-if="workspaceList.cards.length === 0 && !workspaceList.hasActiveFilters"
        class="empty-state"
      >
        <p>No workspaces yet. Start a new workspace to interact with the agent.</p>
        <router-link
          :to="`/projects/${route.params.id}/sessions/new`"
          class="btn btn-primary"
        >
          New Workspace
        </router-link>
      </div>

      <div
        v-else-if="workspaceList.cards.length === 0"
        class="empty-state"
      >
        <p>No workspaces match the current filter.</p>
      </div>

      <div
        v-else
        class="session-list"
      >
        <div
          v-if="workspaceList.error"
          class="error-message"
          role="alert"
        >
          {{ workspaceList.error }}
        </div>
        <template
          v-for="workspace in workspaceList.cards"
          :key="workspace.id"
        >
          <SessionCard
            :session="workspace"
            :show-summary="true"
            :summary="workspace.summaryPreview ? { shortSummary: workspace.summaryPreview } : null"
            :workflow-aggregate="workspace"
            :show-archive="true"
            :pr-url="workspace.prUrl"
            :pr-summary="workspacePrSummary(workspace)"
            @archive="handleArchive"
            @star="handleStar"
            @add-to-board="handleAddToBoard"
            @visibility-change="handleCardVisibility"
          />
        </template>
        <button
          v-if="workspaceList.hasMore"
          type="button"
          class="btn btn-secondary"
          :disabled="workspaceList.loadingMore"
          @click="loadMoreWorkspaces"
        >
          {{ workspaceList.loadingMore ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>

    <!-- Archived Tab -->
    <ArchivedTabContent
      v-if="activeTab === 'archived'"
      :workspaces="workspaceList.cards"
      :loading="workspaceList.loading"
      :loading-more="workspaceList.loadingMore"
      :error="workspaceList.error"
      :has-more="workspaceList.hasMore"
      :total="workspaceList.total"
      @unarchive="handleUnarchive"
      @star="handleStar"
      @load-more="loadMoreWorkspaces"
    />

    <!-- Commands Tab -->
    <div v-if="activeTab === 'commands'">
      <CommandButtonsPanel :project-id="route.params.id" />
    </div>

    <!-- Circus Time Tab -->
    <CircusTimeTab v-if="activeTab === 'circus-time'" />

    <!-- Templates Tab -->
    <div v-if="activeTab === 'templates'">
      <TemplatesPanel :project-id="route.params.id" />
    </div>

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
    <KanbanLaneSelectorModal
      :is-open="showLaneSelectorModal"
      :session-name="sessionToAdd?.name || ''"
      :lanes="kanbanStore.board?.lanes || []"
      :current-lane-id="currentLaneIdForSessionToAdd"
      @close="closeLaneSelectorModal"
      @select-lane="addSessionToLane"
    />

    <!-- Archive Confirm Modal -->
    <ArchiveConfirmModal
      :is-open="showArchiveModal"
      :session-name="sessionToArchive?.name || 'this session'"
      :has-cleanup-script="!!(projectsStore.currentProject?.onSessionDeleted && sessionToArchive?.gitWorktree && !sessionToArchive?.parentSessionId)"
      :is-on-kanban-board="isArchiveSessionOnBoard"
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
import { useWorkspaceListStore } from '../stores/workspaceList.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useRunningSessionSubscriptions } from '../composables/useRunningSessionSubscriptions.js';
import { useWorkspaceListRealtime } from '../composables/useWorkspaceListRealtime.js';
import { useKanbanRealtime } from '../composables/useKanbanRealtime.js';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { workspacePrSummary } from '../utils/workspaceCard.js';
import SessionCard from '../components/SessionCard.vue';
import SessionFiltersPanel from '../components/SessionFiltersPanel.vue';
import ArchivedTabContent from '../components/ArchivedTabContent.vue';
import CommandButtonsPanel from '../components/CommandButtonsPanel.vue';
import CircusTimeTab from '../components/CircusTimeTab.vue';
import TemplatesPanel from '../components/TemplatesPanel.vue';
import KanbanBoard from '../components/KanbanBoard.vue';
import AddSessionToLaneModal from '../components/AddSessionToLaneModal.vue';
import KanbanLaneSelectorModal from '../components/KanbanLaneSelectorModal.vue';
import ArchiveConfirmModal from '../components/ArchiveConfirmModal.vue';
import './SessionListView.css';

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const kanbanStore = useKanbanStore();
const workspaceList = useWorkspaceListStore();
const commandButtonsStore = useCommandButtonsStore();
const streamingStore = useSessionStreamingStore();

streamingStore.restoreCollapsedLogState();

// Compute activeTab from route name
const activeTab = computed(() => {
  const routeName = route.name;
  switch (routeName) {
    case 'ArchivedSessions': return 'archived';
    case 'ProjectCommands': return 'commands';
    case 'ProjectCircusTime': return 'circus-time';
    case 'ProjectTemplates': return 'templates';
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
    commands: `/projects/${projectId}/commands`,
    'circus-time': `/projects/${projectId}/circus-time`,
    templates: `/projects/${projectId}/templates`,
    kanban: `/projects/${projectId}/kanban`,
  };
  router.push(routes[tab]);
}

// Get projectId as computed to handle route changes
const projectId = computed(() => route.params.id);

// A workflow is eligible only while the card is rendered, expanded, and in the
// observer's prefetch margin. Keep this policy here so subscriptions stay pure.
const cardVisibilityByRootId = ref({});
const isRunningSession = session => ['running', 'starting'].includes(session.status);
const workflowCardFromCard = card => {
  const rootSessionId = card.id;
  return {
    rootSessionId,
    // The card contract carries the running descendants, so list subscriptions
    // follow the session producing output instead of an idle workspace root.
    runningSessionIds: card.runningSessionIds?.length
      ? card.runningSessionIds
      : (isRunningSession(card) || card.runningCount > 0 ? [rootSessionId] : []),
    eligible: activeTab.value === 'sessions'
      && cardVisibilityByRootId.value[rootSessionId] !== false
      && !streamingStore.isSessionLogCollapsed(rootSessionId),
  };
};
const eligibleIdsFor = key => [...new Set(eligibleWorkflowCards.value
  .filter(card => card.eligible)
  .flatMap(card => card[key]))];
const eligibleWorkflowCards = computed(() => workspaceList.cards.map(workflowCardFromCard));
const eligibleSessionIds = computed(() => eligibleIdsFor('runningSessionIds'));

useRunningSessionSubscriptions(eligibleSessionIds);

function handleCardVisibility(rootSessionId, visible) {
  cardVisibilityByRootId.value[rootSessionId] = visible;
}

watch(() => workspaceList.orderedIds, ids => {
  const rendered = new Set(ids);
  for (const id of Object.keys(cardVisibilityByRootId.value)) {
    if (!rendered.has(id)) delete cardVisibilityByRootId.value[id];
  }
}, { immediate: true });

function workspaceQuery() {
  const archived = activeTab.value === 'archived';
  return {
    archived,
    starred: sessionsStore.starredFilter === 'starred' ? true : sessionsStore.starredFilter === 'unstarred' ? false : null,
    status: archived ? null : sessionsStore.statusFilter,
    scheduled: archived
      ? null
      : sessionsStore.scheduledFilter === 'scheduled'
        ? true
        : sessionsStore.scheduledFilter === 'not-scheduled' ? false : null,
  };
}

const listProjectId = computed(() => ['sessions', 'archived'].includes(activeTab.value)
  ? projectId.value
  : null);

useWorkspaceListRealtime(listProjectId, (refreshProjectId) => {
  if (workspaceList.projectId !== refreshProjectId) return;
  return workspaceList.refresh();
}, {
  isRefreshInFlight: () => workspaceList.isRefreshInFlight(),
  patchEvent: (event) => {
    if (workspaceList.projectId !== listProjectId.value) return null;
    if (event.kind === 'onSessionSummaryUpdated') return workspaceList.applySummaryEvent(event.sessionId, event.summary);
    return workspaceList.applyCommandRunEvent(event);
  },
  refreshCard: (sessionId) => {
    if (workspaceList.projectId !== listProjectId.value) return null;
    return workspaceList.refreshCard(sessionId);
  },
});

// Board realtime is project-scoped: the Kanban tab retains its own subscription
// while the workspace list is tab-scoped. The shared subscription refcounts them.
useKanbanRealtime(projectId);

watch(projectId, (id) => {
  if (!id) return;
  Promise.resolve(projectsStore.fetchProject(id)).catch(() => {});
  Promise.resolve(commandButtonsStore.fetchButtons(id)).catch(() => {});
}, { immediate: true });

watch([projectId, activeTab, () => sessionsStore.statusFilter,
  () => sessionsStore.starredFilter, () => sessionsStore.scheduledFilter],
  ([id, tab]) => {
    if (id && ['sessions', 'archived'].includes(tab)) {
      workspaceList.load(id, workspaceQuery()).catch(() => {});
    }
  },
  { immediate: true });

// Archive modal state
const showArchiveModal = ref(false);
const sessionToArchive = ref(null);
const archiving = ref(false);

function handleArchive(sessionId) {
  const session = workspaceList.cardsById?.[sessionId];
  sessionToArchive.value = session || { id: sessionId };
  showArchiveModal.value = true;
}

async function handleStar({ id, starred }) {
  const snapshot = workspaceList.applyOptimisticStar(id, starred);
  try {
    await sessionsStore.toggleSessionStar(id);
  } catch (error) {
    workspaceList.restoreOptimisticStar(snapshot);
    uiStore.error(error.message || 'Failed to update star');
    return;
  }

  try {
    await workspaceList.refresh();
  } catch (error) {
    uiStore.error(error.message || 'Failed to refresh workspaces');
  }
}

const archiveWorkflowCard = computed(() => {
  const compactKanban = sessionToArchive.value?.kanban;
  if (compactKanban) return { id: compactKanban.cardId, laneId: compactKanban.laneId };
  const sessionId = sessionToArchive.value?.id;
  if (!sessionId) return null;
  const rootId = sessionsStore.getRootSession(sessionId)?.id || sessionId;
  return kanbanStore.getCardBySessionId(rootId)
    || kanbanStore.getCardBySessionId(sessionId)
    || null;
});

const isArchiveSessionOnBoard = computed(() => Boolean(archiveWorkflowCard.value));

async function confirmArchive({ runCleanup, removeFromBoard } = {}) {
  if (!sessionToArchive.value) return;
  archiving.value = true;
  // Capture before the finally block clears sessionToArchive.
  const archiveProjectId = projectId.value;
  const workflowCard = archiveWorkflowCard.value;
  try {
    await sessionsStore.archiveSession(sessionToArchive.value.id, { cleanup: runCleanup });
    workspaceList.removeCard?.(sessionToArchive.value.id);
    uiStore.success('Session archived');

    if (removeFromBoard && workflowCard && archiveProjectId) {
      try {
        await kanbanStore.removeCard(archiveProjectId, workflowCard.id);
      } catch (removeError) {
        uiStore.error(removeError.message || 'Failed to remove card from board');
      }
    }
  } catch (error) {
    uiStore.error(error.message || 'Failed to archive session');
  } finally {
    workspaceList.refresh().catch(() => {});
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
    workspaceList.removeCard(sessionId);
    workspaceList.refresh().catch(() => {});
  } catch (error) {
    console.error('Failed to unarchive session:', error);
  }
}

function loadMoreWorkspaces() {
  workspaceList.loadMore().catch(() => {});
}

// Add to Board modal state
import { useUiStore } from '../stores/ui.js';
const uiStore = useUiStore();
const showAddToLaneModal = ref(false);
const selectedLaneForAdd = ref(null);
const showLaneSelectorModal = ref(false);
const sessionToAdd = ref(null);

const currentLaneIdForSessionToAdd = computed(() => {
  if (!sessionToAdd.value?.id) return null;
  return getLaneIdForSession(sessionToAdd.value.id);
});

async function handleAddToBoard(session) {
  // This is a secondary interaction: load the complete board only when the
  // lane picker is actually opened, never on the list critical path.
  if (!kanbanStore.board) {
    try {
      await kanbanStore.fetchBoard(route.params.id);
    } catch (error) {
      uiStore.error(error.message || 'Failed to load Kanban lanes');
      return;
    }
  }
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
    const listCard = workspaceList.cardsById?.[sessionToAdd.value.id];
    const existingCard = listCard
      ? (listCard.kanban
          ? { id: listCard.kanban.cardId, laneId: listCard.kanban.laneId }
          : null)
      : kanbanStore.getCardBySessionId(sessionToAdd.value.id);
    if (existingCard) {
      if (currentLaneIdForSessionToAdd.value === lane.id) return;
      await kanbanStore.moveCard(route.params.id, existingCard.id, lane.id);
      uiStore.success(`Session moved to "${lane.name}"`);
    } else {
      await kanbanStore.addSessionToBoard(route.params.id, sessionToAdd.value.id, lane.id);
      uiStore.success(`Session added to "${lane.name}"`);
    }
    closeLaneSelectorModal();
    workspaceList.refresh().catch(() => {});
  } catch (err) {
    console.error('Failed to update session board lane:', err);
    uiStore.error(err.message || 'Failed to update session board lane');
  }
}

function getLaneIdForSession(sessionId) {
  const listCard = workspaceList.cardsById?.[sessionId];
  if (listCard) return listCard.kanban?.laneId || null;
  const card = kanbanStore.getCardBySessionId(sessionId);
  if (!card) return null;
  if (card.laneId) return card.laneId;

  const lane = kanbanStore.board?.lanes?.find((candidate) =>
    candidate.cards?.some((candidateCard) => candidateCard.id === card.id)
  );
  return lane?.id || null;
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

  // Board data is deferred to the Kanban tab; card DTOs include their lane.
});

onUnmounted(() => {
  workspaceList.cancel();
});
</script>
