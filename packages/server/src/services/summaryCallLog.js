/**
 * summaryCallLog.js — shared agent-call logging for summary model dispatches.
 *
 * Extracted from summaryModelClient.js so the dispatcher stays within its
 * size budget. Every summary route (Anthropic, OpenAI/codex-cli, Google,
 * muse-cli) opens its call through {@link startOpenAISummaryLog} and reports
 * token usage through {@link logOpenAIUsage}; the shapes below are the
 * summary-specific projection of the generic agent-call log.
 */

import { agentCallLogger } from './agentCallLogger.js';

export function startOpenAISummaryLog(logMeta, resolution, promptLength, route = 'direct-api') {
  if (!logMeta) return null;
  return agentCallLogger.startCall({
    sessionId: logMeta.sessionId,
    conversationId: logMeta.conversationId || null,
    agentType: 'summary',
    model: resolution.model,
    callType: logMeta.callType,
    promptLength,
    metadata: {
      ...(resolution.providerId ? { providerId: resolution.providerId } : {}),
      ...(resolution.selectionReason ? { selectionReason: resolution.selectionReason } : {}),
      route,
    },
  });
}

export function logOpenAIUsage(callId, usage) {
  if (!callId || !usage) return;
  agentCallLogger.updateUsage(callId, {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
}
