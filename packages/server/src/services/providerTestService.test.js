import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * We mock the `@anthropic-ai/sdk` and `openai` packages at module scope. Each
 * test swaps the behavior of the mocked client methods via the exposed refs.
 */
const anthropicCreateSpy = vi.fn();
const openaiListSpy = vi.fn();
const openaiChatCreateSpy = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic() {
    return { messages: { create: anthropicCreateSpy } };
  }
  return { default: MockAnthropic };
});

vi.mock('openai', () => {
  function MockOpenAI() {
    return {
      models: { list: openaiListSpy },
      chat: { completions: { create: openaiChatCreateSpy } },
    };
  }
  return { default: MockOpenAI };
});

import { testProviderConnection } from './providerTestService.js';

function apiError({ status, code, type, message }) {
  const err = new Error(message || 'API error');
  if (status !== undefined) err.status = status;
  if (code !== undefined) err.code = code;
  if (type !== undefined) err.type = type;
  return err;
}

describe('providerTestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Anthropic kind (regression) ───────────────────────────────────────

  describe("kind='anthropic' (regression)", () => {
    it('success → { success: true, message, details: { model, usage } }', async () => {
      anthropicCreateSpy.mockResolvedValue({
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      const result = await testProviderConnection({
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        authToken: 'sk-ant',
        apiTimeoutMs: 30000,
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      expect(result.details.model).toBe('claude-sonnet-4-20250514');
      expect(result.details.usage).toEqual({ input_tokens: 1, output_tokens: 1 });
    });

    it('401 → auth failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ status: 401, type: 'authentication_error' }));
      const result = await testProviderConnection({ kind: 'anthropic', authToken: 'bad' });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'authentication_error' },
      });
    });

    it('404 → model failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ status: 404, type: 'not_found_error' }));
      const result = await testProviderConnection({ kind: 'anthropic' });
      expect(result).toEqual({
        success: false,
        message: 'Model not found. Check the model ID.',
        details: { code: 404, type: 'not_found_error' },
      });
    });

    it('ECONNREFUSED → base URL failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ code: 'ECONNREFUSED' }));
      const result = await testProviderConnection({ kind: 'anthropic' });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not connect to server. Check the base URL.');
      expect(result.details.code).toBe('ECONNREFUSED');
    });

    it('ETIMEDOUT → timeout failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ code: 'ETIMEDOUT' }));
      const result = await testProviderConnection({ kind: 'anthropic', apiTimeoutMs: 1000 });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection timed out. Try increasing the timeout.');
      expect(result.details.code).toBe('ETIMEDOUT');
    });

    it('default behavior when kind is omitted → anthropic path', async () => {
      anthropicCreateSpy.mockResolvedValue({ model: 'x', usage: {} });
      const result = await testProviderConnection({ authToken: 'sk' });
      expect(result.success).toBe(true);
      expect(anthropicCreateSpy).toHaveBeenCalledTimes(1);
      expect(openaiListSpy).not.toHaveBeenCalled();
    });
  });

  // ── OpenAI kind ───────────────────────────────────────────────────────

  describe("kind='openai'", () => {
    it('success via models.list() → { success: true, message, details.model }', async () => {
      openaiListSpy.mockResolvedValue({
        data: [{ id: 'gpt-4o' }, { id: 'o1-mini' }],
      });
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-test',
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      expect(result.details.model).toBe('gpt-4o');
      // Fallback should not be triggered on success
      expect(openaiChatCreateSpy).not.toHaveBeenCalled();
    });

    it('models.list() 404 → falls back to chat.completions.create with max_tokens=1', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 404 }));
      openaiChatCreateSpy.mockResolvedValue({
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://chat-only.local/v1',
        authToken: 'sk',
      });
      expect(result.success).toBe(true);
      expect(result.details.model).toBe('gpt-4o-mini');
      expect(result.details.usage).toEqual({ prompt_tokens: 1, completion_tokens: 1 });
      expect(openaiChatCreateSpy).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    });

    it('401 on models.list() → auth failure shape (no fallback)', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 401, type: 'invalid_api_key' }));
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'bad',
      });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'invalid_api_key' },
      });
      expect(openaiChatCreateSpy).not.toHaveBeenCalled();
    });

    it('ECONNREFUSED on models.list() → base URL failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ code: 'ECONNREFUSED' }));
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://nowhere.local',
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not connect to server. Check the base URL.');
      expect(result.details.code).toBe('ECONNREFUSED');
    });

    it('ETIMEDOUT on models.list() → timeout failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ code: 'ETIMEDOUT' }));
      const result = await testProviderConnection({
        kind: 'openai',
        apiTimeoutMs: 500,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection timed out. Try increasing the timeout.');
      expect(result.details.code).toBe('ETIMEDOUT');
    });

    it('models.list 404 then chat.completions 401 → auth failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 404 }));
      openaiChatCreateSpy.mockRejectedValue(apiError({ status: 401, type: 'invalid_api_key' }));
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'bad',
      });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'invalid_api_key' },
      });
    });

    it('empty list + no defaultSonnetModel → success with empty details', async () => {
      openaiListSpy.mockResolvedValue({ data: [] });
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'sk',
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      // details.model is absent when no model could be resolved
      expect(result.details.model).toBeUndefined();
    });

    it('empty list but defaultSonnetModel supplied → echoes that model', async () => {
      openaiListSpy.mockResolvedValue({ data: [] });
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'sk',
        defaultSonnetModel: 'custom-model-id',
      });
      expect(result.success).toBe(true);
      expect(result.details.model).toBe('custom-model-id');
    });

    it('response shape always includes { success, message, details }', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 500, type: 'server_error', message: 'boom' }));
      const result = await testProviderConnection({ kind: 'openai' });
      expect(Object.keys(result).sort()).toEqual(['details', 'message', 'success']);
      expect(result.success).toBe(false);
      expect(result.details.code).toBe(500);
      expect(result.details.type).toBe('server_error');
    });
  });
});
