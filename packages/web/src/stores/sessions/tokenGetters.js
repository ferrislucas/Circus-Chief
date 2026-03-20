import { calculateBillableTokens, formatTokenCount } from '@claudetools/shared';
import { useSettingsStore } from '../settings.js';

/**
 * Format a token count for display.
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatCount(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Check if runningUsage is relevant to the active conversation.
 */
function isRunningUsageRelevant(state) {
  return state.runningUsage && (
    !state.activeConversationId ||
    state.runningUsage.conversationId === state.activeConversationId
  );
}

/**
 * Build a formatted tokens object from raw token values.
 */
function buildFormattedTokens(input, output, cacheRead, cacheCreation) {
  return {
    input: formatCount(input),
    output: formatCount(output),
    total: formatCount((input || 0) + (output || 0)),
    cacheRead: formatCount(cacheRead),
    cacheCreation: formatCount(cacheCreation),
  };
}

const EMPTY_FORMATTED_TOKENS = { input: '-', output: '-', total: '-', cacheRead: '-', cacheCreation: '-' };

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
      return buildFormattedTokens(
        (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
        (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
        (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
        (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
      );
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (conv) {
        return buildFormattedTokens(conv.inputTokens, conv.outputTokens, conv.cacheReadInputTokens, conv.cacheCreationInputTokens);
      }
    }
    return EMPTY_FORMATTED_TOKENS;
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
};
