<template>
  <div
    class="container session-detail"
    data-testid="session-detail"
    :data-ready="isReady ? 'true' : 'false'"
  >
    <div
      v-if="sessionsStore.loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <!-- Delete overlay -->
      <Transition name="fade">
        <div
          v-if="isDeleting"
          class="delete-overlay"
        >
          <div class="delete-overlay-content">
            <span class="delete-spinner" />
            <span>Deleting session...</span>
          </div>
        </div>
      </Transition>
      <SessionHeaderPanel
        :session-id="currentSessionId"
        :session="sessionsStore.currentSession"
        :summary="summary"
        :is-deleting="isDeleting"
        :button-statuses="buttonStatusesToDisplay"
        :kanban-enabled="kanbanEnabledForCurrentSession"
        :git-status-summary="shortGitStatusSummary"
        :git-status-loading="gitStatusLoading"
        :git-status-error="gitStatusError"
        :has-actionable-git-status="hasActionableGitStatus"
        @duplicate="handleDuplicate"
        @copy-session-id="handleCopySessionId"
        @archive="handleArchive"
        @delete="handleDelete"
        @star="handleStar"
        @add-to-board="handleAddToBoard"
      />

      <SessionTabsPanel
        :session-id="currentSessionId"
        :project-id="sessionsStore.currentSession.projectId"
        :active-tab="activeTab"
        :tabs="tabs"
        :has-changes="hasChanges"
        :has-git-status-warning="hasActionableGitStatus"
        :git-status-title="gitStatusIndicatorTitle"
        :canvas-count="canvasStore.groupedItems.length"
        :is-session-active="isSessionActive"
        :session-status="activeSessionStatus"
      />

      <div class="tab-content">
        <!-- CRITICAL: :key ensures components remount when navigating between sessions,
             preventing stale WebSocket handlers from capturing the wrong sessionId -->
        <SummaryTab
          v-if="activeTab === 'summary'"
          :key="route.params.id"
          :session-id="route.params.id"
          @open-session-overlay="handleScheduledSessionClick"
        />
        <ChangesTab
          v-else-if="activeTab === 'changes'"
          :key="route.params.id"
          :session-id="route.params.id"
          :git-status="gitStatus"
          :git-status-summary="gitStatusSummary"
          :git-status-loading="gitStatusLoading"
          :git-status-error="gitStatusError"
          :refresh-git-status="refreshGitStatus"
          @update:file-count="changesFileCount = $event"
        />
        <CanvasTab
          v-else-if="activeTab === 'canvas'"
          :key="route.params.id"
          :session-id="route.params.id"
        />
        <CommandsTab
          v-else-if="activeTab === 'commands'"
          :key="route.params.id"
          :session-id="route.params.id"
          :project-id="sessionsStore.currentSession?.projectId"
        />
        <SessionChatContent
          v-else-if="activeTab === 'chat'"
          :session-id="overlaySessionId"
          :session-chain="sessionChain"
          :summaries-map="summariesMap"
          mode="embedded"
          @session-created="handleOverlaySessionCreated"
        />
      </div>

      <!-- Session Chat Handle -->
      <SessionChatHandle
        v-show="!chatOverlayOpen"
        :is-session-active="isSessionActive"
        :session-status="activeSessionStatus"
        @open="handleOverlayOpen"
      />

      <!-- Session Chat Overlay -->
      <SessionChatOverlay
        v-if="chatOverlayOpen"
        :session-id="overlaySessionId"
        :session-chain="sessionChain"
        :summaries-map="summariesMap"
        @close="handleOverlayClose"
        @session-created="handleOverlaySessionCreated"
      />

      <!-- Archive Confirm Modal -->
      <ArchiveConfirmModal
        :is-open="showArchiveModal"
        :session-name="sessionsStore.currentSession?.name || 'this session'"
        :has-cleanup-script="!!(projectsStore.currentProject?.onSessionDeleted && sessionsStore.currentSession?.gitWorktree && !sessionsStore.currentSession?.parentSessionId)"
        :loading="archiving"
        @confirm="confirmArchive"
        @cancel="cancelArchive"
      />

      <KanbanLaneSelectorModal
        :is-open="showLaneSelectorModal"
        :session-name="sessionToAdd?.name || ''"
        :lanes="kanbanStore.board?.lanes || []"
        :current-lane-id="currentLaneIdForSessionToAdd"
        @close="closeLaneSelectorModal"
        @select-lane="addSessionToLane"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useProjectsStore } from '../stores/projects.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useSessionPolling } from '../composables/useSessionPolling.js';
import { useSessionInitializer } from '../composables/useSessionInitializer.js';
import { useSessionTree } from '../composables/useSessionTree.js';
import { useSessionGitStatus } from '../composables/useSessionGitStatus.js';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import CommandsTab from '../components/CommandsTab.vue';
import SessionHeaderPanel from '../components/SessionHeaderPanel.vue';
import SessionTabsPanel from '../components/SessionTabsPanel.vue';
import SessionChatHandle from '../components/SessionChatHandle.vue';
import SessionChatOverlay from '../components/SessionChatOverlay.vue';
import SessionChatContent from '../components/SessionChatContent.vue';
import ArchiveConfirmModal from '../components/ArchiveConfirmModal.vue';
import KanbanLaneSelectorModal from '../components/KanbanLaneSelectorModal.vue';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useWebSocket } from '../composables/useWebSocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const projectsStore = useProjectsStore();
const commandButtonsStore = useCommandButtonsStore();
const canvasStore = useCanvasStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();
const kanbanStore = useKanbanStore();

const { send, on, off } = useWebSocket();

let currentProjectSubscriptionId = null;

const currentSessionId = ref(route.params.id);
sessionsStore.viewedSessionId = route.params.id;

const {
  gitStatus,
  loading: gitStatusLoading,
  error: gitStatusError,
  summaryText: gitStatusSummary,
  shortSummaryText: shortGitStatusSummary,
  indicatorTitle: gitStatusIndicatorTitle,
  hasActionableGitStatus,
  refresh: refreshGitStatus,
  reset: resetGitStatus,
} = useSessionGitStatus({
  getSessionId: () => currentSessionId.value,
});

const {
  hasChanges,
  changesFileCount,
  checkForChanges,
  startPolling,
  stopPolling,
  reset: resetPolling,
} = useSessionPolling({
  getSessionId: () => currentSessionId.value,
  getSessionStatus: () => sessionsStore.currentSession?.status,
  sessionsStore,
  refreshGitStatus,
});

const summary = ref(null);
const isDeleting = ref(false);
const showArchiveModal = ref(false);
const archiving = ref(false);
const showLaneSelectorModal = ref(false);
const sessionToAdd = ref(null);

const currentLaneIdForSessionToAdd = computed(() => {
  if (!sessionToAdd.value?.id) return null;
  return getLaneIdForSession(sessionToAdd.value.id);
});

// Readiness signal for E2E tests
const sessionChainReady = ref(false);
const isReady = computed(() =>
  !sessionsStore.loading &&
  Boolean(sessionsStore.currentSession) &&
  sessionChainReady.value,
);

// Session tree composable (chain building, overlay target, chat navigation)
const {
  chatOverlayOpen,
  overlaySessionId,
  sessionChain,
  summariesMap,
  isSessionActive,
  activeSessionStatus,
  buildSessionChain,
  resolveOverlayTarget,
  openChatDestination,
  handleOverlayOpen,
  handleScheduledSessionClick,
  handleSessionUpdated,
  handleSessionCreated,
  handleOverlaySessionCreated,
  handleOverlayClose,
  resetPreferred,
} = useSessionTree(currentSessionId, sessionChainReady);

const { cleanup, initializeSession } = useSessionInitializer({
  summary,
  hasChanges,
  changesFileCount,
  checkForChanges,
  startPolling,
  stopPolling,
  resetPolling,
  refreshGitStatus,
  onReconnectCallback: buildSessionChain,
});

const activeTab = computed(() => route.params.tab || 'summary');

// Command button status indicators for real-time updates (mirrors SessionCard behavior)
const buttonStatusesToDisplay = computed(() => {
  // eslint-disable-next-line no-unused-vars
  const _version = sessionsStore.commandRunVersion;

  const projectId = sessionsStore.currentSession?.projectId;
  if (!projectId) return [];

  const buttons = commandButtonsStore.getButtonsByProjectId(projectId);
  const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

  const latestRuns = sessionsStore.currentSession?.latestCommandRuns || [];
  return latestRuns
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      command: buttonMap[run.buttonId].command,
      status: run.status,
      latestRun: run,
    }));
});

const tabs = computed(() => [
  { id: 'summary', label: 'Summary' },
  { id: 'chat', label: 'Chat', desktopOnly: true },
  { id: 'changes', label: changesFileCount.value > 0 ? `Changes (${changesFileCount.value})` : 'Changes' },
  { id: 'canvas', label: canvasStore.groupedItems.length > 0 ? `Canvas (${canvasStore.groupedItems.length})` : 'Canvas' },
  { id: 'commands', label: 'Commands' },
]);

const kanbanEnabledForCurrentSession = computed(() =>
  projectsStore.currentProject?.id === sessionsStore.currentSession?.projectId &&
  projectsStore.currentProject?.kanbanEnabled === true
);

async function ensureProjectKanbanData(session) {
  if (!session?.projectId) return;

  if (projectsStore.currentProject?.id !== session.projectId) {
    await projectsStore.fetchProject(session.projectId);
  }

  if (kanbanStore.currentProjectId !== session.projectId) {
    kanbanStore.fetchBoard(session.projectId).catch(err => {
      console.warn('Failed to fetch kanban board:', err);
    });
  }
}

watch(
  () => sessionsStore.currentSession?.status,
  (newStatus, oldStatus) => {
    if (newStatus === 'running' || newStatus === 'starting') {
      startPolling();
    } else if (oldStatus === 'running' || oldStatus === 'starting') {
      stopPolling();
    }
  }
);

onMounted(async () => {
  on(WS_MESSAGE_TYPES.SESSION_CREATED, handleSessionCreated);
  on(WS_MESSAGE_TYPES.SESSION_UPDATED, handleSessionUpdated);

  await initializeSession(currentSessionId.value);

  const projectId = sessionsStore.currentSession?.projectId;
  await ensureProjectKanbanData(sessionsStore.currentSession);

  await buildSessionChain();
  sessionChainReady.value = true;
  resolveOverlayTarget();

  if (projectId) {
    send(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId });
    currentProjectSubscriptionId = projectId;
  }

  if (route.query.overlay === 'open') {
    await openChatDestination({ replaceQuery: true });
  }
});

watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
      sessionsStore.viewedSessionId = newSessionId;
      sessionChainReady.value = false;
      resetPreferred();
      cleanup();
      currentSessionId.value = newSessionId;
      resetGitStatus();
      await initializeSession(newSessionId);

      const newProjectId = sessionsStore.currentSession?.projectId;
      await ensureProjectKanbanData(sessionsStore.currentSession);

      await buildSessionChain();
      sessionChainReady.value = true;
      resolveOverlayTarget();
      if (route.query.overlay === 'open') {
        await openChatDestination({ replaceQuery: true });
      }

      if (newProjectId !== currentProjectSubscriptionId) {
        if (currentProjectSubscriptionId) {
          send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: currentProjectSubscriptionId });
        }
        if (newProjectId) {
          send(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId: newProjectId });
        }
        currentProjectSubscriptionId = newProjectId || null;
      }
    }
  }
);

watch(
  () => route.query.overlay,
  async (overlay, previousOverlay) => {
    if (overlay !== 'open' || previousOverlay === 'open' || !sessionChainReady.value) return;
    await openChatDestination({ replaceQuery: true });
  }
);

watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      todosStore.clearTodos();
      todosStore.fetchTodos(currentSessionId.value, newConvId);
    }
  }
);

onActivated(() => {
  if (currentSessionId.value) {
    sessionsStore.fetchConversations(currentSessionId.value);
  }
});

onUnmounted(() => {
  cleanup();
  resetGitStatus();
  if (currentProjectSubscriptionId) {
    send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId: currentProjectSubscriptionId });
    currentProjectSubscriptionId = null;
  }
  off(WS_MESSAGE_TYPES.SESSION_CREATED, handleSessionCreated);
  off(WS_MESSAGE_TYPES.SESSION_UPDATED, handleSessionUpdated);
  sessionsStore.viewedSessionId = null;
});

async function handleDuplicate() {
  if (!confirm('Duplicate this session? A new session will be created with all conversations and canvas items.')) {
    return;
  }

  try {
    const newSession = await sessionsStore.duplicateSession(currentSessionId.value);
    uiStore.success('Session duplicated');
    router.push(`/sessions/${newSession.id}/summary`);
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this session?')) return;

  isDeleting.value = true;
  uiStore.addToast('info', 'Deleting session...', 0);

  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.deleteSession(currentSessionId.value);

    const toastsToRemove = uiStore.toasts.filter(t => t.message === 'Deleting session...');
    toastsToRemove.forEach(t => uiStore.removeToast(t.id));

    uiStore.success('Session deleted');
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    isDeleting.value = false;

    const toastsToRemove = uiStore.toasts.filter(t => t.message === 'Deleting session...');
    toastsToRemove.forEach(t => uiStore.removeToast(t.id));

    uiStore.error(err.message);
  }
}

async function handleArchive() {
  const isArchived = sessionsStore.currentSession?.archived;

  if (isArchived) {
    if (!confirm('Restore this session to active?')) {
      return;
    }
    try {
      const projectId = sessionsStore.currentSession?.projectId;
      await sessionsStore.unarchiveSession(currentSessionId.value);
      uiStore.success('Session unarchived');
      if (projectId) {
        router.push(`/projects/${projectId}/sessions`);
      } else {
        router.push('/');
      }
    } catch (err) {
      uiStore.error(err.message);
    }
  } else {
    showArchiveModal.value = true;
  }
}

async function confirmArchive(runCleanup) {
  archiving.value = true;
  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.archiveSession(currentSessionId.value, { cleanup: runCleanup });
    uiStore.success('Session archived');
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    archiving.value = false;
    showArchiveModal.value = false;
  }
}

function cancelArchive() {
  showArchiveModal.value = false;
}

async function handleStar() {
  try {
    await sessionsStore.toggleSessionStar(currentSessionId.value);
  } catch (err) {
    uiStore.error(err.message);
  }
}

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
    const existingCard = kanbanStore.getCardBySessionId(sessionToAdd.value.id);
    if (existingCard) {
      if (currentLaneIdForSessionToAdd.value === lane.id) return;
      await kanbanStore.moveCard(sessionToAdd.value.projectId, existingCard.id, lane.id);
      uiStore.success(`Session moved to "${lane.name}"`);
    } else {
      await kanbanStore.addSessionToBoard(sessionToAdd.value.projectId, sessionToAdd.value.id, lane.id);
      uiStore.success(`Session added to "${lane.name}"`);
    }
    closeLaneSelectorModal();
  } catch (err) {
    console.error('Failed to add session to board:', err);
    uiStore.error(err.message || 'Failed to add session to board');
  }
}

function getLaneIdForSession(sessionId) {
  const card = kanbanStore.getCardBySessionId(sessionId);
  if (!card) return null;
  if (card.laneId) return card.laneId;

  const lane = kanbanStore.board?.lanes?.find((candidate) =>
    candidate.cards?.some((candidateCard) => candidateCard.id === card.id)
  );
  return lane?.id || null;
}

async function handleCopySessionId() {
  const sessionId = currentSessionId.value;
  try {
    await navigator.clipboard.writeText(sessionId);
    uiStore.success(`Session ID copied to clipboard: ${sessionId}`);
  } catch (err) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = sessionId;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      uiStore.success(`Session ID copied to clipboard: ${sessionId}`);
    } catch (fallbackErr) {
      console.error('Copy failed:', fallbackErr);
      uiStore.error('Failed to copy session ID');
    }
  }
}

defineExpose({
  overlaySessionId,
  chatOverlayOpen,
  sessionChain,
  summariesMap,
  handleOverlayOpen,
});
</script>

<style scoped>
.loading-state { display: flex; align-items: center; gap: 0.5rem; justify-content: center; padding: 3rem; }
.tab-content { min-height: 400px; }
.delete-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(2px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.delete-overlay-content { display: flex; flex-direction: column; align-items: center; gap: 1rem; color: var(--color-text, #e0e0e0); font-size: 1.125rem; }
.delete-spinner { display: inline-block; width: 3rem; height: 3rem; border: 3px solid rgba(0, 188, 212, 0.2); border-top-color: var(--color-primary, #00bcd4); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
