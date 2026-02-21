<template>
  <div class="container">
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

      <div class="session-header">
        <!-- Main header row with status, name, and menu -->
        <div class="session-header-row">
          <!-- Session name -->
          <h3 class="session-name">{{ sessionsStore.currentSession.name }}</h3>

          <!-- Overflow menu with secondary actions -->
          <OverflowMenu
            aria-label="Session actions"
            :is-archived="sessionsStore.currentSession.archived"
            :is-deleting="isDeleting"
            copy-session-id-text="Copy ID"
            @duplicate="handleDuplicate"
            @copySessionId="handleCopySessionId"
            @archive="handleArchive"
            @delete="handleDelete"
          />
        </div>

        <!-- PR indicators and command button status bar -->
        <div class="branch-pr-indicators">
          <div class="left-indicators">
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
            <template v-if="isEditingPrUrl">
              <div class="pr-edit-form">
                <input
                  v-model="editPrUrlValue"
                  type="url"
                  class="pr-url-input"
                  placeholder="https://github.com/owner/repo/pull/123"
                  @keyup.enter="savePrUrl"
                  @keyup.escape="cancelEditPrUrl"
                />
                <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="savePrUrl">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
                <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="cancelEditPrUrl">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
                <button v-if="editPrUrlValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear PR URL" @click="clearPrUrl">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </template>
            <template v-else>
              <PrIndicators
                v-if="sessionsStore.currentSession.prUrl"
                :pr-url="sessionsStore.currentSession.prUrl"
                :summary="summary"
              />
              <button class="btn-link pr-edit-trigger" @click="startEditPrUrl" :title="sessionsStore.currentSession.prUrl ? 'Edit PR URL' : 'Add PR URL'">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span v-if="!sessionsStore.currentSession.prUrl">Link PR</span>
              </button>
            </template>
          </div>

          <!-- Command button status indicators for real-time status updates -->
          <CommandButtonStatusBar :button-statuses="buttonStatusesToDisplay" />
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

      <!-- Scheduling Info Panel -->
      <SchedulingInfo v-if="sessionsStore.currentSession" :session="sessionsStore.currentSession" />

      <div class="tab-content">
        <!-- CRITICAL: :key ensures components remount when navigating between sessions,
             preventing stale WebSocket handlers from capturing the wrong sessionId -->
        <SummaryTab v-if="activeTab === 'summary'" :key="route.params.id" :session-id="route.params.id" />
        <ConversationTab v-else-if="activeTab === 'conversation'" :key="route.params.id" :session-id="route.params.id" />
        <ChangesTab v-else-if="activeTab === 'changes'" :key="route.params.id" :session-id="route.params.id" @update:file-count="changesFileCount = $event" />
        <CanvasTab v-else-if="activeTab === 'canvas'" :key="route.params.id" :session-id="route.params.id" />
        <CommandsTab v-else-if="activeTab === 'commands'" :key="route.params.id" :session-id="route.params.id" :project-id="sessionsStore.currentSession?.projectId" />
      </div>
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
import OverflowMenu from '../components/OverflowMenu.vue';
import SchedulingInfo from '../components/SchedulingInfo.vue';
import CommandButtonStatusBar from '../components/CommandButtonStatusBar.vue';
import SessionHierarchyBreadcrumb from '../components/SessionHierarchyBreadcrumb.vue';
import { useTemplatesStore } from '../stores/templates.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
const canvasStore = useCanvasStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const { getModelDisplayName } = useModelInfo();

// Reactive session ID that tracks route changes
// When navigating between sessions (parent/child), the component is reused
// and the route watcher handles cleanup and re-initialization
const currentSessionId = ref(route.params.id);

// Track current subscription instance - recreated on session change
let currentSubscription = null;

const activeTab = computed(() => route.params.tab || 'conversation');

// Get the session hierarchy path (for breadcrumbs)
const sessionPath = computed(() => {
  // Use route.params.id directly to be reactive to route changes
  return sessionsStore.getSessionPath(route.params.id);
});

const changesFileCount = ref(0);
const canvasItemCount = ref(0);

// Command button status indicators for real-time updates (mirrors SessionCard behavior)
const buttonStatusesToDisplay = computed(() => {
  // Access commandRunVersion to establish Vue dependency tracking.
  // This forces the computed to re-evaluate whenever updateSessionCommandRun is called,
  // ensuring real-time updates on the session detail view.
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

// Allow archiving any session that isn't running
const canArchive = computed(() => {
  const status = sessionsStore.currentSession?.status;
  return status && status !== 'running';
});

const tabs = computed(() => [
  { id: 'summary', label: 'Summary' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'changes', label: changesFileCount.value > 0 ? `Changes (${changesFileCount.value})` : 'Changes' },
  { id: 'canvas', label: canvasItemCount.value > 0 ? `Canvas (${canvasItemCount.value})` : 'Canvas' },
  { id: 'commands', label: 'Commands' }
]);

function navigateToTab(tabId) {
  router.push(`/sessions/${route.params.id}/${tabId}`);
}

// Note: Subscription is created dynamically in initializeSession() to handle session changes
// The currentSubscription variable tracks the active subscription instance

let cleanups = [];
const pollIntervalId = ref(null);
const showDeleteConfirm = ref(false);
const summary = ref(null);
const hasChanges = ref(false);
const isDeleting = ref(false);

// PR URL editing state
const isEditingPrUrl = ref(false);
const editPrUrlValue = ref('');

// Check for file system changes (staged, unstaged, untracked)
async function checkForChanges() {
  if (!currentSessionId.value) return;
  try {
    const changes = await api.getSessionChanges(currentSessionId.value);
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
    const sessionId = currentSessionId.value;
    // Only poll while actively processing, not while waiting for user input
    // Use showLoading=false to avoid flickering
    if (status === 'running' || status === 'starting') {
      await sessionsStore.fetchSession(sessionId, false);
      await sessionsStore.fetchConversations(sessionId); // NEW: Fetch token counts
      await sessionsStore.fetchMessages(sessionId, false);
      await sessionsStore.fetchWorkLogs(sessionId);
      // Check for file changes during active session so the Changes tab indicator updates
      checkForChanges();
    } else {
      // Session no longer actively processing, stop polling
      stopPolling();
    }
  }, 1000); // Changed from 2000
}

function stopPolling() {
  if (pollIntervalId.value) {
    clearInterval(pollIntervalId.value);
    pollIntervalId.value = null;
  }
}

// Cleanup function - called on unmount AND on route change (session navigation)
// This ensures WebSocket subscriptions don't leak between sessions
function cleanup() {
  stopPolling();
  if (currentSubscription) {
    currentSubscription.unsubscribe();
    currentSubscription = null;
  }
  cleanups.forEach((c) => c());
  cleanups = [];
  sessionsStore.clearRunningUsage();
  todosStore.clearTodos();
  // Reset local state
  summary.value = null;
  hasChanges.value = false;
  changesFileCount.value = 0;
  canvasItemCount.value = 0;
}

// Initialize session - called on mount AND on route change (session navigation)
// This sets up WebSocket subscription and handlers for the given session
async function initializeSession(sessionId) {
  // STEP 1: Create new subscription for this session
  currentSubscription = useSessionSubscription(sessionId);
  const { subscribe, unsubscribe, onStatus, onMessage, onError, onCanvasAdd, onCanvasRemove, onTodosUpdate, onSessionUpdate, onSummaryUpdate, onConversationUpdated, onUsageUpdate, onChangesUpdate, onCommandOutput, onCommandComplete, onCommandError } = currentSubscription;

  // STEP 2: Subscribe via the subscription object AND await connection
  // CRITICAL: We must call subscribe() to set thisInstanceSubscribed = true,
  // otherwise unsubscribe() in cleanup() does nothing and we leak subscriptions.
  // ensureSubscribed() waits for the WebSocket connection before resolving.
  subscribe();
  try {
    await ensureSubscribed(sessionId);
  } catch (error) {
    console.error('Failed to subscribe to session updates:', error);
    uiStore.error('Failed to subscribe to session updates');
  }

  // STEP 3: Fetch critical data BEFORE registering handlers
  await sessionsStore.fetchSession(sessionId);
  await sessionsStore.fetchConversations(sessionId);

  // Fetch command buttons for the project
  const projectId = sessionsStore.currentSession?.projectId;
  if (projectId) {
    try {
      await commandButtonsStore.fetchButtons(projectId);
    } catch (error) {
      console.debug('Failed to fetch command buttons:', error);
    }
  }

  // STEP 4: Register all handlers
  cleanups.push(
    onStatus((status) => {
      sessionsStore.updateSessionStatus(sessionId, status);
      if (status === 'running' || status === 'starting') {
        startPolling();
      } else {
        stopPolling();
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
      canvasItemCount.value = canvasStore.groupedItems.length;
    })
  );

  cleanups.push(
    onCanvasRemove((itemId) => {
      canvasStore.removeItem(itemId);
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

  cleanups.push(
    onConversationUpdated((conversation) => {
      sessionsStore.updateConversation(conversation);
    })
  );

  cleanups.push(
    onUsageUpdate((msg) => {
      if (msg.isFinal) {
        sessionsStore.finalizeUsage(msg.usage, msg.conversationId);
      } else {
        sessionsStore.updateRunningUsage(msg.usage, msg.conversationId);
      }
    })
  );

  cleanups.push(
    onChangesUpdate((changeCount, hasChangesUpdate) => {
      changesFileCount.value = changeCount;
      if (typeof hasChangesUpdate === 'boolean') {
        hasChanges.value = hasChangesUpdate;
      } else {
        hasChanges.value = changeCount > 0;
      }
    })
  );

  cleanups.push(
    onCommandOutput((runId, buttonId, output) => {
      const existingRun = commandButtonsStore.runs[runId];
      const existingSessionRun = sessionsStore.currentSession?.latestCommandRuns?.find(r => r.runId === runId);
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'running',
        runId,
        startedAt: existingRun?.startedAt || existingSessionRun?.startedAt || Date.now(),
      });
    })
  );

  cleanups.push(
    onCommandComplete((runId, buttonId, exitCode, output) => {
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

  cleanups.push(
    onCommandError((runId, buttonId, error) => {
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'error',
        runId,
        completedAt: Date.now(),
      });
    })
  );

  // STEP 5: Fetch remaining data
  await sessionsStore.fetchMessages(sessionId);
  await sessionsStore.fetchWorkLogs(sessionId);
  await canvasStore.fetchItems(sessionId);
  canvasItemCount.value = canvasStore.groupedItems.length;
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

  // STEP 6: Start polling if session is actively processing
  const status = sessionsStore.currentSession?.status;
  if (status === 'running' || status === 'starting') {
    startPolling();
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
  // Initialize the session with WebSocket subscription and data fetching
  await initializeSession(currentSessionId.value);
});

// Watch for session changes within the same component (e.g., navigating between sessions)
// This handles the case where the route changes but the component doesn't unmount/remount
// CRITICAL: This fixes the WebSocket subscription leak bug - we must cleanup the old session
// and reinitialize with the new session to prevent messages from leaking across sessions
watch(
  () => route.params.id,
  async (newSessionId, oldSessionId) => {
    // Only proceed if the session ID actually changed
    if (newSessionId && newSessionId !== oldSessionId) {
      // STEP 1: Cleanup old session (unsubscribe WebSocket, clear handlers, reset state)
      cleanup();

      // STEP 2: Update the reactive session ID
      currentSessionId.value = newSessionId;

      // STEP 3: Initialize the new session (subscribe WebSocket, register handlers, fetch data)
      await initializeSession(newSessionId);
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
      todosStore.fetchTodos(currentSessionId.value, newConvId);
    }
  }
);

// Handle component reactivation (keep-alive) - refresh data when view becomes active again
// This ensures fresh token counts and other data when returning from another tab/session
onActivated(() => {
  if (currentSessionId.value) {
    // Refetch conversations to get latest token counts and other updated data
    sessionsStore.fetchConversations(currentSessionId.value);
  }
});

onUnmounted(() => {
  // Use the centralized cleanup function to ensure all resources are freed
  cleanup();
});

async function handleDuplicate() {
  if (!confirm('Duplicate this session? A new session will be created with all conversations, canvas items, and notes.')) {
    return;
  }

  try {
    // Get the current session ID to duplicate
    const newSessionId = await sessionsStore.duplicateSession(currentSessionId.value);
    uiStore.success('Session duplicated');
    // Optionally navigate to the new session
    router.push(`/sessions/${newSessionId}/conversation`);
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this session?')) return;

  isDeleting.value = true;

  // Show immediate feedback
  uiStore.addToast('info', 'Deleting session...', 0); // 0 = no auto-dismiss

  try {
    const projectId = sessionsStore.currentSession?.projectId;
    await sessionsStore.deleteSession(currentSessionId.value);

    // Remove the "Deleting..." toast
    const toastsToRemove = uiStore.toasts.filter(t => t.message === 'Deleting session...');
    toastsToRemove.forEach(t => uiStore.removeToast(t.id));

    uiStore.success('Session deleted');
    // Navigate to project sessions list
    if (projectId) {
      router.push(`/projects/${projectId}/sessions`);
    } else {
      router.push('/');
    }
  } catch (err) {
    isDeleting.value = false;

    // Remove the "Deleting..." toast
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
    // Fallback using textarea method for older browsers
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

function getTemplateName(templateId) {
  const template = templatesStore.getTemplateById(templateId);
  return template?.name || 'Unknown template';
}

// PR URL editing functions
function startEditPrUrl() {
  editPrUrlValue.value = sessionsStore.currentSession?.prUrl || '';
  isEditingPrUrl.value = true;
}

function cancelEditPrUrl() {
  isEditingPrUrl.value = false;
  editPrUrlValue.value = '';
}

async function savePrUrl() {
  const newPrUrl = editPrUrlValue.value.trim();
  const sessionId = currentSessionId.value;

  // Validate if not empty
  if (newPrUrl) {
    const prUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
    if (!prUrlPattern.test(newPrUrl)) {
      uiStore.error('Invalid PR URL format. Must be a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)');
      return;
    }
  }

  try {
    const updated = await api.updateSession(sessionId, { prUrl: newPrUrl || null });
    // Update the session in the store (updateSession from WebSocket handler pattern)
    sessionsStore.updateSession({ ...updated, id: sessionId });
    uiStore.success(newPrUrl ? 'PR URL updated' : 'PR URL cleared');
    isEditingPrUrl.value = false;
    editPrUrlValue.value = '';
  } catch (err) {
    uiStore.error(err.message || 'Failed to update PR URL');
  }
}

async function clearPrUrl() {
  editPrUrlValue.value = '';
  await savePrUrl();
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
  gap: 0.25rem;
  margin-bottom: 0.5rem;
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
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.left-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
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

/* PR URL editing styles */
.pr-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pr-url-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 280px;
  max-width: 400px;
}

.pr-url-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.pr-url-input::placeholder {
  color: var(--color-text-soft, #888);
}

.pr-edit-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.pr-save-btn {
  color: var(--color-success, #4caf50);
}

.pr-save-btn:hover {
  background: rgba(76, 175, 80, 0.1);
}

.pr-cancel-btn {
  color: var(--color-text-soft, #888);
}

.pr-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.pr-clear-btn {
  color: var(--color-error, #f44336);
}

.pr-clear-btn:hover {
  background: rgba(244, 67, 54, 0.1);
}

.pr-edit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft, #888);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.pr-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}

@media (max-width: 480px) {
  .pr-url-input {
    min-width: 180px;
    max-width: 100%;
  }

  .pr-edit-form {
    flex-wrap: wrap;
  }
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
