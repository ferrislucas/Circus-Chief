/**
 * summaryCallLog.js — shared agent-call logging for summary model dispatches.
 *
 * Extracted from summaryModelClient.js so the dispatcher stays within its
 * size budget. Every summary route (Anthropic, OpenAI/codex-cli, Google,
 * muse-cli, grok-cli) opens its call through {@link startOpenAISummaryLog}
 * and reports token usage through {@link logOpenAIUsage}. The CLI runners
 * below are the same extraction: one logged invocation per process route.
 */

import { agentCallLogger } from './agentCallLogger.js';
import { SESSION_SUMMARY_SCHEMA } from './summaryClaudeClient.js';
import { callCodexSummary } from './summaryCodexClient.js';
import { callMuseSummary } from './summaryMuseClient.js';
import { callGrokSummary } from './summaryGrokClient.js';

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

async function callLoggedCliSummary({ prompt, resolution, options, route, run }) {
  const callId = startOpenAISummaryLog(options.logMeta, resolution, prompt.length, route);
  try {
    const result = await run();
    if (callId) agentCallLogger.completeCall(callId, { success: true });
    return result;
  } catch (error) {
    if (callId) agentCallLogger.completeCall(callId, { success: false, error });
    throw error;
  }
}

function workspaceSummaryInput(prompt, resolution, options) {
  return {
    prompt,
    systemPrompt: options.systemPrompt,
    model: resolution.model,
    jsonSchema: options.jsonSchema || SESSION_SUMMARY_SCHEMA,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
  };
}

export function callBuiltInCodexSummary(prompt, resolution, options) {
  return callLoggedCliSummary({
    prompt, resolution, options, route: 'codex-cli',
    run: () => callCodexSummary({
      prompt,
      systemPrompt: options.systemPrompt,
      model: resolution.model,
      jsonSchema: options.jsonSchema || SESSION_SUMMARY_SCHEMA,
    }, options.codexDependencies),
  });
}

export function callGrokSummaryModel(prompt, resolution, options) {
  return callLoggedCliSummary({
    prompt, resolution, options, route: 'grok-cli',
    run: () => callGrokSummary(workspaceSummaryInput(prompt, resolution, options), options.grokDependencies),
  });
}

export function callMuseSummaryModel(prompt, resolution, options) {
  return callLoggedCliSummary({
    prompt, resolution, options, route: 'muse-cli',
    run: () => callMuseSummary(workspaceSummaryInput(prompt, resolution, options), options.museDependencies),
  });
}
