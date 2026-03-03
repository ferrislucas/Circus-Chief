import { ref, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useSessionSubscription, ensureSubscribed } from './useWebSocket.js';
import { api } from './useApi.js';
import { parseDiff } from '../utils/diffParser.js';

/**
 * Composable for managing WebSocket subscriptions, polling, and data fetching
 * for the session detail view. Handles lifecycle of subscriptions when navigating
 * between sessions, and provides polling for actively running sessions.
 *
 * @param {import('vue').Ref<string>} currentSessionId - Reactive session ID
 * @returns {Object} Session WebSocket state and control functions
 */
export function useSessionWebSocket(currentSessionId) {
  const sessionsStore = useSessionsStore();
  const canvasStore = useCanvasStore();
  const todosStore = useTodosStore();
  const uiStore = useUiStore();
  const templatesStore = useTemplatesStore();
  const commandButtonsStore = useCommandButtonsStore();

  // Track current subscription instance - recreated on session change
  let currentSubscription = null;
  let cleanups = [];
  const pollIntervalId = ref(null);
  const summary = ref(null);
  const hasChanges = ref(false);
  const changesFileCount = ref(0);
  const canvasItemCount = ref(0);

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
    // Clear session-specific data to prevent stale state when switching sessions
    sessionsStore.messages = [];
    sessionsStore.conversations = [];
    sessionsStore.workLogs = {};
    sessionsStore.clearPartialText();
    canvasStore.items = [];
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
  const stopStatusWatch = watch(
    () => sessionsStore.currentSession?.status,
    (newStatus, oldStatus) => {
      if (newStatus === 'running' || newStatus === 'starting') {
        startPolling();
      } else if (oldStatus === 'running' || oldStatus === 'starting') {
        stopPolling();
      }
    }
  );

  // Watch for conversation changes to refetch todos (scoped to conversation)
  const stopConversationWatch = watch(
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

  /**
   * Full teardown including watchers. Call from onUnmounted.
   */
  function destroy() {
    cleanup();
    stopStatusWatch();
    stopConversationWatch();
  }

  return {
    summary,
    hasChanges,
    changesFileCount,
    canvasItemCount,
    cleanup,
    initializeSession,
    destroy,
  };
}
