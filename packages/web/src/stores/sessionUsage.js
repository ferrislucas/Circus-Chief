import { defineStore } from 'pinia';
import { calculateTokenTotal, formatTokenCount } from '@circuschief/shared';

/**
 * Format a token count for display
 * @param {number|null|undefined} n - Token count
 * @returns {string} Formatted string
 */
function formatNumber(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/**
 * Build a usage object by merging conversation base tokens with running usage
 * @param {Object|null} conv - Conversation object
 * @param {Object|null} runningUsage - Running usage data
 * @returns {Object} Merged usage object
 */
function mergeUsageWithRunning(conv, runningUsage) {
  return {
    inputTokens: (conv?.inputTokens || 0) + (runningUsage?.inputTokens || 0),
    outputTokens: (conv?.outputTokens || 0) + (runningUsage?.outputTokens || 0),
    thinkingTokens: (conv?.thinkingTokens || 0) + (runningUsage?.thinkingTokens || 0),
    cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (runningUsage?.cacheReadInputTokens || 0),
    cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (runningUsage?.cacheCreationInputTokens || 0),
  };
}

/**
 * Build a usage object from conversation data only
 * @param {Object} conv - Conversation object
 * @returns {Object} Usage object
 */
function convUsage(conv) {
  return {
    inputTokens: conv.inputTokens,
    outputTokens: conv.outputTokens,
    thinkingTokens: conv.thinkingTokens,
    cacheReadInputTokens: conv.cacheReadInputTokens,
    cacheCreationInputTokens: conv.cacheCreationInputTokens,
  };
}

/**
 * Check if running usage is relevant to the active conversation
 * @param {Object|null} runningUsage - Running usage data
 * @param {string|null} activeConversationId - Active conversation ID
 * @returns {boolean}
 */
function isRunningUsageRelevant(runningUsage, activeConversationId) {
  if (!runningUsage) return false;
  return !activeConversationId || runningUsage.conversationId === activeConversationId;
}

export const useSessionUsageStore = defineStore('sessionUsage', {
  state: () => ({
    runningUsage: null, // Partial usage during a turn
  }),

  getters: {
    /**
     * Whether usage is being actively updated (streaming)
     * Requires conversations and activeConversationId from sessions store
     */
    isUsageUpdating: (state) => {
      if (!state.runningUsage) return false;
      return true;
    },
  },

  actions: {
    /**
     * Update running usage during a turn (partial update)
     * @param {Object} usage - Usage data
     * @param {string} [conversationId] - Conversation ID
     */
    updateRunningUsage(usage, conversationId = null) {
      this.runningUsage = { ...usage, conversationId };
    },

    /**
     * Finalize usage at end of turn (update conversation and session with final values)
     * @param {Object} usage - Final cumulative usage
     * @param {string} [conversationId] - Conversation ID
     * @param {Array} conversations - Conversations array (from sessions store)
     * @param {Object|null} currentSession - Current session (from sessions store)
     * @param {Function} updateConversationAtIndex - Callback to update conversation in parent store
     * @param {Function} updateCurrentSession - Callback to update current session in parent store
     */
    finalizeUsage(usage, conversationId, { conversations, currentSession, updateConversationAtIndex, updateCurrentSession }) {
      // Update conversation usage if conversationId provided
      if (conversationId) {
        const index = conversations.findIndex((c) => c.id === conversationId);
        if (index !== -1) {
          updateConversationAtIndex(index, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            thinkingTokens: usage.thinkingTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            webSearchRequests: usage.webSearchRequests,
            contextWindow: usage.contextWindow,
            model: usage.model,
          });
        }
      }

      // Also update session for backward compatibility
      if (currentSession) {
        updateCurrentSession({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          thinkingTokens: usage.thinkingTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests,
          contextWindow: usage.contextWindow,
        });
      }
      this.runningUsage = null;
    },

    /**
     * Clear running usage (on session unmount)
     */
    clearRunningUsage() {
      this.runningUsage = null;
    },

    // ==================== Computed-like helpers (called from sessions store getters) ====================

    /**
     * Get conversation tokens for display
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @returns {Object|null} Token data
     */
    getConversationTokens(conversations, activeConversationId) {
      const conv = conversations.find((c) => c.id === activeConversationId);
      return conv
        ? {
            inputTokens: conv.inputTokens || 0,
            outputTokens: conv.outputTokens || 0,
            thinkingTokens: conv.thinkingTokens || 0,
            cacheReadInputTokens: conv.cacheReadInputTokens || 0,
            cacheCreationInputTokens: conv.cacheCreationInputTokens || 0,
            webSearchRequests: conv.webSearchRequests || 0,
            contextWindow: conv.contextWindow || 200000,
          }
        : null;
    },

    /**
     * Calculate total tokens
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @param {Object|null} currentSession - Current session
     * @returns {number}
     */
    getTotalTokens(conversations, activeConversationId, currentSession) {
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv) {
        return calculateTokenTotal(conv);
      }
      if (!currentSession) return 0;
      return calculateTokenTotal(currentSession);
    },

    /**
     * Get formatted tokens for display
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @returns {Object} Formatted token strings
     */
    getFormattedTokens(conversations, activeConversationId) {
      // STREAMING: During active turn, show turn usage + conversation base
      if (isRunningUsageRelevant(this.runningUsage, activeConversationId)) {
        const conv = conversations.find(c => c.id === activeConversationId);
        const merged = mergeUsageWithRunning(conv, this.runningUsage);

        return {
          input: formatNumber(merged.inputTokens),
          output: formatNumber(merged.outputTokens),
          thinking: formatNumber(merged.thinkingTokens),
          total: formatNumber(calculateTokenTotal(merged)),
          cacheRead: formatNumber(merged.cacheReadInputTokens),
          cacheCreation: formatNumber(merged.cacheCreationInputTokens),
        };
      }

      // PERSISTED: Show conversation totals
      if (activeConversationId && conversations.length > 0) {
        const conv = conversations.find((c) => c.id === activeConversationId);
        if (conv) {
          return {
            input: formatNumber(conv.inputTokens),
            output: formatNumber(conv.outputTokens),
            thinking: formatNumber(conv.thinkingTokens),
            total: formatNumber(calculateTokenTotal(conv)),
            cacheRead: formatNumber(conv.cacheReadInputTokens),
            cacheCreation: formatNumber(conv.cacheCreationInputTokens),
          };
        }
      }

      // FALLBACK
      return { input: '-', output: '-', thinking: '-', total: '-', cacheRead: '-', cacheCreation: '-' };
    },

    /**
     * Calculate context percentage
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @param {Object|null} currentSession - Current session
     * @returns {number}
     */
    getContextPercentage(conversations, activeConversationId, currentSession) {
      // STREAMING
      if (isRunningUsageRelevant(this.runningUsage, activeConversationId)) {
        const conv = conversations.find(c => c.id === activeConversationId);
        const merged = mergeUsageWithRunning(conv, this.runningUsage);
        const total = calculateTokenTotal(merged);
        const contextWindow = this.runningUsage.contextWindow || conv?.contextWindow || 200000;
        return Math.min(100, Math.round((total / contextWindow) * 100));
      }

      // PERSISTED
      const conv = conversations.find((c) => c.id === activeConversationId);
      const source = conv || currentSession;
      if (!source) return 0;

      const totalTokens = calculateTokenTotal(source);
      const contextWindow = source.contextWindow || 200000;
      return Math.min(100, Math.round((totalTokens / contextWindow) * 100));
    },

    /**
     * Check if usage is updating for a specific conversation
     * @param {string|null} activeConversationId - Active conversation ID
     * @returns {boolean}
     */
    isUsageUpdatingForConversation(activeConversationId) {
      if (!this.runningUsage) return false;
      if (activeConversationId && this.runningUsage.conversationId !== activeConversationId) {
        return false;
      }
      return true;
    },

    /**
     * Get display tokens for a specific conversation
     * @param {string} conversationId - Conversation ID
     * @param {Array} conversations - Conversations array
     * @returns {Object}
     */
    getConversationDisplayTokens(conversationId, conversations) {
      const conv = conversations.find((c) => c.id === conversationId);
      if (!conv) return { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, total: 0 };

      if (this.runningUsage && this.runningUsage.conversationId === conversationId) {
        const merged = mergeUsageWithRunning(conv, this.runningUsage);
        return {
          inputTokens: merged.inputTokens,
          outputTokens: merged.outputTokens,
          thinkingTokens: merged.thinkingTokens,
          total: calculateTokenTotal(merged),
        };
      }

      return {
        inputTokens: conv.inputTokens || 0,
        outputTokens: conv.outputTokens || 0,
        thinkingTokens: conv.thinkingTokens || 0,
        total: calculateTokenTotal(conv),
      };
    },

    /**
     * Calculate raw tokens for current active conversation
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @returns {number}
     */
    getTokenTotal(conversations, activeConversationId) {
      // STREAMING
      if (isRunningUsageRelevant(this.runningUsage, activeConversationId)) {
        const conv = conversations.find(c => c.id === activeConversationId);
        const usage = mergeUsageWithRunning(conv, this.runningUsage);
        return calculateTokenTotal(usage);
      }

      // PERSISTED
      if (activeConversationId && conversations.length > 0) {
        const conv = conversations.find(c => c.id === activeConversationId);
        if (conv) {
          return calculateTokenTotal(convUsage(conv));
        }
      }

      return 0;
    },

    /**
     * Get formatted raw token total
     * @param {Array} conversations - Conversations array
     * @param {string|null} activeConversationId - Active conversation ID
     * @returns {string}
     */
    getFormattedTokenTotal(conversations, activeConversationId) {
      // STREAMING
      if (isRunningUsageRelevant(this.runningUsage, activeConversationId)) {
        const conv = conversations.find(c => c.id === activeConversationId);
        const usage = mergeUsageWithRunning(conv, this.runningUsage);
        return formatTokenCount(calculateTokenTotal(usage));
      }

      // PERSISTED
      if (activeConversationId && conversations.length > 0) {
        const conv = conversations.find(c => c.id === activeConversationId);
        if (conv) {
          return formatTokenCount(calculateTokenTotal(convUsage(conv)));
        }
      }

      return '-';
    },

    /**
     * Calculate raw tokens for a specific conversation
     * @param {string} conversationId - Conversation ID
     * @param {Array} conversations - Conversations array
     * @returns {number}
     */
    getConversationTokenTotal(conversationId, conversations) {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return 0;

      if (this.runningUsage && this.runningUsage.conversationId === conversationId) {
        return calculateTokenTotal(mergeUsageWithRunning(conv, this.runningUsage));
      }

      return calculateTokenTotal(convUsage(conv));
    },

    /**
     * Get formatted raw tokens for a specific conversation
     * @param {string} conversationId - Conversation ID
     * @param {Array} conversations - Conversations array
     * @returns {string}
     */
    getFormattedConversationTokenTotal(conversationId, conversations) {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return '-';

      let usage;
      if (this.runningUsage && this.runningUsage.conversationId === conversationId) {
        usage = mergeUsageWithRunning(conv, this.runningUsage);
      } else {
        usage = convUsage(conv);
      }

      return formatTokenCount(calculateTokenTotal(usage));
    },
  },
});
