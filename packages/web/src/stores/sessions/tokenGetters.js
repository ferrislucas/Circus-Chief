import { calculateBillableTokens, formatTokenCount } from '@claudetools/shared';
import { useSettingsStore } from '../settings.js';

/**
 * Format a token count for display.
 */
function formatToken(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Build formatted token object from raw token counts.
 */
function buildFormattedTokens(input, output, cacheRead, cacheCreation) {
  return {
    input: formatToken(input),
    output: formatToken(output),
    total: formatToken((input || 0) + (output || 0)),
    cacheRead: formatToken(cacheRead),
    cacheCreation: formatToken(cacheCreation),
  };
}

/**
 * Check if running usage is relevant to the current conversation.
 */
function isRunningUsageRelevant(state) {
  if (!state.runningUsage) return false;
  return !state.activeConversationId || state.runningUsage.conversationId === state.activeConversationId;
}

/**
 * Token usage getters for the sessions store.
 * Each getter is a function that receives the Pinia state.
 */
export const tokenGetters = {
  conversationTokens: (state) => {
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    return conv
      ? {
          inputTokens: conv.inputTokens || 0, outputTokens: conv.outputTokens || 0,
          cacheReadInputTokens: conv.cacheReadInputTokens || 0,
          cacheCreationInputTokens: conv.cacheCreationInputTokens || 0,
          webSearchRequests: conv.webSearchRequests || 0, contextWindow: conv.contextWindow || 200000,
        }
      : null;
  },
  totalTokens: (state) => {
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    if (conv) return (conv.inputTokens || 0) + (conv.outputTokens || 0);
    if (!state.currentSession) return 0;
    return (state.currentSession.inputTokens || 0) + (state.currentSession.outputTokens || 0);
  },
  formattedTokens: (state) => {
    if (isRunningUsageRelevant(state)) {
      const conv = state.conversations.find(c => c.id === state.activeConversationId);
      const totalInput = (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
      const totalOutput = (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
      const totalCacheRead = (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0);
      const totalCacheCreation = (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0);
      return buildFormattedTokens(totalInput, totalOutput, totalCacheRead, totalCacheCreation);
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (conv) {
        return buildFormattedTokens(conv.inputTokens, conv.outputTokens, conv.cacheReadInputTokens, conv.cacheCreationInputTokens);
      }
    }
    return { input: '-', output: '-', total: '-', cacheRead: '-', cacheCreation: '-' };
  },
  contextPercentage: (state) => {
    if (state.runningUsage) {
      const isRelevant = !state.activeConversationId ||
                        state.runningUsage.conversationId === state.activeConversationId;
      if (isRelevant) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        const totalInput = (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
        const totalOutput = (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
        const total = totalInput + totalOutput;
        const contextWindow = state.runningUsage.contextWindow || conv?.contextWindow || 200000;
        return Math.min(100, Math.round((total / contextWindow) * 100));
      }
    }
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    const source = conv || state.currentSession;
    if (!source) return 0;
    const totalTokens = (source.inputTokens || 0) + (source.outputTokens || 0);
    return Math.min(100, Math.round((totalTokens / (source.contextWindow || 200000)) * 100));
  },
  isUsageUpdating: (state) => {
    if (!state.runningUsage) return false;
    if (state.activeConversationId && state.runningUsage.conversationId !== state.activeConversationId) return false;
    return true;
  },
  getConversationDisplayTokens: (state) => (conversationId) => {
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) return { inputTokens: 0, outputTokens: 0, total: 0 };
    if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
      const totalInput = (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
      const totalOutput = (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
      return { inputTokens: totalInput, outputTokens: totalOutput, total: totalInput + totalOutput };
    }
    return {
      inputTokens: conv.inputTokens || 0, outputTokens: conv.outputTokens || 0,
      total: (conv.inputTokens || 0) + (conv.outputTokens || 0),
    };
  },
  billableTokens: (state) => {
    const settingsStore = useSettingsStore();
    const weights = settingsStore.tokenCostWeights;
    if (state.runningUsage) {
      const isRelevant = !state.activeConversationId ||
                        state.runningUsage.conversationId === state.activeConversationId;
      if (isRelevant) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        return calculateBillableTokens({
          inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
          outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
          cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
          cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
        }, weights);
      }
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = state.conversations.find(c => c.id === state.activeConversationId);
      if (conv) {
        return calculateBillableTokens({
          inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
          cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
        }, weights);
      }
    }
    return 0;
  },
  formattedBillableTokens: (state) => {
    const settingsStore = useSettingsStore();
    const weights = settingsStore.tokenCostWeights;
    if (state.runningUsage) {
      const isRelevant = !state.activeConversationId ||
                        state.runningUsage.conversationId === state.activeConversationId;
      if (isRelevant) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        return formatTokenCount(calculateBillableTokens({
          inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
          outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
          cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
          cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
        }, weights));
      }
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = state.conversations.find(c => c.id === state.activeConversationId);
      if (conv) {
        return formatTokenCount(calculateBillableTokens({
          inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
          cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
        }, weights));
      }
    }
    return '-';
  },
  getConversationBillableTokens: (state) => (conversationId) => {
    const settingsStore = useSettingsStore();
    const weights = settingsStore.tokenCostWeights;
    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return 0;
    if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
      return calculateBillableTokens({
        inputTokens: (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
        outputTokens: (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
        cacheReadInputTokens: (conv.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
        cacheCreationInputTokens: (conv.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
      }, weights);
    }
    return calculateBillableTokens({
      inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
      cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
    }, weights);
  },
  getFormattedConversationBillableTokens: (state) => (conversationId) => {
    const settingsStore = useSettingsStore();
    const weights = settingsStore.tokenCostWeights;
    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return '-';
    let usage;
    if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
      usage = {
        inputTokens: (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
        outputTokens: (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
        cacheReadInputTokens: (conv.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
        cacheCreationInputTokens: (conv.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
      };
    } else {
      usage = {
        inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
        cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
      };
    }
    return formatTokenCount(calculateBillableTokens(usage, weights));
  },
  /**
   * Calculate session-level BTE for a given session (not conversation-scoped).
   * Aggregates across the session and all its descendants.
   * Returns a number (raw BTE count).
   */
  getSessionBillableTokens: (state) => (sessionId) => {
    const settingsStore = useSettingsStore();
    const weights = settingsStore.tokenCostWeights;

    const calcForSession = (session) => {
      if (!session) return 0;
      return calculateBillableTokens({
        inputTokens: session.inputTokens || 0,
        outputTokens: session.outputTokens || 0,
        cacheReadInputTokens: session.cacheReadInputTokens || 0,
        cacheCreationInputTokens: session.cacheCreationInputTokens || 0,
      }, weights);
    };

    const session = state.sessions.find(s => s.id === sessionId)
      || (state.currentSession?.id === sessionId ? state.currentSession : null);
    if (!session) return 0;

    let total = calcForSession(session);

    // Aggregate descendants
    const stack = [sessionId];
    const visited = new Set();
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const children = state.sessions.filter(s => s.parentSessionId === currentId);
      for (const child of children) {
        total += calcForSession(child);
        stack.push(child.id);
      }
    }

    return total;
  },
};
