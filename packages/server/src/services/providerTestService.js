import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * Test a provider configuration by making a minimal API call.
 * Branches on `kind`:
 *   - 'anthropic' → send a tiny `messages.create` via `@anthropic-ai/sdk`.
 *   - 'openai'    → prefer `models.list()` via `openai`; fall back to a
 *                   `chat.completions.create({ max_tokens: 1 })` if
 *                   `models.list` is not supported (chat-only endpoints).
 *
 * Both branches return the same response shape:
 *   - Success: { success: true, message, details: { model, usage? } }
 *   - Failure: { success: false, message, details: { code, type } }
 * This function never throws. Errors are mapped to the failure shape above.
 *
 * @param {Object} config
 * @param {'anthropic'|'openai'} [config.kind='anthropic'] - Provider kind
 * @param {string} [config.baseUrl] - Base URL for the provider
 * @param {string} [config.authToken] - Auth token for the provider
 * @param {string} [config.defaultSonnetModel] - For anthropic: model to test against
 * @param {number} [config.apiTimeoutMs] - API timeout in milliseconds
 * @returns {Promise<{success: boolean, message: string, details?: Object}>}
 */
export async function testProviderConnection(config) {
  const { kind = 'anthropic' } = config || {};
  if (kind === 'openai') {
    return testOpenAIConnection(config);
  }
  return testAnthropicConnection(config);
}

/**
 * Anthropic-kind connection test (unchanged from pre-kind behavior).
 * @private
 */
async function testAnthropicConnection(config) {
  const { baseUrl, authToken, defaultSonnetModel, apiTimeoutMs } = config;

  try {
    const clientOptions = {};

    if (baseUrl) clientOptions.baseURL = baseUrl;
    if (authToken) clientOptions.apiKey = authToken;
    if (apiTimeoutMs) clientOptions.timeout = apiTimeoutMs;

    const client = new Anthropic(clientOptions);

    // Use a minimal message to test connectivity.
    // This verifies: network, auth, and model availability.
    const testModel = defaultSonnetModel || 'claude-sonnet-4-20250514';

    const response = await client.messages.create({
      model: testModel,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    return {
      success: true,
      message: 'Connection successful',
      details: {
        model: response.model,
        usage: response.usage,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
      details: {
        code: error.status || error.code,
        type: error.type || error.name,
      },
    };
  }
}

/**
 * OpenAI-kind connection test. Tries `models.list()` first; if the endpoint
 * does not implement that (common for chat-only proxies like LM Studio), falls
 * back to a minimal `chat.completions.create({ max_tokens: 1 })`.
 * @private
 */
async function testOpenAIConnection(config) {
  const { baseUrl, authToken, defaultSonnetModel, apiTimeoutMs } = config;

  const clientOptions = {};
  if (baseUrl) clientOptions.baseURL = baseUrl;
  // The openai SDK requires a truthy apiKey; use a dummy if none provided so we
  // at least surface a 401 rather than a client-side "Missing API key" throw.
  clientOptions.apiKey = authToken || 'missing';
  if (apiTimeoutMs) clientOptions.timeout = apiTimeoutMs;

  let client;
  try {
    client = new OpenAI(clientOptions);
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
      details: { code: error.status || error.code, type: error.type || error.name },
    };
  }

  // 1) Try models.list()
  try {
    const listResult = await client.models.list();
    // listResult can be a ListResponse or an iterable; be defensive about shape.
    const first = pickFirstModel(listResult) || defaultSonnetModel || null;
    return {
      success: true,
      message: 'Connection successful',
      details: first ? { model: first } : {},
    };
  } catch (error) {
    // If models.list is explicitly a 404 (endpoint not implemented), fall back
    // to chat.completions with max_tokens=1. Any other error bubbles out.
    if (error?.status !== 404) {
      return {
        success: false,
        message: getErrorMessage(error),
        details: { code: error.status || error.code, type: error.type || error.name },
      };
    }
  }

  // 2) Fallback: minimal chat.completions.create
  try {
    const testModel = defaultSonnetModel || 'gpt-4o-mini';
    const response = await client.chat.completions.create({
      model: testModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return {
      success: true,
      message: 'Connection successful',
      details: {
        model: response?.model || testModel,
        ...(response?.usage ? { usage: response.usage } : {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
      details: { code: error.status || error.code, type: error.type || error.name },
    };
  }
}

/**
 * Extract a representative model ID from whatever shape `models.list()` returns.
 * @private
 */
function pickFirstModel(listResult) {
  if (!listResult) return null;
  // Newer SDKs expose .data; older ones are plain arrays / async iterables.
  const data = Array.isArray(listResult) ? listResult : listResult.data;
  if (Array.isArray(data) && data.length > 0) {
    const entry = data[0];
    return entry?.id || entry?.model || null;
  }
  return null;
}

/**
 * Get a human-readable error message from an error object
 * @param {Error} error - The error object
 * @returns {string} - Human-readable error message
 * @private
 */
function getErrorMessage(error) {
  if (error.status === 401) {
    return 'Authentication failed. Check your auth token.';
  }
  if (error.status === 404) {
    return 'Model not found. Check the model ID.';
  }
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return 'Could not connect to server. Check the base URL.';
  }
  if (error.code === 'ETIMEDOUT') {
    return 'Connection timed out. Try increasing the timeout.';
  }
  return error.message || 'Unknown error occurred';
}
