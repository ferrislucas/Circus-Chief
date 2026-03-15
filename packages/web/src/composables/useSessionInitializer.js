import { ref } from 'vue';
import { useSessionSubscription, ensureSubscribed, useWebSocket } from './useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useTemplatesStore } from '../stores/templates.js';
import { api } from './useApi.js';

/**
 * Composable for initializing and managing WebSocket subscriptions and data
 * fetching for a session. Encapsulates all 21 WebSocket handler registrations,
 * subscription lifecycle, data fetching, and cleanup.
 *
 * @param {Object} options
 * @param {import('vue').Ref<Object>} options.summary - Ref for the session summary
 * @param {import('vue').Ref<boolean>} options.hasChanges - Ref for change indicator
 * @param {import('vue').Ref<number>} options.changesFileCount - Ref for file change count
 * @param {Function} options.checkForChanges - Function to check for file changes
 * @param {Function} options.startPolling - Function to start status polling
 * @param {Function} options.stopPolling - Function to stop status polling
 * @param {Function} options.resetPolling - Function to reset polling state
 * @returns {Object} Session initializer utilities
 */
export function useSessionInitializer({
  summary,
  hasChanges,
  changesFileCount,
  checkForChanges,
  startPolling,
  stopPolling,
  resetPolling,
}) {
  const sessionsStore = useSessionsStore();
  const canvasStore = useCanvasStore();
  const todosStore = useTodosStore();
  const uiStore = useUiStore();
  const commandButtonsStore = useCommandButtonsStore();
  const templatesStore = useTemplatesStore();

  // Track current subscription instance - recreated on session change
  let currentSubscription = null;
  let cleanups = [];

  /**
   * Cleanup function - called on unmount AND on route change (session navigation).
   * Ensures WebSocket subscriptions don't leak between sessions.
   */
  function cleanup() {
    // Reset polling state via composable
    resetPolling();
    if (currentSubscription) {
      currentSubscription.unsubscribe();
      currentSubscription = null;
    }
    cleanups.forEach((c) => c());
    cleanups = [];
    sessionsStore.clearRunningUsage();
    // Clear all session-specific store state to prevent stale data during transitions
    sessionsStore.messages = [];
    sessionsStore.conversations = [];
    sessionsStore.workLogs = {};
    sessionsStore.clearPartialText();
    todosStore.clearTodos();
    canvasStore.items = [];
    // Reset local state
    summary.value = null;
    canvasStore.$reset();
  }

  /**
   * Initialize session - called on mount AND on route change (session navigation).
   * Sets up WebSocket subscription and handlers for the given session.
   *
   * @param {string} sessionId - The session ID to initialize
   */
  async function initializeSession(sessionId) {
    // STEP 1: Create new subscription for this session
    currentSubscription = useSessionSubscription(sessionId);
    const {
      subscribe, unsubscribe,
      onStatus, onMessage, onPartial, onError,
      onCanvasAdd, onCanvasRemove,
      onTodosUpdate, onSessionUpdate, onSummaryUpdate,
      onConversationCreated, onConversationUpdated, onConversationDeleted,
      onUsageUpdate, onChangesUpdate,
      onWorkLog, onWorkLogsAssociated,
      onThinkingPartial,
      onCommandOutput, onCommandComplete, onCommandError,
    } = currentSubscription;

    // STEP 2: Subscribe via the subscription object AND await connection
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
        sessionsStore.clearPartialText();
      })
    );

    cleanups.push(
      onPartial((text) => {
        sessionsStore.setPartialText(text);
      })
    );

    cleanups.push(
      onWorkLog((log) => {
        sessionsStore.addWorkLog(log);
      })
    );

    cleanups.push(
      onWorkLogsAssociated((messageId) => {
        sessionsStore.associateWorkLogs(messageId);
      })
    );

    cleanups.push(
      onThinkingPartial((thinking) => {
        if (thinking === null) {
          sessionsStore.clearPartialThinking(sessionId);
        } else {
          sessionsStore.setPartialThinking(thinking, sessionId);
        }
      })
    );

    cleanups.push(
      onConversationCreated((conversation) => {
        sessionsStore.addConversation(conversation);
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
      onConversationDeleted((conversationId, newActiveConv) => {
        sessionsStore.removeConversation(conversationId, newActiveConv, sessionId);
        if (newActiveConv) {
          sessionsStore.fetchMessages(sessionId, false);
        }
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
    todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);

    // Fetch summary for PR indicators (don't await, not critical)
    api.getSessionSummary(sessionId).then((s) => {
      summary.value = s;
    }).catch(() => {
      // Ignore errors - summary may not exist yet
    });

    // Check for file system changes initially
    checkForChanges();

    // Re-fetch all critical data when WebSocket reconnects (e.g., after wake-from-sleep)
    const { onReconnect } = useWebSocket();
    cleanups.push(
      onReconnect(async () => {
        await sessionsStore.fetchSession(sessionId);
        await sessionsStore.fetchConversations(sessionId);
        await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
        await sessionsStore.fetchWorkLogs(sessionId);
        await canvasStore.fetchItems(sessionId);
        checkForChanges();
      })
    );

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

  return {
    cleanup,
    initializeSession,
  };
}
