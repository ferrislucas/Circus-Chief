import { ref } from 'vue';
import { useSessionSubscription, ensureSubscribed, useWebSocket } from './useWebSocket.js';
import { registerCommandHandlers } from './sessionCommandHandlers.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useSessionPromptsStore } from '../stores/sessionPrompts.js';
import { debugSessionStatus } from '../stores/sessions/statusOrdering.js';
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
 * @param {Function} [options.refreshGitStatus] - Optional git status refresh hook
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
  refreshGitStatus,
  onReconnectCallback,
}) {
  const summary = summaryRef;
  const hasChanges = hasChangesRef;
  const changesFileCount = changesFileCountRef;
  const sessionsStore = useSessionsStore();
  const promptsStore = useSessionPromptsStore();
  const canvasStore = useCanvasStore();
  const todosStore = useTodosStore();
  const uiStore = useUiStore();
  const commandButtonsStore = useCommandButtonsStore();
  const templatesStore = useTemplatesStore();

  // Track current subscription instance - recreated on session change
  let currentSubscription = null;
  let currentSessionId = null;
  let cleanups = [];

  /**
   * Cleanup function - called on unmount AND on route change (session navigation).
   * Ensures WebSocket subscriptions don't leak between sessions.
   */
  function cleanup() {
    // Reset polling state via composable
    resetPolling();
    const sessionId = currentSessionId;
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
    promptsStore.clear(sessionId);
    todosStore.clearTodos();
    canvasStore.items = [];
    // Reset local state
    summary.value = null;
    canvasStore.$reset();
    currentSessionId = null;
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
   * Sync polling with the authoritative snapshot's status. Idempotent:
   * `startPolling`/`stopPolling` in useSessionPolling are both no-ops when
   * already in the requested state.
   * @param {string} sessionId - The session ID
   */
  function syncPollingWithSessionStatus(sessionId) {
    const session = sessionsStore.currentSession?.id === sessionId ? sessionsStore.currentSession : null;
    const status = session?.status;
    if (status === 'running' || status === 'starting') {
      startPolling();
    } else {
      stopPolling();
    }
  }

  /**
   * Reconcile the selected session with an authoritative snapshot (FR-4).
   * Fetches the session and its conversations for the still-current session
   * ID, guarding after every await so a late response can never mutate a
   * newly selected session's state. Restores an active display (and polling)
   * when realtime frames were missed while disconnected or not yet
   * subscribed, and ends it when the snapshot reports terminal/idle.
   *
   * @param {string} sessionId - The session ID to reconcile
   */
  async function reconcileSessionSnapshot(sessionId) {
    if (currentSessionId !== sessionId) return;
    try {
      await sessionsStore.fetchSession(sessionId);
      if (currentSessionId !== sessionId) return;
      await sessionsStore.fetchConversations(sessionId);
      if (currentSessionId !== sessionId) return;
      // Development diagnostic: the authoritative snapshot's status for the
      // selected session, with the store's client ordering generation.
      const session = sessionsStore.currentSession?.id === sessionId ? sessionsStore.currentSession : null;
      debugSessionStatus('snapshot', sessionId, session?.status ?? 'unknown', sessionsStore._statusGeneration?.(sessionId) ?? 0);
      syncPollingWithSessionStatus(sessionId);
    } catch (error) {
      console.debug(`[session-status] snapshot reconciliation failed for session=${sessionId}:`, error);
    }
  }

  /**
   * Fetch command buttons for the session's project once the snapshot has
   * provided a projectId.
   */
  async function fetchCommandButtonsForSession() {
    const projectId = sessionsStore.currentSession?.projectId;
    if (!projectId) return;
    try {
      await commandButtonsStore.fetchButtons(projectId);
    } catch (error) {
      console.debug('Failed to fetch command buttons:', error);
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
      onPrompt, onPromptResolved,
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
            Promise.resolve(checkForChanges()).then(() => {
              if (refreshGitStatus) refreshGitStatus({ fetch: false });
            });
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
    handlers.push(onPrompt((prompt) => { promptsStore.show(prompt); }));
    handlers.push(onPromptResolved((promptId, promptSessionId) => { promptsStore.resolved(promptId, promptSessionId); }));
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
        if (refreshGitStatus) refreshGitStatus({ fetch: false });
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

    Promise.resolve(checkForChanges()).then(() => {
      if (refreshGitStatus) refreshGitStatus({ fetch: false });
    });

    const { onReconnect } = useWebSocket();
    reconnectCleanups.push(
      onReconnect(async () => {
        // Reconcile with the authoritative snapshot first: realtime frames
        // emitted while disconnected were dropped by the server, so this
        // fetch restores the true status (and polling) after a reconnect.
        await reconcileSessionSnapshot(sessionId);
        await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
        await sessionsStore.fetchWorkLogs(sessionId);
        await canvasStore.fetchItems(sessionId);
        try {
          await promptsStore.hydrate(sessionId);
        } catch (error) {
          console.debug('Failed to refresh pending agent prompt:', error);
        }
        await checkForChanges();
        if (refreshGitStatus) {
          refreshGitStatus({ fetch: false });
        }
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
   * Ordering (FR-3): all session-scoped handlers are registered BEFORE the
   * subscription is opened, so a status/message frame delivered immediately
   * after subscription has a consumer and cannot be lost. The authoritative
   * snapshot is fetched after subscription (FR-4) — it reconciles anything
   * missed before the client was listening, and cannot regress a lifecycle
   * event the client already processed (see statusOrdering.js).
   *
   * @param {string} sessionId - The session ID to initialize
   */
  async function initializeSession(sessionId) {
    // STEP 1: Create new subscription for this session
    currentSessionId = sessionId;
    currentSubscription = useSessionSubscription(sessionId);

    // STEP 2: Register all handlers BEFORE subscribing. Every handler cleanup
    // is pushed onto `cleanups` here, before any event can possibly be
    // received; `cleanup()` removes them on navigation/unmount.
    cleanups.push(...registerSessionHandlers(currentSubscription, sessionId));

    // STEP 3: Subscribe via the subscription object AND await connection
    await setupSessionSubscription(currentSubscription, sessionId);

    // STEP 4: Reconcile with the authoritative snapshot (FR-4). If the route
    // changed while subscribing, bail without touching the new session.
    await reconcileSessionSnapshot(sessionId);
    if (currentSessionId !== sessionId) return;

    // STEP 5: Fetch remaining critical data (command buttons — needs the
    // projectId the snapshot just provided).
    await fetchCommandButtonsForSession();

    // STEP 6: Fetch remaining data and set up reconnect
    cleanups.push(...fetchRemainingDataAndSetupReconnect(sessionId));
  }

  return {
    cleanup,
    initializeSession,
  };
}
