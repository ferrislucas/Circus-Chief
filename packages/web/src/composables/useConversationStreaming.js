import { ref, onMounted, onUnmounted } from 'vue';
import { useSessionSubscription } from './useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';

const PARTIAL_THROTTLE_MS = 150; // Throttle streaming updates to reduce CPU load on iPad

/**
 * Composable for managing WebSocket streaming subscriptions for a conversation.
 * Handles partial text streaming, work logs, thinking, and conversation events.
 *
 * @param {string} sessionId - The session ID to subscribe to
 * @param {Object} options
 * @param {Function} options.scrollToBottom - Callback to scroll to bottom on new content
 * @returns {Object} Streaming state and lifecycle
 */
export function useConversationStreaming(sessionId, { scrollToBottom }) {
  const sessionsStore = useSessionsStore();

  const partialText = ref('');
  let partialThrottleTimer = null;
  let pendingPartialText = null;

  // Subscribe to partial messages for streaming, work logs, and conversation events
  const {
    onPartial,
    onMessage,
    onWorkLog,
    onWorkLogsAssociated,
    onThinkingPartial,
    onConversationCreated,
    onConversationUpdated,
    onConversationDeleted,
  } = useSessionSubscription(sessionId);

  let unsubPartial = null;
  let unsubMessage = null;
  let unsubWorkLog = null;
  let unsubWorkLogsAssociated = null;
  let unsubThinkingPartial = null;
  let unsubConvCreated = null;
  let unsubConvUpdated = null;
  let unsubConvDeleted = null;

  /**
   * Clear streaming state. Call this when switching conversations
   * or when the session status changes from running.
   */
  function clearStreamingState() {
    partialText.value = '';
    if (partialThrottleTimer) {
      clearTimeout(partialThrottleTimer);
      partialThrottleTimer = null;
    }
    pendingPartialText = null;
  }

  function setupSubscriptions() {
    // Throttle partial text updates to reduce CPU load on iPad
    // Without throttling, rapid updates cause excessive re-renders and markdown parsing
    unsubPartial = onPartial((text) => {
      pendingPartialText = text;

      // If no throttle timer is running, update immediately and start timer
      if (!partialThrottleTimer) {
        partialText.value = text;
        scrollToBottom();

        partialThrottleTimer = setTimeout(() => {
          // Apply any pending update that arrived during throttle period
          if (pendingPartialText !== null && pendingPartialText !== partialText.value) {
            partialText.value = pendingPartialText;
            scrollToBottom();
          }
          partialThrottleTimer = null;
          pendingPartialText = null;
        }, PARTIAL_THROTTLE_MS);
      }
    });

    // Clear partial text when full message arrives
    unsubMessage = onMessage(() => {
      partialText.value = '';
    });

    // Subscribe to work log updates
    unsubWorkLog = onWorkLog((log) => {
      sessionsStore.addWorkLog(log);
    });

    // Subscribe to work log association events (re-associate _unassociated logs)
    unsubWorkLogsAssociated = onWorkLogsAssociated((messageId) => {
      sessionsStore.associateWorkLogs(messageId);
    });

    // Subscribe to partial thinking updates for streaming display
    unsubThinkingPartial = onThinkingPartial((thinking) => {
      if (thinking === null) {
        sessionsStore.clearPartialThinking(sessionId);
      } else {
        sessionsStore.setPartialThinking(thinking, sessionId);
      }
    });

    // Subscribe to conversation events for real-time updates
    unsubConvCreated = onConversationCreated((conversation) => {
      console.log(`[CONV] CONVERSATION_CREATED event: conversation ${conversation.id}, isActive: ${conversation.isActive}`);
      sessionsStore.addConversation(conversation);
    });

    unsubConvUpdated = onConversationUpdated((conversation) => {
      console.log(`[CONV] CONVERSATION_UPDATED event: conversation ${conversation.id}, isActive: ${conversation.isActive}`);
      sessionsStore.updateConversation(conversation);
    });

    unsubConvDeleted = onConversationDeleted((conversationId, newActiveConv) => {
      console.log(`[CONV] CONVERSATION_DELETED event: deleted ${conversationId}, newActive: ${newActiveConv?.id || 'none'}`);
      sessionsStore.removeConversation(conversationId, newActiveConv);
      // If we have a new active conversation, fetch its messages
      if (newActiveConv) {
        console.log(`[CONV] CONVERSATION_DELETED: fetching messages for new active conversation ${newActiveConv.id}`);
        sessionsStore.fetchMessages(sessionId, false);
      }
    });
  }

  function teardownSubscriptions() {
    if (unsubPartial) unsubPartial();
    if (unsubMessage) unsubMessage();
    if (unsubWorkLog) unsubWorkLog();
    if (unsubWorkLogsAssociated) unsubWorkLogsAssociated();
    if (unsubThinkingPartial) unsubThinkingPartial();
    if (unsubConvCreated) unsubConvCreated();
    if (unsubConvUpdated) unsubConvUpdated();
    if (unsubConvDeleted) unsubConvDeleted();
    if (partialThrottleTimer) clearTimeout(partialThrottleTimer);
  }

  return {
    partialText,
    clearStreamingState,
    setupSubscriptions,
    teardownSubscriptions,
  };
}
