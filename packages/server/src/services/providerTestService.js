import Anthropic from '@anthropic-ai/sdk';

/**
 * Test a provider configuration by making a minimal API call
 * @param {Object} config - Provider configuration to test
 * @param {string} [config.baseUrl] - Base URL for the provider
 * @param {string} [config.authToken] - Auth token for the provider
 * @param {string} [config.defaultSonnetModel] - Default Sonnet model ID
 * @param {number} [config.apiTimeoutMs] - API timeout in milliseconds
 * @returns {Promise<{success: boolean, message: string, details?: Object}>}
 */
export async function testProviderConnection(config) {
  const { baseUrl, authToken, defaultSonnetModel, apiTimeoutMs } = config;

  try {
    // Build client options
    const clientOptions = {};

    if (baseUrl) {
      clientOptions.baseURL = baseUrl;
    }
    if (authToken) {
      clientOptions.apiKey = authToken;
    }
    if (apiTimeoutMs) {
      clientOptions.timeout = apiTimeoutMs;
    }

    const client = new Anthropic(clientOptions);

    // Use a minimal message to test connectivity
    // This verifies: network, auth, and model availability
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
