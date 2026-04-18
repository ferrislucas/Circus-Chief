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
 * Register command button WebSocket handlers (output, complete, error, deleted)
 * @param {Object} subscription - The session subscription object
 * @param {string} sessionId - Current session ID
 * @param {Object} stores - Object containing sessionsStore and commandButtonsStore
 * @returns {Function[]} Array of cleanup functions
 */
function registerCommandHandlers(subscription, sessionId, stores) {
  const { sessionsStore, commandButtonsStore } = stores;
  const { onCommandOutput, onCommandComplete, onCommandError, onCommandRunDeleted } = subscription;
  const handlers = [];

  handlers.push(
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

  handlers.push(
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

  handlers.push(
    onCommandError((runId, buttonId, error) => {
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'error',
        runId,
        completedAt: Date.now(),
      });
    })
  );

  handlers.push(
    onCommandRunDeleted(async (runId, buttonId) => {
      console.log('[onCommandRunDeleted] Run deleted:', runId, 'for button:', buttonId);
      commandButtonsStore.clearRun(runId);
      try {
        await sessionsStore.fetchSession(sessionId, false);
        console.log('[onCommandRunDeleted] Session refetched, latestCommandRuns:', sessionsStore.currentSession?.latestCommandRuns);
        sessionsStore.commandRunVersion++;
        console.log('[onCommandRunDeleted] commandRunVersion incremented to:', sessionsStore.commandRunVersion);
      } catch (error) {
        console.error('Failed to fetch session after run deletion:', error);
        sessionsStore.removeSessionCommandRun(sessionId, buttonId);
      }
    })
  );

  return handlers;
}

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
 * @param {Function} [options.onReconnectCallback] - Optional callback invoked after WebSocket reconnection (e.g., to rebuild session chain)
 * @returns {Object} Session initializer utilities
 */
export function useSessionInitializer({
  summary: summaryRef,
  hasChanges: hasChangesRef,
  changesFileCount: changesFileCountRef,
  checkForChanges,
  startPolling,
  stopPolling,
  resetPolling,
  onReconnectCallback,
}) {
  const summary = summaryRef;
  const hasChanges = hasChangesRef;
  const changesFileCount = changesFileCountRef;
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
    sessionsStore.activeConversationId = null;
    sessionsStore.workLogs = {};
    sessionsStore.clearPartialText();
    todosStore.clearTodos();
    canvasStore.items = [];
    // Reset local state
    summary.value = null;
    canvasStore.$reset();
  }

  /**
   * Subscribe to the session WebSocket channel and wait for confirmation.
   * @param {Object} subscription - The session subscription object
   * @param {string} sessionId - The session ID
   */
  async function setupSessionSubscription(subscription, sessionId) {
    subscription.subscribe();
    try {
      await ensureSubscribed(sessionId);
    } catch (error) {
      console.error('Failed to subscribe to session updates:', error);
      uiStore.error('Failed to subscribe to session updates');
    }
  }

  /**
   * Fetch critical initial data for the session (session info, conversations, command buttons).
   * @param {string} sessionId - The session ID
   */
  async function fetchCriticalSessionData(sessionId) {
    await sessionsStore.fetchSession(sessionId);
    await sessionsStore.fetchConversations(sessionId);

    const projectId = sessionsStore.currentSession?.projectId;
    if (projectId) {
      try {
        await commandButtonsStore.fetchButtons(projectId);
      } catch (error) {
        console.debug('Failed to fetch command buttons:', error);
      }
    }
  }

  /**
   * Register all WebSocket event handlers for the session and return cleanup functions.
   * @param {Object} subscription - The session subscription object
   * @param {string} sessionId - The session ID
   * @returns {Function[]} Array of cleanup functions
   */
  function registerSessionHandlers(subscription, sessionId) {
    const {
      onStatus, onMessage, onPartial, onError,
      onCanvasAdd, onCanvasRemove, onCanvasUpdate,
      onTodosUpdate, onSessionUpdate, onSummaryUpdate,
      onConversationCreated, onConversationUpdated, onConversationDeleted,
      onUsageUpdate, onChangesUpdate,
      onWorkLog, onWorkLogsAssociated,
      onThinkingPartial,
    } = subscription;

    const handlers = [];

    handlers.push(
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

    handlers.push(onMessage((message) => {
      sessionsStore.addMessage(message);
      sessionsStore.clearPartialText();
    }));

    handlers.push(onPartial((text) => { sessionsStore.setPartialText(text); }));
    handlers.push(onWorkLog((log) => { sessionsStore.addWorkLog(log); }));
    handlers.push(onWorkLogsAssociated((messageId) => { sessionsStore.associateWorkLogs(messageId); }));

    handlers.push(
      onThinkingPartial((thinking) => {
        if (thinking === null) {
          sessionsStore.clearPartialThinking(sessionId);
        } else {
          sessionsStore.setPartialThinking(thinking, sessionId);
        }
      })
    );

    handlers.push(onConversationCreated((conversation) => { sessionsStore.addConversation(conversation); }));
    handlers.push(onError((err) => { uiStore.error(err); }));
    handlers.push(onCanvasAdd((item) => { canvasStore.addItem(item); }));
    handlers.push(onCanvasRemove((itemId) => { canvasStore.removeItem(itemId); }));
    handlers.push(onCanvasUpdate((item) => { canvasStore.patchItem(item); }));
    handlers.push(onTodosUpdate((todos, conversationId) => { todosStore.updateTodos(todos, conversationId); }));
    handlers.push(onSessionUpdate((session) => { sessionsStore.updateSession(session); }));
    handlers.push(onSummaryUpdate((newSummary) => { summary.value = newSummary; }));
    handlers.push(onConversationUpdated((conversation) => { sessionsStore.updateConversation(conversation); }));

    handlers.push(
      onConversationDeleted((conversationId, newActiveConv) => {
        sessionsStore.removeConversation(conversationId, newActiveConv, sessionId);
        if (newActiveConv) {
          sessionsStore.fetchMessages(sessionId, false);
        }
      })
    );

    handlers.push(
      onUsageUpdate((msg) => {
        if (msg.isFinal) {
          sessionsStore.finalizeUsage(msg.usage, msg.conversationId);
        } else {
          sessionsStore.updateRunningUsage(msg.usage, msg.conversationId);
        }
      })
    );

    handlers.push(
      onChangesUpdate((changeCount, hasChangesUpdate) => {
        changesFileCount.value = changeCount;
        if (typeof hasChangesUpdate === 'boolean') {
          hasChanges.value = hasChangesUpdate;
        } else {
          hasChanges.value = changeCount > 0;
        }
      })
    );

    handlers.push(
      ...registerCommandHandlers(subscription, sessionId, { sessionsStore, commandButtonsStore })
    );

    return handlers;
  }

  /**
   * Fetch remaining (non-critical) session data and set up reconnect handler.
   * @param {string} sessionId - The session ID
   * @returns {Function[]} Cleanup functions for reconnect handler
   */
  function fetchRemainingDataAndSetupReconnect(sessionId) {
    const reconnectCleanups = [];

    sessionsStore.fetchMessages(sessionId);
    sessionsStore.fetchWorkLogs(sessionId);
    canvasStore.fetchItems(sessionId);
    todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);

    api.getSessionSummary(sessionId).then((s) => {
      summary.value = s;
    }).catch(() => {
      // Ignore errors - summary may not exist yet
    });

    checkForChanges();

    const { onReconnect } = useWebSocket();
    reconnectCleanups.push(
      onReconnect(async () => {
        await sessionsStore.fetchSession(sessionId);
        await sessionsStore.fetchConversations(sessionId);
        await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
        await sessionsStore.fetchWorkLogs(sessionId);
        await canvasStore.fetchItems(sessionId);
        checkForChanges();
        // Rebuild session chain so descendant statuses are fresh (fixes stale spinner bug)
        if (onReconnectCallback) {
          await onReconnectCallback();
        }
      })
    );

    if (sessionsStore.currentSession?.projectId) {
      templatesStore.fetchProjectTemplates(sessionsStore.currentSession.projectId);
    }

    return reconnectCleanups;
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

    // STEP 2: Subscribe via the subscription object AND await connection
    await setupSessionSubscription(currentSubscription, sessionId);

    // STEP 3: Fetch critical data BEFORE registering handlers
    await fetchCriticalSessionData(sessionId);

    // STEP 4: Register all handlers
    cleanups.push(...registerSessionHandlers(currentSubscription, sessionId));

    // STEP 5: Fetch remaining data and set up reconnect
    cleanups.push(...fetchRemainingDataAndSetupReconnect(sessionId));

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
