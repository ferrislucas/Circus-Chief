import OpenAI from 'openai';
import { callClaude, SESSION_SUMMARY_SCHEMA } from './summaryClaudeClient.js';
import { agentCallLogger } from './agentCallLogger.js';
import { buildProviderEnv } from './sessionProvider.js';
import {
  BUILT_IN_OPENAI_PROVIDER_ID,
  resolveSummaryModel,
  resolveExplicitSummaryModel,
  SUPPORTED_SUMMARY_PROVIDER_KINDS,
} from './summaryModelResolver.js';
import { callCodexSummary } from './summaryCodexClient.js';
import { getTierMembersResolved, markUnhealthy, isUnhealthy } from './tierResolutionService.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import { modelProviders } from '../database.js';

export { SESSION_SUMMARY_SCHEMA };

// Sentinel returned internally by the tier-traversal loop when nothing was
// eligible to attempt (empty tier, every member cooled down, or every member
// an unsupported provider kind) — the caller falls through to the default
// summary-model selection (Fix 9 graceful degradation). Never observable
// outside this module.
const TIER_FALLTHROUGH = Symbol('summary-tier-fallthrough');

export async function callSummaryModel(prompt, recentMessages, sessionStatus, options = {}) {
  // An explicit pre-resolved model is always an override — bypass tier
  // traversal entirely, unchanged from the prior single-shot behavior.
  if (options.resolvedModel) {
    return dispatchSummaryResolution(options.resolvedModel, { prompt, recentMessages, sessionStatus, options });
  }

  const summarySettings = options.summarySettings || {};
  const summaryModelField = summarySettings.summaryModel || '';

  if (isTierRef(summaryModelField)) {
    const result = await callSummaryModelWithTierFailover(summaryModelField, {
      prompt,
      recentMessages,
      sessionStatus,
      options,
    });
    if (result !== TIER_FALLTHROUGH) return result;
    // Nothing was eligible to attempt — fall through to the default
    // summary-model selection below, same as the pre-Work-Item-2 contract.
  }

  const resolution = resolveSummaryModel(summarySettings);
  return dispatchSummaryResolution(resolution, { prompt, recentMessages, sessionStatus, options });
}

function dispatchSummaryResolution(resolution, { prompt, recentMessages, sessionStatus, options }) {
  if (isBuiltInCodexResolution(resolution)) {
    return callBuiltInCodexSummary(prompt, resolution, options);
  }
  if (resolution.kind === 'openai') {
    return callOpenAISummaryModel(prompt, resolution, options);
  }
  return callAnthropicSummaryModel({ prompt, recentMessages, sessionStatus, resolution, options });
}

/**
 * Walk a summary-bound tier's ordered members, advancing past retryable
 * failures until one succeeds, every eligible member is exhausted (terminal
 * error), or nothing was eligible to attempt at all (fallthrough to the
 * default summary model — Fix 9).
 *
 * Mirrors the session-start failover loop's shape (sessionTierFailover.js)
 * but keeps its own policy: members whose provider kind is outside
 * SUPPORTED_SUMMARY_PROVIDER_KINDS are skipped — never attempted, never
 * cooled down, never counted toward exhaustion — because callSummaryModel
 * has no adapter that can route them (see api/settings.js's write-time
 * guard, which this is defense-in-depth for). There is no session-style
 * pre-conversation boundary here: a summary call either succeeds or it
 * doesn't, so every retryable failure advances.
 *
 * @param {string} tierRef
 * @param {{ prompt: string, recentMessages: Array, sessionStatus: string, options: Object }} ctx
 * @returns {Promise<string|symbol>} The summary response text, or TIER_FALLTHROUGH.
 */
async function callSummaryModelWithTierFailover(tierRef, { prompt, recentMessages, sessionStatus, options }) {
  const tierId = parseTierRef(tierRef);
  const members = tierId ? getTierMembersResolved(tierId) : [];

  let lastError = null;
  let attempted = false;

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (isUnhealthy(member.providerId, member.modelId)) continue;

    const kind = modelProviders.getById(member.providerId)?.kind || 'anthropic';
    if (!SUPPORTED_SUMMARY_PROVIDER_KINDS.has(kind)) continue;

    attempted = true;
    const resolution = resolveExplicitSummaryModel(member.modelId, member.providerId);

    try {
      // eslint-disable-next-line no-await-in-loop -- ordered failover requires sequential attempts
      return await dispatchSummaryResolution(resolution, { prompt, recentMessages, sessionStatus, options });
    } catch (error) {
      if (!matchesStartFailoverEligibleError(error)) {
        // Non-retryable (auth, malformed request, ...) — do not advance.
        throw error;
      }
      lastError = error;
      const nextMember = findNextEligibleSummaryMember(members, i);
      // Preserve the terminal eligible member. Cooldown should steer the next
      // attempt, not make the entire configured tier appear unavailable.
      if (nextMember) markUnhealthy(member.providerId, member.modelId);
      logSummaryFailoverEvent({
        options,
        failedMember: member,
        tierRef,
        nextMember,
        error,
      });
    }
  }

  if (attempted) {
    // Every eligible member was tried and failed — terminal. Do NOT silently
    // degrade to the default model; that would mask a real capacity/outage
    // problem behind a summary that quietly used an unconfigured fallback.
    throw lastError || new Error(`All summary tier members exhausted for tier "${tierRef}"`);
  }

  return TIER_FALLTHROUGH;
}

/**
 * Find the next member (after `currentIndex`) that would actually be
 * attempted — skipping cooldown and unsupported-kind members — purely for
 * the failover notice/log payload's `toModel`/`toProviderId`. Does not
 * affect control flow; the main loop's own skip logic is authoritative.
 * @param {Array<{providerId: string, modelId: string}>} members
 * @param {number} currentIndex
 * @returns {{providerId: string, modelId: string}|null}
 */
function findNextEligibleSummaryMember(members, currentIndex) {
  for (let i = currentIndex + 1; i < members.length; i++) {
    const candidate = members[i];
    if (isUnhealthy(candidate.providerId, candidate.modelId)) continue;
    const kind = modelProviders.getById(candidate.providerId)?.kind || 'anthropic';
    if (!SUPPORTED_SUMMARY_PROVIDER_KINDS.has(kind)) continue;
    return candidate;
  }
  return null;
}

/**
 * Emit the summary tier-failover side effect (agent-call log entry only —
 * there is no session WebSocket to notify for a background summary call).
 * Non-fatal: a logging failure must never abort the failover itself.
 */
function logSummaryFailoverEvent({ options, failedMember, tierRef, nextMember, error }) {
  const sessionId = options?.logMeta?.sessionId;
  if (!sessionId) return;
  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: failedMember.modelId,
      fromProviderId: failedMember.providerId,
      toModel: nextMember?.modelId ?? null,
      toProviderId: nextMember?.providerId ?? null,
      tierRef,
      reason: error?.message,
      agentType: 'summary',
    });
  } catch (_logErr) {
    // Non-fatal — failover proceeds even if logging fails.
  }
}

async function callBuiltInCodexSummary(prompt, resolution, options) {
  const callId = startOpenAISummaryLog(options.logMeta, resolution, prompt.length, 'codex-cli');
  try {
    const result = await callCodexSummary({
      prompt,
      systemPrompt: options.systemPrompt,
      model: resolution.model,
      jsonSchema: options.jsonSchema || SESSION_SUMMARY_SCHEMA,
    }, options.codexDependencies);
    if (callId) agentCallLogger.completeCall(callId, { success: true });
    return result;
  } catch (error) {
    if (callId) agentCallLogger.completeCall(callId, { success: false, error });
    throw error;
  }
}

export function isBuiltInCodexResolution(resolution) {
  return resolution?.providerId === BUILT_IN_OPENAI_PROVIDER_ID
    && resolution?.provider?.isBuiltIn === true
    && resolution?.kind === 'openai';
}

function callAnthropicSummaryModel({ prompt, recentMessages, sessionStatus, resolution, options }) {
  const providerEnv = resolution.provider && !resolution.provider.isBuiltIn
    ? { ...process.env, ...buildProviderEnv(resolution.provider) }
    : null;

  return callClaude(prompt, recentMessages, sessionStatus, {
    ...options,
    model: resolution.model,
    providerId: resolution.providerId,
    selectionReason: resolution.selectionReason,
    ...(providerEnv ? { env: providerEnv } : {}),
  });
}

async function callOpenAISummaryModel(prompt, resolution, options) {
  const { logMeta = null, systemPrompt = null, jsonSchema = null } = options || {};
  const schema = jsonSchema || SESSION_SUMMARY_SCHEMA;
  const provider = resolution.provider;
  const client = createOpenAIClient(provider);

  const callId = startOpenAISummaryLog(logMeta, resolution, prompt.length);

  try {
    const response = await createOpenAIChatCompletion(client, {
      model: resolution.model,
      prompt,
      systemPrompt,
      schema,
      structured: true,
    }).catch(async (error) => {
      if (!isStructuredOutputUnsupported(error)) throw error;
      return createOpenAIChatCompletion(client, {
        model: resolution.model,
        prompt: withJsonOnlyInstruction(prompt, schema),
        systemPrompt,
        schema,
        structured: false,
      });
    });

    logOpenAIUsage(callId, response.usage);

    if (callId) {
      agentCallLogger.completeCall(callId, { success: true });
    }
    return extractOpenAIContent(response);
  } catch (error) {
    if (callId) {
      agentCallLogger.completeCall(callId, { success: false, error });
    }
    throw error;
  }
}

function startOpenAISummaryLog(logMeta, resolution, promptLength, route = 'direct-api') {
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

function logOpenAIUsage(callId, usage) {
  if (!callId || !usage) return;
  agentCallLogger.updateUsage(callId, {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
}

function createOpenAIClient(provider) {
  const options = {
    apiKey: provider?.authToken || process.env.OPENAI_API_KEY || 'missing',
  };
  if (provider?.baseUrl) options.baseURL = provider.baseUrl;
  if (provider?.apiTimeoutMs) options.timeout = provider.apiTimeoutMs;
  return new OpenAI(options);
}

function createOpenAIChatCompletion(client, { model, prompt, systemPrompt, schema, structured }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const request = {
    model,
    messages,
    temperature: 0,
  };

  if (structured) {
    request.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'session_summary',
        schema,
        strict: false,
      },
    };
  } else {
    request.response_format = { type: 'json_object' };
  }

  return client.chat.completions.create(request);
}

function extractOpenAIContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || '')
      .join('');
  }
  return content || '';
}

function isStructuredOutputUnsupported(error) {
  const message = `${error?.message || ''} ${error?.code || ''} ${error?.type || ''}`.toLowerCase();
  return [400, 404, 422].includes(error?.status)
    || message.includes('response_format')
    || message.includes('json_schema')
    || message.includes('unsupported');
}

function withJsonOnlyInstruction(prompt, schema) {
  return `${prompt}\n\nReturn only a valid JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
}
