import OpenAI from 'openai';
import { callClaude, SESSION_SUMMARY_SCHEMA } from './summaryClaudeClient.js';
import { agentCallLogger } from './agentCallLogger.js';
import { buildProviderEnv } from './sessionProvider.js';
import { resolveSummaryModel } from './summaryModelResolver.js';

export { SESSION_SUMMARY_SCHEMA };

export async function callSummaryModel(prompt, recentMessages, sessionStatus, options = {}) {
  const resolution = options.resolvedModel || resolveSummaryModel(options.summarySettings || {});
  if (resolution.kind === 'openai') {
    return callOpenAISummaryModel(prompt, resolution, options);
  }
  return callAnthropicSummaryModel({ prompt, recentMessages, sessionStatus, resolution, options });
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

function startOpenAISummaryLog(logMeta, resolution, promptLength) {
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
