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
 * Register core session event handlers (status, messages, partials, thinking, errors).
 */
function registerCoreHandlers(subscription, sessionId, stores, polling) {
  const { sessionsStore, canvasStore, uiStore } = stores;
  const { startPolling, stopPolling, checkForChanges } = polling;
  const cleanups = [];

  cleanups.push(
    subscription.onStatus((status) => {
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
    subscription.onMessage((message) => {
      sessionsStore.addMessage(message);
      sessionsStore.clearPartialText();
    })
  );

  cleanups.push(
    subscription.onPartial((text) => {
      sessionsStore.setPartialText(text);
    })
  );

  cleanups.push(
    subscription.onWorkLog((log) => {
      sessionsStore.addWorkLog(log);
    })
  );

  cleanups.push(
    subscription.onWorkLogsAssociated((messageId) => {
      sessionsStore.associateWorkLogs(messageId);
    })
  );

  cleanups.push(
    subscription.onThinkingPartial((thinking) => {
      if (thinking === null) {
        sessionsStore.clearPartialThinking(sessionId);
      } else {
        sessionsStore.setPartialThinking(thinking, sessionId);
      }
    })
  );

  cleanups.push(
    subscription.onError((error) => {
      uiStore.error(error);
    })
  );

  return cleanups;
}

/**
 * Register canvas, todos, conversation, and session update handlers.
 */
function registerDataHandlers(subscription, sessionId, stores, stateRefs) {
  const { sessionsStore, canvasStore, todosStore } = stores;
  const { summary, hasChanges, changesFileCount } = stateRefs;
  const cleanups = [];

  cleanups.push(
    subscription.onConversationCreated((conversation) => {
      sessionsStore.addConversation(conversation);
    })
  );

  cleanups.push(
    subscription.onCanvasAdd((item) => {
      canvasStore.addItem(item);
    })
  );

  cleanups.push(
    subscription.onCanvasRemove((itemId) => {
      canvasStore.removeItem(itemId);
    })
  );

  cleanups.push(
    subscription.onTodosUpdate((todos, conversationId) => {
      todosStore.updateTodos(todos, conversationId);
    })
  );

  cleanups.push(
    subscription.onSessionUpdate((session) => {
      sessionsStore.updateSession(session);
    })
  );

  cleanups.push(
    subscription.onSummaryUpdate((newSummary) => {
      summary.value = newSummary;
    })
  );

  cleanups.push(
    subscription.onConversationUpdated((conversation) => {
      sessionsStore.updateConversation(conversation);
    })
  );

  cleanups.push(
    subscription.onConversationDeleted((conversationId, newActiveConv) => {
      sessionsStore.removeConversation(conversationId, newActiveConv, sessionId);
      if (newActiveConv) {
        sessionsStore.fetchMessages(sessionId, false);
      }
    })
  );

  cleanups.push(
    subscription.onUsageUpdate((msg) => {
      if (msg.isFinal) {
        sessionsStore.finalizeUsage(msg.usage, msg.conversationId);
      } else {
        sessionsStore.updateRunningUsage(msg.usage, msg.conversationId);
      }
    })
  );

  cleanups.push(
    subscription.onChangesUpdate((changeCount, hasChangesUpdate) => {
      changesFileCount.value = changeCount;
      if (typeof hasChangesUpdate === 'boolean') {
        hasChanges.value = hasChangesUpdate;
      } else {
        hasChanges.value = changeCount > 0;
      }
    })
  );

  return cleanups;
}

/**
 * Register command run event handlers for session detail view.
 */
function registerCommandHandlers(subscription, sessionId, sessionsStore, commandButtonsStore) {
  const cleanups = [];

  cleanups.push(
    subscription.onCommandOutput((runId, buttonId, output) => {
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
    subscription.onCommandComplete((runId, buttonId, exitCode, output) => {
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
    subscription.onCommandError((runId, buttonId, error) => {
      sessionsStore.updateSessionCommandRun(sessionId, buttonId, {
        buttonId,
        status: 'error',
        runId,
        completedAt: Date.now(),
      });
    })
  );

  cleanups.push(
    subscription.onCommandRunDeleted(async (runId, buttonId) => {
      console.log('[onCommandRunDeleted] Run deleted:', runId, 'for button:', buttonId);
      commandButtonsStore.clearRun(runId);

      // Refetch the session to get the updated latestCommandRuns array
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

  return cleanups;
}

/**
 * Fetch remaining session data after handlers are registered.
 */
async function fetchRemainingData(sessionId, stores, stateRefs, checkForChanges) {
  const { sessionsStore, canvasStore, todosStore, templatesStore } = stores;
  const { summary } = stateRefs;

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

  // Fetch templates for the selector
  if (sessionsStore.currentSession?.projectId) {
    templatesStore.fetchProjectTemplates(sessionsStore.currentSession.projectId);
  }
}

/**
 * Reset all session-related stores and state.
 * @param {Object} ctx - Context { stores, stateRefs, cleanupsList, subscriptionRef, resetPolling }
 */
function resetSessionState({ stores, stateRefs, cleanupsList, subscriptionRef, resetPolling }) {
  resetPolling();
  if (subscriptionRef.current) {
    subscriptionRef.current.unsubscribe();
    subscriptionRef.current = null;
  }
  cleanupsList.forEach((c) => c());
  cleanupsList.length = 0;

  const { sessionsStore, canvasStore, todosStore } = stores;
  sessionsStore.clearRunningUsage();
  sessionsStore.messages = [];
  sessionsStore.conversations = [];
  sessionsStore.workLogs = {};
  sessionsStore.clearPartialText();
  todosStore.clearTodos();
  canvasStore.items = [];
  stateRefs.summary.value = null;
  canvasStore.$reset();
}

/**
 * Register a reconnect handler that re-fetches all critical data.
 */
function setupReconnectHandler(sessionId, stores, checkForChanges) {
  const { sessionsStore, canvasStore } = stores;
  const { onReconnect } = useWebSocket();

  return onReconnect(async () => {
    await sessionsStore.fetchSession(sessionId);
    await sessionsStore.fetchConversations(sessionId);
    await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
    await sessionsStore.fetchWorkLogs(sessionId);
    await canvasStore.fetchItems(sessionId);
    checkForChanges();
  });
}

/**
 * Composable for initializing and managing WebSocket subscriptions and data
 * fetching for a session.
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

  const subscriptionRef = { current: null };
  const cleanups = [];

  const stores = { sessionsStore, canvasStore, todosStore, uiStore, commandButtonsStore, templatesStore };
  const stateRefs = { summary, hasChanges, changesFileCount };
  const polling = { startPolling, stopPolling, checkForChanges };

  function cleanup() {
    resetSessionState({ stores, stateRefs, cleanupsList: cleanups, subscriptionRef, resetPolling });
  }

  async function initializeSession(sessionId) {
    subscriptionRef.current = useSessionSubscription(sessionId);
    const subscription = subscriptionRef.current;

    subscription.subscribe();
    try {
      await ensureSubscribed(sessionId);
    } catch (error) {
      console.error('Failed to subscribe to session updates:', error);
      uiStore.error('Failed to subscribe to session updates');
    }

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

    cleanups.push(...registerCoreHandlers(subscription, sessionId, stores, polling));
    cleanups.push(...registerDataHandlers(subscription, sessionId, stores, stateRefs));
    cleanups.push(...registerCommandHandlers(subscription, sessionId, sessionsStore, commandButtonsStore));

    await fetchRemainingData(sessionId, stores, stateRefs, checkForChanges);
    cleanups.push(setupReconnectHandler(sessionId, stores, checkForChanges));

    const status = sessionsStore.currentSession?.status;
    if (status === 'running' || status === 'starting') {
      startPolling();
    }
  }

  return { cleanup, initializeSession };
}
