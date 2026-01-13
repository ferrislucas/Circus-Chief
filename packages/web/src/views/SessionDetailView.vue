<template>
  <div class="container">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <div class="session-header">
        <!-- Main header row with star, status, name, and menu -->
        <div class="session-header-row">
          <!-- Star button (icon only) -->
          <button
            class="btn-icon btn-star"
            :title="sessionsStore.currentSession?.starred ? 'Unstar session' : 'Star session'"
            :class="{ 'is-starred': sessionsStore.currentSession?.starred }"
            @click="handleStar"
          >
            <svg v-if="sessionsStore.currentSession?.starred" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
            </svg>
          </button>

          <!-- Status indicator -->
          <StatusIndicator :status="sessionsStore.currentSession.status" />

          <!-- Session name -->
          <h3 class="session-name">{{ sessionsStore.currentSession.name }}</h3>

          <!-- Overflow menu with secondary actions -->
          <OverflowMenu
            aria-label="Session actions"
            :is-archived="sessionsStore.currentSession.archived"
            @duplicate="handleDuplicate"
            @archive="handleArchive"
            @delete="handleDelete"
          />
        </div>

        <!-- PR indicators below main header -->
        <div v-if="sessionsStore.currentSession.prUrl" class="branch-pr-indicators">
          <PrIndicators
            :pr-url="sessionsStore.currentSession.prUrl"
            :summary="summary"
          />
        </div>
      </div>

      <div class="tabs">
        <router-link
          :to="`/projects/${sessionsStore.currentSession.projectId}/sessions`"
          class="tab tab-back"
        >
          ← Sessions
        </router-link>
        <span class="tab-separator"></span>

        <!-- Desktop tabs -->
        <div class="tabs-desktop">
          <router-link
            v-for="tab in tabs"
            :key="tab.id"
            :to="`/sessions/${route.params.id}/${tab.id}`"
            :class="['tab', { active: activeTab === tab.id }]"
          >
            {{ tab.label }}
            <span
              v-if="tab.id === 'changes' && hasChanges"
              class="changes-indicator"
              title="Uncommitted changes"
            ></span>
            <span
              v-if="tab.id === 'canvas' && canvasItemCount > 0"
              class="canvas-indicator"
              title="Canvas contains files"
            ></span>
          </router-link>
        </div>

        <!-- Mobile dropdown -->
        <div class="tabs-mobile">
          <select :value="activeTab" @change="navigateToTab($event.target.value)" class="tab-select">
            <option v-for="tab in tabs" :key="tab.id" :value="tab.id">
              {{ tab.label }}{{ tab.id === 'changes' && hasChanges ? ' •' : '' }}{{ tab.id === 'canvas' && canvasItemCount > 0 ? ' •' : '' }}
            </option>
          </select>
        </div>
      </div>

      <div class="tab-content">
        <SummaryTab v-if="activeTab === 'summary'" :session-id="route.params.id" />
        <ConversationTab v-else-if="activeTab === 'conversation'" :session-id="route.params.id" />
        <ChangesTab v-else-if="activeTab === 'changes'" :session-id="route.params.id" @update:file-count="changesFileCount = $event" />
        <CanvasTab v-else-if="activeTab === 'canvas'" :session-id="route.params.id" />
        <CommandsTab v-else-if="activeTab === 'commands'" :session-id="route.params.id" :project-id="sessionsStore.currentSession?.projectId" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription, ensureSubscribed } from '../composables/useWebSocket.js';
import { useModelInfo } from '../composables/useModelInfo.js';
import { api } from '../composables/useApi.js';
import { parseDiff } from '../utils/diffParser.js';
import ConversationTab from '../components/ConversationTab.vue';
import ChangesTab from '../components/ChangesTab.vue';
import CanvasTab from '../components/CanvasTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import CommandsTab from '../components/CommandsTab.vue';
import PrIndicators from '../components/PrIndicators.vue';
import DuplicateSessionButton from '../components/DuplicateSessionButton.vue';
import StatusIndicator from '../components/StatusIndicator.vue';
import OverflowMenu from '../components/OverflowMenu.vue';
import { useTemplatesStore } from '../stores/templates.js';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const canvasStore = useCanvasStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const { getModelDisplayName } = useModelInfo();

// Capture session ID at component creation to avoid race conditions during navigation.
// When navigating away, Vue Router updates route.params BEFORE unmounting the component.
// If polling reads route.params.id after navigation starts, it would get the wrong ID.
const sessionId = route.params.id;

const activeTab = computed(() => route.params.tab || 'conversation');
const changesFileCount = ref(0);
const canvasItemCount = ref(0);

// Allow archiving any session that isn't running
const canArchive = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status && status !== 'running';
});

const tabs = computed(() => [
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'changes', label: changesFileCount.value > 0 ? `Changes (${changesFileCount.value})` : 'Changes' },
  { id: 'canvas', label: canvasItemCount.value > 0 ? `Canvas (${canvasItemCount.value})` : 'Canvas' },
  { id: 'commands', label: 'Commands' }
]);

function navigateToTab(tabId) {
  router.push(`/sessions/${route.params.id}/${tabId}`);
}

const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove, onTodosUpdate, onSessionUpdate, onSummaryUpdate, onConversationUpdated, onChangesUpdate } =
  useSessionSubscription(sessionId);

let cleanups = [];
const pollIntervalId = ref(null);
const showDeleteConfirm = ref(false);
const summary = ref(null);
const hasChanges = ref(false);

// Check for file system changes (staged, unstaged, untracked)
async function checkForChanges() {
  if (!sessionId) return;
  try {
    const changes = await api.getSessionChanges(sessionId);
    hasChanges.value = !!(changes.staged || changes.unstaged || changes.untracked);
    // Count files from the diff responses so the tab shows the count immediately
    const stagedFiles = parseDiff(changes.staged || '');
    const unstagedFiles = parseDiff(changes.unstaged || '');
    const untrackedFiles = parseDiff(changes.untracked || '');
    changesFileCount.value = stagedFiles.length + unstagedFiles.length + untrackedFiles.length;
  } catch (error) {
    // Silently fail - changes indicator is not critical
    console.error('Failed to check for changes:', error);
  }
}

// Poll for updates while session is actively processing (fallback for race conditions)
function startPolling() {
  if (pollIntervalId.value) return;
  pollIntervalId.value = setInterval(async () => {
    const status = sessionsStore.currentSession?.status;
    // Only poll while actively processing, not while waiting for user input
    // Use showLoading=false to avoid flickering
    if (status === 'running' || status === 'starting') {
      await sessionsStore.fetchSession(sessionId, false);
      await sessionsStore.fetchMessages(sessionId, false);
      await sessionsStore.fetchWorkLogs(sessionId);
      // Check for file changes during active session so the Changes tab indicator updates
      checkForChanges();
    } else {
      // Session no longer actively processing, stop polling
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollIntervalId.value) {
    clearInterval(pollIntervalId.value);
    pollIntervalId.value = null;
  }
}

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
  // STEP 1: Ensure subscribed to WebSocket first
  // This waits for the socket to be OPEN and subscription message to be sent
  try {
    await ensureSubscribed(sessionId);
  } catch (error) {
    console.error('Failed to subscribe to session updates:', error);
    uiStore.error('Failed to subscribe to session updates');
  }

  // STEP 1.5: Fetch critical data BEFORE registering handlers
  // This ensures conversations array is populated when usage updates arrive
  // and prevents handlers from trying to access empty conversation lists
  await sessionsStore.fetchSession(sessionId);
  await sessionsStore.fetchConversations(sessionId);

  // STEP 2: Register all handlers (data is now ready)
  // This ensures we don't miss any updates that arrive while data is being fetched
  cleanups.push(
    onStatus((status) => {
      sessionsStore.updateSessionStatus(sessionId, status);
      // Start polling when session starts processing, stop when done
      if (status === 'running' || status === 'starting') {
        startPolling();
      } else {
        stopPolling();
        // Check for changes when session becomes idle (after conversation returns)
        if (status === 'waiting' || status === 'completed') {
          checkForChanges();
        }
      }
    })
  );

  cleanups.push(
    onMessage((message) => {
      sessionsStore.addMessage(message);
    })
  );

  cleanups.push(
    onError((error) => {
      uiStore.error(error);
    })
  );

  cleanups.push(
    onCanvasAdd((item) => {
      canvasStore.addItem(item);
      // Update canvas count immediately when WebSocket event arrives
      // Use groupedItems.length to get the deduplicated count
      canvasItemCount.value = canvasStore.groupedItems.length;
    })
  );

  cleanups.push(
    onCanvasRemove((itemId) => {
      canvasStore.removeItem(itemId);
      // Update canvas count immediately when item is removed
      // Use groupedItems.length to get the deduplicated count
      canvasItemCount.value = canvasStore.groupedItems.length;
    })
  );

  cleanups.push(
    onTodosUpdate((todos, conversationId) => {
      todosStore.updateTodos(todos, conversationId);
    })
  );

  cleanups.push(
    onSessionUpdate((session) => {
      sessionsStore.updateSession(session);
    })
  );

  cleanups.push(
    onSummaryUpdate((newSummary) => {
      summary.value = newSummary;
    })
  );

  // Handle conversation updates for usage tracking (Issue #175)
  // Note: onUsageUpdate is handled by ConversationTab to avoid duplicate registrations
  cleanups.push(
    onConversationUpdated((conversation) => {
      sessionsStore.updateConversation(conversation);
    })
  );

  // Handle real-time changes updates from server
  cleanups.push(
    onChangesUpdate((changeCount, hasChangesUpdate) => {
      changesFileCount.value = changeCount;
      // Update the orange circle indicator when changes are committed or new changes appear
      if (typeof hasChangesUpdate === 'boolean') {
        hasChanges.value = hasChangesUpdate;
      } else {
        // Fallback: determine from file count if hasChanges is not explicitly provided
        hasChanges.value = changeCount > 0;
      }
    })
  );

  // STEP 3: Clear todos store before fetching new session's todos
  // This prevents old session's todos from persisting visually
  todosStore.clearTodos();

  // STEP 4: Now fetch remaining data (handlers are ready to receive updates)
  await sessionsStore.fetchMessages(sessionId);
  await sessionsStore.fetchWorkLogs(sessionId);
  // Await canvas fetch to ensure indicator shows correct count immediately.
  // This catches items added before/during WebSocket subscription establishment.
  await canvasStore.fetchItems(sessionId);
  // Update canvas count after fetch completes to show correct indicator
  canvasItemCount.value = canvasStore.groupedItems.length;
  // Fetch todos for the active conversation (scoped to conversation, not session)
  todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);

  // Fetch summary for PR indicators (don't await, not critical)
  api.getSessionSummary(sessionId).then((s) => {
    summary.value = s;
  }).catch(() => {
    // Ignore errors - summary may not exist yet
  });

  // Check for file system changes initially
  checkForChanges();

  // Fetch templates for the selector
  if (sessionsStore.currentSession?.projectId) {
    templatesStore.fetchProjectTemplates(sessionsStore.currentSession.projectId);
  }

  // STEP 5: Start polling if session is actively processing
  // (handles race condition where session completes before WebSocket subscription is established)
  const status = sessionsStore.currentSession?.status;
  if (status === 'running' || status === 'starting') {
    startPolling();
  }
});

// Watch for session changes within the same component (e.g., navigating between sessions)
// This handles the case where the route changes but the component doesn't unmount/remount
watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    // Only proceed if the session ID actually changed
    if (newSessionId && newSessionId !== oldSessionId) {
      // Clear todos before switching to the new session
      todosStore.clearTodos();
      // Fetch the new session's todos for the active conversation
      todosStore.fetchTodos(newSessionId, sessionsStore.activeConversationId);
    }
  }
);

// Watch for conversation changes to refetch todos (scoped to conversation)
watch(
  () => sessionsStore.activeConversationId,
  async (newConvId, oldConvId) => {
    // Only refetch if conversation changed and we have a valid conversation
    if (newConvId && newConvId !== oldConvId) {
      // Clear and refetch todos for the new conversation
      todosStore.clearTodos();
      todosStore.fetchTodos(sessionId, newConvId);
    }
  }
);

onUnmounted(() => {
  stopPolling();
  unsubscribe();
  cleanups.forEach((cleanup) => cleanup());
  sessionsStore.clearRunningUsage();
});

async function handleDuplicate() {
  // This delegates to the DuplicateSessionButton's logic
  // The overflow menu emits the event, and we handle it here
  // For now, we'll trigger the duplicate action on the store or API
  try {
    // Get the current session ID to duplicate
    const newSessionId = await sessionsStore.duplicateSession(sessionId);
    uiStore.success('Session duplicated');
    // Optionally navigate to the new session
    router.push(`/sessions/${newSessionId}/conversation`);
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this session?')) return;

  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.deleteSession(sessionId);
    uiStore.success('Session deleted');
    // Navigate to project sessions list
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
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
      await sessionsStore.unarchiveSession(sessionId);
      uiStore.success('Session unarchived');
    } else {
      await sessionsStore.archiveSession(sessionId);
      uiStore.success('Session archived');
    }
    // Navigate to project sessions list
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
    await sessionsStore.toggleSessionStar(sessionId);
  } catch (err) {
    uiStore.error(err.message);
  }
}

function getTemplateName(templateId) {
  const template = templatesStore.getTemplateById(templateId);
  return template?.name || 'Unknown template';
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

.session-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0 0.5rem; /* Ensure content doesn't touch screen edges */
}

.session-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.btn-star {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.btn-star svg {
  flex-shrink: 0;
}

.btn-star.is-starred {
  color: var(--color-warning, #f0ad4e);
}

.session-name {
  flex: 1;
  min-width: 0; /* Critical: allows wrapping to work in flexbox */
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.4;
}

.branch-pr-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .session-header-row {
    /* Allow flexbox to accommodate multi-line session names */
    align-items: flex-start;
    min-height: auto;
    padding-top: 0.25rem; /* Align star button with first line of text */
  }

  .session-name {
    font-size: 1rem; /* Slightly smaller on mobile */
  }
}

.tab-content {
  min-height: 400px;
}

.changes-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

.canvas-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}
</style>
