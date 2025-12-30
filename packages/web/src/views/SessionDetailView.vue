<template>
  <div class="container">
    <div v-if="sessionsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading session...
    </div>

    <template v-else-if="sessionsStore.currentSession">
      <div class="session-header">
        <div>
          <h3 class="session-name">{{ sessionsStore.currentSession.name }}</h3>
          <div class="session-meta">
            <span :class="['status-badge', `status-${sessionsStore.currentSession.status}`]">
              {{ sessionsStore.currentSession.status }}
            </span>
            <span class="session-mode">{{ formatMode(sessionsStore.currentSession.mode) }}</span>
            <span class="session-model">{{ formatModel(sessionsStore.currentSession.model) }}</span>
            <span v-if="sessionsStore.currentSession.nextTemplateId" class="template-badge">
              🔗 Next: {{ getTemplateName(sessionsStore.currentSession.nextTemplateId) }}
            </span>
          </div>
          <div class="branch-line">
            <div class="branch-pr-indicators">
              <span
                v-if="sessionsStore.currentSession.gitBranch"
                class="branch-indicator"
                :title="sessionsStore.currentSession.gitBranch"
              >
                <svg class="branch-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
                </svg>
                {{ sessionsStore.currentSession.gitBranch }}
              </span>
              <PrIndicators
                v-if="sessionsStore.currentSession.prUrl"
                :pr-url="sessionsStore.currentSession.prUrl"
                :summary="summary"
              />
            </div>
            <div class="session-action-buttons">
              <button
                v-if="canArchive"
                class="btn btn-outline-secondary btn-archive-session"
                @click="handleArchive"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
                  <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
                  <path d="M10 13h4"></path>
                </svg>
                {{ sessionsStore.currentSession?.archived ? 'Unarchive' : 'Archive' }}
              </button>
              <button
                class="btn btn-outline-danger btn-delete-session"
                @click="handleDelete"
              >
                Delete Session
              </button>
            </div>
          </div>
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
        <NotesTab v-else-if="activeTab === 'notes'" :session-id="route.params.id" />
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
import NotesTab from '../components/NotesTab.vue';
import SummaryTab from '../components/SummaryTab.vue';
import CommandsTab from '../components/CommandsTab.vue';
import PrIndicators from '../components/PrIndicators.vue';
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
  { id: 'notes', label: 'Notes' },
  { id: 'commands', label: 'Commands' }
]);

function navigateToTab(tabId) {
  router.push(`/sessions/${route.params.id}/${tabId}`);
}

const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove, onTodosUpdate, onSessionUpdate, onSummaryUpdate, onUsageUpdate, onConversationUpdated, onChangesUpdate } =
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

// Watch canvas items and update count
watch(
  () => canvasStore.groupedItems.length,
  (count) => {
    canvasItemCount.value = count;
  },
  { immediate: true }
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

  // STEP 2: Register all handlers IMMEDIATELY (before fetching data)
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
    })
  );

  cleanups.push(
    onCanvasRemove((itemId) => {
      canvasStore.removeItem(itemId);
    })
  );

  cleanups.push(
    onTodosUpdate((todos) => {
      todosStore.updateTodos(todos);
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

  cleanups.push(
    onUsageUpdate((msg) => {
      if (msg.isFinal) {
        // Pass conversationId for conversation-level usage tracking (Issue #175)
        sessionsStore.finalizeUsage(msg.usage, msg.conversationId);
      } else {
        sessionsStore.updateRunningUsage(msg.usage, msg.conversationId);
      }
    })
  );

  // Handle conversation updates for usage tracking (Issue #175)
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

  // STEP 3: Now fetch data (handlers are ready to receive updates)
  await sessionsStore.fetchSession(sessionId);
  await sessionsStore.fetchMessages(sessionId);
  // Load conversations proactively so token updates are available immediately
  // (Issue: conversations were only loaded when ConversationTab became visible)
  await sessionsStore.fetchConversations(sessionId);
  await sessionsStore.fetchWorkLogs(sessionId);
  // Await canvas fetch to ensure indicator shows correct count immediately.
  // This catches items added before/during WebSocket subscription establishment.
  await canvasStore.fetchItems(sessionId);
  todosStore.fetchTodos(sessionId);

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

  // STEP 4: Start polling if session is actively processing
  // (handles race condition where session completes before WebSocket subscription is established)
  const status = sessionsStore.currentSession?.status;
  if (status === 'running' || status === 'starting') {
    startPolling();
  }
});

onUnmounted(() => {
  stopPolling();
  unsubscribe();
  cleanups.forEach((cleanup) => cleanup());
  sessionsStore.clearRunningUsage();
});

function formatMode(mode) {
  if (mode === 'yolo') return 'YOLO';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatModel(modelId) {
  return getModelDisplayName(modelId);
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
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.session-name {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.branch-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.branch-pr-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.session-action-buttons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  flex-shrink: 0;
}

.btn-archive-session {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.btn-archive-session svg {
  flex-shrink: 0;
}

.btn-delete-session {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .session-action-buttons {
    margin-left: 0;
    flex-wrap: wrap;
  }
}

.session-mode {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-usage {
  margin-top: 0.75rem;
}

.template-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 500;
  color: #333;
  background: var(--color-warning, #f0ad4e);
  border-radius: 4px;
  white-space: nowrap;
}

.branch-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--color-secondary, #8b5cf6);
  background: var(--color-secondary-soft, rgba(139, 92, 246, 0.1));
  border-radius: 4px;
  text-decoration: none;
  white-space: nowrap;
}

.branch-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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
