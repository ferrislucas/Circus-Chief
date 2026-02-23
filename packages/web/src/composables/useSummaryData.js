import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from './useApi.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from './useWebSocket.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

/**
 * Composable for session summary data fetching, state management,
 * WebSocket subscriptions, and formatting utilities.
 *
 * @param {string} sessionId - The session ID
 * @returns {Object} Summary state, actions, and formatting helpers
 */
export function useSummaryData(sessionId) {
  const uiStore = useUiStore();
  const sessionsStore = useSessionsStore();
  const commandButtonsStore = useCommandButtonsStore();
  const { onSummaryUpdate, onSummaryGenerating } = useSessionSubscription(sessionId);

  const summary = ref(null);
  const childSessionSummaries = ref({});
  const loading = ref(false);
  const generating = ref(false);
  const generatingManual = ref(false);
  const loadingConversations = ref(false);
  const conversations = ref([]);

  // Computed properties
  const session = computed(() => sessionsStore.sessions.find((s) => s.id === sessionId));
  const prUrl = computed(() => session.value?.prUrl || null);
  const hasPrInfo = computed(() => prUrl.value && summary.value?.prState);

  const childSessions = computed(() => {
    return sessionsStore.getChildSessions(sessionId);
  });

  const commandButtons = computed(() => {
    const projectId = session.value?.projectId;
    if (!projectId) return [];
    return commandButtonsStore.getButtonsByProjectId(projectId);
  });

  const totalMessages = computed(() => {
    return conversations.value.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);
  });

  // Helper functions
  function getConversationNumber(convId) {
    const index = conversations.value.findIndex((c) => c.id === convId);
    return index + 1;
  }

  async function fetchChildSummaries() {
    const children = sessionsStore.getChildSessions(sessionId);
    for (const child of children) {
      if (!childSessionSummaries.value[child.id]) {
        try {
          const summaryData = await api.getSessionSummary(child.id);
          childSessionSummaries.value[child.id] = summaryData;
        } catch (e) {
          // Ignore - summary may not exist
        }
      }
    }
  }

  // Formatting helpers
  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatOutcome(outcome) {
    const labels = {
      completed: 'Task Completed Successfully',
      partial: 'Partial Progress',
      failed: 'Task Failed',
      ongoing: 'In Progress',
    };
    return labels[outcome] || outcome;
  }

  function formatPrState(state) {
    const labels = {
      merged: 'Merged',
      open: 'Open',
      closed: 'Closed',
      draft: 'Draft',
    };
    return labels[state] || state;
  }

  function extractPrNumber(url) {
    if (!url) return 'PR';
    const match = url.match(/\/pull\/(\d+)/);
    return match ? `PR #${match[1]}` : 'PR';
  }

  // Actions
  async function handleRegenerate() {
    generatingManual.value = true;
    try {
      summary.value = await api.generateSessionSummary(sessionId);
      uiStore.success('Summary regenerated');
    } catch (err) {
      uiStore.error(err.message);
    } finally {
      generatingManual.value = false;
    }
  }

  // Lifecycle
  onMounted(async () => {
    // Fetch conversations
    loadingConversations.value = true;
    try {
      conversations.value = await api.getConversations(sessionId);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      loadingConversations.value = false;
    }

    // Fetch summaries for child sessions (don't await - not critical path)
    fetchChildSummaries();

    // Fetch session summary
    loading.value = true;
    try {
      summary.value = await api.getSessionSummary(sessionId);
    } catch (err) {
      // Don't show error for missing summary
      if (!err.message.includes('404')) {
        uiStore.error(err.message);
      }
    } finally {
      loading.value = false;
    }

    // Listen for WebSocket updates
    onSummaryUpdate((newSummary) => {
      summary.value = newSummary;
      generatingManual.value = false;
    });

    onSummaryGenerating((isGenerating) => {
      generating.value = isGenerating;
    });
  });

  onUnmounted(() => {
    // Clean up if needed
  });

  return {
    // State
    summary,
    childSessionSummaries,
    loading,
    generating,
    generatingManual,
    loadingConversations,
    conversations,
    // Computed
    session,
    prUrl,
    hasPrInfo,
    childSessions,
    commandButtons,
    totalMessages,
    // Helpers
    getConversationNumber,
    formatDate,
    formatOutcome,
    formatPrState,
    extractPrNumber,
    // Actions
    handleRegenerate,
  };
}
