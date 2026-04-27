import { calculateTokenTotal, formatTokenCount } from '@circuschief/shared';

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
function buildFormattedTokens(input, output, thinking, cacheRead, cacheCreation) {
  const usage = {
    inputTokens: input,
    outputTokens: output,
    thinkingTokens: thinking,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreation,
  };
  return {
    input: formatToken(input),
    output: formatToken(output),
    thinking: formatToken(thinking),
    total: formatToken(calculateTokenTotal(usage)),
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
 * Find the active conversation from state.
 */
function findActiveConversation(state) {
  return state.conversations.find(c => c.id === state.activeConversationId);
}

/**
 * Merge conversation tokens with running usage into a single usage object.
 */
function mergeConvAndRunningUsage(conv, runningUsage) {
  return {
    inputTokens: (conv?.inputTokens || 0) + (runningUsage.inputTokens || 0),
    outputTokens: (conv?.outputTokens || 0) + (runningUsage.outputTokens || 0),
    thinkingTokens: (conv?.thinkingTokens || 0) + (runningUsage.thinkingTokens || 0),
    cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (runningUsage.cacheReadInputTokens || 0),
    cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (runningUsage.cacheCreationInputTokens || 0),
  };
}

/**
 * Get usage from a conversation record (no running usage merge).
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
 * Token usage getters for the sessions store.
 * Each getter is a function that receives the Pinia state.
 */
export const tokenGetters = {
  conversationTokens: (state) => {
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    return conv
      ? {
          inputTokens: conv.inputTokens || 0, outputTokens: conv.outputTokens || 0,
          thinkingTokens: conv.thinkingTokens || 0,
          cacheReadInputTokens: conv.cacheReadInputTokens || 0,
          cacheCreationInputTokens: conv.cacheCreationInputTokens || 0,
          webSearchRequests: conv.webSearchRequests || 0, contextWindow: conv.contextWindow || 200000,
        }
      : null;
  },
  totalTokens: (state) => {
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    if (conv) return calculateTokenTotal(conv);
    if (!state.currentSession) return 0;
    return calculateTokenTotal(state.currentSession);
  },
  formattedTokens: (state) => {
    if (isRunningUsageRelevant(state)) {
      const merged = mergeConvAndRunningUsage(findActiveConversation(state), state.runningUsage);
      return buildFormattedTokens(merged.inputTokens, merged.outputTokens, merged.thinkingTokens, merged.cacheReadInputTokens, merged.cacheCreationInputTokens);
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = findActiveConversation(state);
      if (conv) {
        return buildFormattedTokens(conv.inputTokens, conv.outputTokens, conv.thinkingTokens, conv.cacheReadInputTokens, conv.cacheCreationInputTokens);
      }
    }
    return { input: '-', output: '-', thinking: '-', total: '-', cacheRead: '-', cacheCreation: '-' };
  },
  contextPercentage: (state) => {
    if (isRunningUsageRelevant(state)) {
      const conv = findActiveConversation(state);
      const merged = mergeConvAndRunningUsage(conv, state.runningUsage);
      const total = calculateTokenTotal(merged);
      const contextWindow = state.runningUsage.contextWindow || conv?.contextWindow || 200000;
      return Math.min(100, Math.round((total / contextWindow) * 100));
    }
    const conv = findActiveConversation(state);
    const source = conv || state.currentSession;
    if (!source) return 0;
    const totalTokens = calculateTokenTotal(source);
    return Math.min(100, Math.round((totalTokens / (source.contextWindow || 200000)) * 100));
  },
  isUsageUpdating: (state) => {
    if (!state.runningUsage) return false;
    if (state.activeConversationId && state.runningUsage.conversationId !== state.activeConversationId) return false;
    return true;
  },
  getConversationDisplayTokens: (state) => (conversationId) => {
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) return { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, total: 0 };
    if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
      const usage = mergeConvAndRunningUsage(conv, state.runningUsage);
      return { ...usage, total: calculateTokenTotal(usage) };
    }
    return {
      inputTokens: conv.inputTokens || 0,
      outputTokens: conv.outputTokens || 0,
      thinkingTokens: conv.thinkingTokens || 0,
      total: calculateTokenTotal(conv),
    };
  },
  tokenTotal: (state) => {
    if (isRunningUsageRelevant(state)) {
      return calculateTokenTotal(mergeConvAndRunningUsage(findActiveConversation(state), state.runningUsage));
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = findActiveConversation(state);
      if (conv) return calculateTokenTotal(convUsage(conv));
    }
    return 0;
  },
  formattedTokenTotal: (state) => {
    if (isRunningUsageRelevant(state)) {
      return formatTokenCount(calculateTokenTotal(mergeConvAndRunningUsage(findActiveConversation(state), state.runningUsage)));
    }
    if (state.activeConversationId && state.conversations.length > 0) {
      const conv = findActiveConversation(state);
      if (conv) return formatTokenCount(calculateTokenTotal(convUsage(conv)));
    }
    return '-';
  },
  getConversationTokenTotal: (state) => (conversationId) => {
    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return 0;
    if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
      return calculateTokenTotal(mergeConvAndRunningUsage(conv, state.runningUsage));
    }
    return calculateTokenTotal(convUsage(conv));
  },
  getFormattedConversationTokenTotal: (state) => (conversationId) => {
    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return '-';
    const usage = state.runningUsage && state.runningUsage.conversationId === conversationId
      ? mergeConvAndRunningUsage(conv, state.runningUsage)
      : convUsage(conv);
    return formatTokenCount(calculateTokenTotal(usage));
  },
  /**
   * Calculate session-level raw tokens for a given session (not conversation-scoped).
   * Aggregates across the session and all its descendants.
   */
  getSessionTokenTotal: (state) => (sessionId) => {
    const calcForSession = (session) => {
      if (!session) return 0;
      return calculateTokenTotal(session);
    };

    // Look up the session — check both the sessions array and currentSession
    const session = state.sessions.find(s => s.id === sessionId)
      || (state.currentSession?.id === sessionId ? state.currentSession : null);
    if (!session) return 0;

    let total = calcForSession(session);

    // Aggregate descendants (reuse same traversal pattern as getAllDescendants)
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
  getFormattedSessionTokenTotal: (state) => (sessionId) => (
    formatTokenCount(tokenGetters.getSessionTokenTotal(state)(sessionId))
  ),
};
