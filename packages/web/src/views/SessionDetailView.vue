<template>
  <div class="container session-detail">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <!-- Delete overlay -->
      <Transition name="fade">
        <div v-if="isDeleting" class="delete-overlay">
          <div class="delete-overlay-content">
            <span class="delete-spinner"></span>
            <span>Deleting session...</span>
          </div>
        </div>
      </Transition>
      <!-- Session hierarchy breadcrumb -->
      <SessionHierarchyBreadcrumb
        v-if="sessionPath.length > 1"
        :path="sessionPath"
        :current-session-id="currentSessionId"
      />

      <SessionHeaderPanel
        :session-id="currentSessionId"
        :session="sessionsStore.currentSession"
        :summary="summary"
        :is-deleting="isDeleting"
        :button-statuses="buttonStatusesToDisplay"
        @duplicate="handleDuplicate"
        @copySessionId="handleCopySessionId"
        @archive="handleArchive"
        @delete="handleDelete"
        @star="handleStar"
      />

      <SessionTabsPanel
        :session-id="currentSessionId"
        :project-id="sessionsStore.currentSession.projectId"
        :active-tab="activeTab"
        :tabs="tabs"
        :has-changes="hasChanges"
        :canvas-count="canvasStore.groupedItems.length"
      />

      <div class="tab-content">
        <!-- CRITICAL: :key ensures components remount when navigating between sessions,
             preventing stale WebSocket handlers from capturing the wrong sessionId -->
        <SummaryTab v-if="activeTab === 'summary'" :key="route.params.id" :session-id="route.params.id" />
        <ConversationTab v-else-if="activeTab === 'conversation'" :key="route.params.id" :session-id="route.params.id" />
        <ChangesTab v-else-if="activeTab === 'changes'" :key="route.params.id" :session-id="route.params.id" @update:file-count="changesFileCount = $event" />
        <CanvasTab v-else-if="activeTab === 'canvas'" :key="route.params.id" :session-id="route.params.id" />
        <CommandsTab v-else-if="activeTab === 'commands'" :key="route.params.id" :session-id="route.params.id" :project-id="sessionsStore.currentSession?.projectId" />
      </div>

      <!-- Session Tree Handle -->
      <SessionTreeHandle
        :is-session-active="isSessionActive"
        :session-status="sessionsStore.currentSession?.status"
        @open="treeOverlayOpen = true"
      />

      <!-- Session Tree Overlay -->
      <SessionTreeOverlay
        v-if="treeOverlayOpen"
        :session-id="overlaySessionId"
        @close="treeOverlayOpen = false"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, onActivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useKanbanStore } from '../stores/kanban.js';
import { useSessionPolling } from '../composables/useSessionPolling.js';
import { useSessionInitializer } from '../composables/useSessionInitializer.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import CommandsTab from '../components/CommandsTab.vue';
import SessionHeaderPanel from '../components/SessionHeaderPanel.vue';
import SessionTabsPanel from '../components/SessionTabsPanel.vue';
import SessionHierarchyBreadcrumb from '../components/SessionHierarchyBreadcrumb.vue';
import SessionTreeHandle from '../components/SessionTreeHandle.vue';
import SessionTreeOverlay from '../components/SessionTreeOverlay.vue';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
const canvasStore = useCanvasStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();
const kanbanStore = useKanbanStore();

// Reactive session ID that tracks route changes
// Used by the polling composable to track the current session
const currentSessionId = ref(route.params.id);

// Use composable for polling and file changes
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
});

const summary = ref(null);
const isDeleting = ref(false);
const treeOverlayOpen = ref(false);

// Session ID to pass to the overlay - resolves to running child if present
const overlaySessionId = ref(route.params.id);

/**
 * Resolve the overlay target session ID.
 * If the session has running children, pre-navigate to the most recently updated one.
 * Otherwise, use the session itself.
 */
function resolveOverlayTarget(sessionId) {
  const children = sessionsStore.getChildSessions(sessionId);
  const runningChildren = children.filter(
    (c) => c.status === 'running' || c.status === 'starting'
  );

  if (runningChildren.length > 0) {
    // Pick the most recently updated running child
    runningChildren.sort((a, b) =>
      new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    );
    overlaySessionId.value = runningChildren[0].id;
  } else {
    overlaySessionId.value = sessionId;
  }
}

// Use composable for session initialization and WebSocket management
const { cleanup, initializeSession } = useSessionInitializer({
  summary,
  hasChanges,
  changesFileCount,
  checkForChanges,
  startPolling,
  stopPolling,
  resetPolling,
});

const activeTab = computed(() => route.params.tab || 'summary');

// Get the session hierarchy path (for breadcrumbs)
const sessionPath = computed(() => {
  // Use route.params.id directly to be reactive to route changes
  return sessionsStore.getSessionPath(route.params.id);
});

// Command button status indicators for real-time updates (mirrors SessionCard behavior)
const buttonStatusesToDisplay = computed(() => {
  // Access commandRunVersion to establish Vue dependency tracking.
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

const isSessionActive = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status === 'running' || status === 'starting';
});

const tabs = computed(() => [
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'changes', label: changesFileCount.value > 0 ? `Changes (${changesFileCount.value})` : 'Changes' },
  { id: 'canvas', label: canvasStore.groupedItems.length > 0 ? `Canvas (${canvasStore.groupedItems.length})` : 'Canvas' },
  { id: 'commands', label: 'Commands' }
]);

// Watch for status changes from any source (optimistic updates, WebSocket, etc.)
// This ensures polling starts even when status is updated directly in the store
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
  // Initialize the session with WebSocket subscription and data fetching
  await initializeSession(currentSessionId.value);

  // Resolve overlay target to pre-navigate to running child if present
  resolveOverlayTarget(currentSessionId.value);

  // Fetch kanban board so SessionHeaderPanel can show lane chip
  const session = sessionsStore.currentSession;
  if (session?.projectId) {
    kanbanStore.fetchBoard(session.projectId).catch(err => {
      console.warn('Failed to fetch kanban board:', err);
    });
  }
});

// Watch for session changes within the same component (e.g., navigating between sessions)
// CRITICAL: This fixes the WebSocket subscription leak bug
watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
      cleanup();
      currentSessionId.value = newSessionId;
      await initializeSession(newSessionId);
      // Resolve overlay target to pre-navigate to running child if present
      resolveOverlayTarget(newSessionId);
    }
  }
);

// Watch for conversation changes to refetch todos (scoped to conversation)
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    if (newConvId && newConvId !== oldConvId) {
      todosStore.clearTodos();
      todosStore.fetchTodos(currentSessionId.value, newConvId);
    }
  }
);

// Handle component reactivation (keep-alive) - refresh data when view becomes active again
onActivated(() => {
  if (currentSessionId.value) {
    sessionsStore.fetchConversations(currentSessionId.value);
  }
});

onUnmounted(() => {
  cleanup();
});

async function handleDuplicate() {
  if (!confirm('Duplicate this session? A new session will be created with all conversations, canvas items, and notes.')) {
    return;
  }

  try {
    const newSession = await sessionsStore.duplicateSession(currentSessionId.value);
    uiStore.success('Session duplicated');
    router.push(`/sessions/${newSession.id}/conversation`);
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
  try {
    const projectId = sessionsStore.currentSession?.projectId;
    const isArchived = sessionsStore.currentSession?.archived;

    const confirmMessage = isArchived ? 'Restore this session to active?' : 'Archive this session?';
    if (!confirm(confirmMessage)) {
      return;
    }

    if (isArchived) {
      await sessionsStore.unarchiveSession(currentSessionId.value);
      uiStore.success('Session unarchived');
    } else {
      await sessionsStore.archiveSession(currentSessionId.value);
      uiStore.success('Session archived');
    }
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleStar() {
  try {
    await sessionsStore.toggleSessionStar(currentSessionId.value);
  } catch (err) {
    uiStore.error(err.message);
  }
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
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 3rem;
}

.tab-content {
  min-height: 400px;
}

/* Delete overlay styles */
.delete-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: var(--color-text, #e0e0e0);
  font-size: 1.125rem;
}

.delete-spinner {
  display: inline-block;
  width: 3rem;
  height: 3rem;
  border: 3px solid rgba(0, 188, 212, 0.2);
  border-top-color: var(--color-primary, #00bcd4);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Fade transition for overlay */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
