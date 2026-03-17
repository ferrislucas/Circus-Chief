import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, modelProviders } from '../src/database.js';

// Mock the Claude SDK query function
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args) => mockQuery(...args),
}));

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service
vi.mock('../src/services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
}));

// Import after mocking
import { runSession, continueSession } from '../src/services/sessionManager.js';

describe('sessionManager custom provider integration', () => {
  let project;
  let session;
  let customProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');

    // Create a custom provider with specific model IDs
    customProvider = modelProviders.create({
      name: 'Custom Provider',
      baseUrl: 'https://api.custom-provider.com',
      authToken: 'custom-auth-token',
    });
    modelProviders.addModel(customProvider.id, { modelId: 'custom-opus-v2', displayName: 'Opus', tier: 'opus' });
    modelProviders.addModel(customProvider.id, { modelId: 'custom-sonnet-v1', displayName: 'Sonnet', tier: 'sonnet' });
    modelProviders.addModel(customProvider.id, { modelId: 'custom-haiku-lite', displayName: 'Haiku', tier: 'haiku' });
  });

  afterEach(() => {
    // Clean up sessions
    const allSessions = sessions.getByProjectId(project.id);
    allSessions.forEach((s) => sessions.delete(s.id));
    projects.delete(project.id);

    // Clean up provider
    if (customProvider && !customProvider.isBuiltIn) {
      try {
        modelProviders.delete(customProvider.id);
      } catch (e) {
        // Ignore if already deleted
      }
    }
  });

  // Helper to create async generator that simulates SDK response
  async function* createMockQueryResponse(model = 'custom-sonnet-v1') {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-123',
      model: model,
    };
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Mock response' }],
      },
    };
    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.001,
    };
  }

  describe('runSession with custom provider model', () => {
    it('uses custom provider when model is registered to that provider', async () => {
      // custom-sonnet-v1 is registered to customProvider via addModel
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-sonnet-v1'));

      // Pass the custom provider's model directly
      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-sonnet-v1');
    });

    it('sets ANTHROPIC_API_KEY from provider authToken', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-sonnet-v1'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBe('custom-auth-token');
    });

    it('sets ANTHROPIC_BASE_URL from provider baseUrl', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-sonnet-v1'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBe('https://api.custom-provider.com');
    });

    it('passes provider default models as env vars', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-sonnet-v1'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('custom-sonnet-v1');
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('custom-opus-v2');
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('custom-haiku-lite');
    });

    it('uses opus model from custom provider', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-opus-v2'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-opus-v2' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-opus-v2');
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
    });

    it('uses haiku model from custom provider', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-haiku-lite'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-haiku-lite' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-haiku-lite');
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
    });

    it('uses custom model added to provider', async () => {
      // Add a custom model to the provider
      modelProviders.addModel(customProvider.id, {
        modelId: 'my-custom-model-v3',
        displayName: 'Custom Model v3',
        tier: 'custom',
      });

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('my-custom-model-v3'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'my-custom-model-v3' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('my-custom-model-v3');
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBe('https://api.custom-provider.com');
    });
  });

  describe('continueSession with custom provider model', () => {
    it('uses custom provider when model is passed', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-sonnet-v1'));

      await continueSession(session.id, 'follow-up message', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-sonnet-v1');
    });

    it('sets both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse('custom-haiku-lite'));

      await continueSession(session.id, 'follow-up message', '/tmp/test', { model: 'custom-haiku-lite' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBe('custom-auth-token');
    });

    it('can switch models between messages', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });

      // First message with sonnet
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('custom-sonnet-v1'));
      await continueSession(session.id, 'first message', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery.mock.calls[0][0].options.model).toBe('custom-sonnet-v1');

      // Second message with opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('custom-opus-v2'));
      await continueSession(session.id, 'second message', '/tmp/test', { model: 'custom-opus-v2' });

      expect(mockQuery.mock.calls[1][0].options.model).toBe('custom-opus-v2');
    });
  });

  describe('without custom provider (default behavior)', () => {
    it('passes tier name as-is when no provider found for model', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('sonnet'));

      // Pass tier name - no provider lookup, passed directly to SDK
      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'sonnet' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      // Tier names pass through to SDK
      expect(queryParams.options.model).toBe('sonnet');
    });

    it('passes specific Anthropic model ID as-is', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('claude-sonnet-4-6'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'claude-sonnet-4-6' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-sonnet-4-6');
    });

    it('does not set custom env vars when using default Anthropic models', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('sonnet'));

      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'sonnet' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      // These should not be set for default Anthropic usage
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('uses null model when none provided', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse(null));

      await runSession(session.id, 'test prompt', '/tmp/test');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBeNull();
    });
  });

  describe('provider with additional environment variables', () => {
    it('includes additional env vars from provider configuration', async () => {
      const providerWithExtras = modelProviders.create({
        name: 'Provider with Extras',
        baseUrl: 'https://api.extras.com',
        authToken: 'extras-token',
        additionalEnvVars: {
          CUSTOM_VAR_1: 'value1',
          CUSTOM_VAR_2: 'value2',
        },
      });
      modelProviders.addModel(providerWithExtras.id, { modelId: 'extras-sonnet', displayName: 'Extras Sonnet', tier: 'sonnet' });

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('extras-sonnet'));

      // Use the extras-sonnet model which maps to providerWithExtras
      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'extras-sonnet' });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.CUSTOM_VAR_1).toBe('value1');
      expect(queryParams.options.env.CUSTOM_VAR_2).toBe('value2');

      // Cleanup
      modelProviders.delete(providerWithExtras.id);
    });
  });

  describe('model-based provider lookup', () => {
    it('finds correct provider when multiple providers have different models', async () => {
      // Create a second custom provider
      const secondProvider = modelProviders.create({
        name: 'Second Provider',
        baseUrl: 'https://api.second-provider.com',
        authToken: 'second-auth-token',
      });
      modelProviders.addModel(secondProvider.id, { modelId: 'second-sonnet-model', displayName: 'Second Sonnet', tier: 'sonnet' });

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');

      // Use model from first provider
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('custom-sonnet-v1'));
      await runSession(session.id, 'test prompt', '/tmp/test', { model: 'custom-sonnet-v1' });

      expect(mockQuery.mock.calls[0][0].options.env.ANTHROPIC_BASE_URL).toBe('https://api.custom-provider.com');
      expect(mockQuery.mock.calls[0][0].options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');

      // Use model from second provider
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('second-sonnet-model'));
      await runSession(session.id, 'another prompt', '/tmp/test', { model: 'second-sonnet-model' });

      expect(mockQuery.mock.calls[1][0].options.env.ANTHROPIC_BASE_URL).toBe('https://api.second-provider.com');
      expect(mockQuery.mock.calls[1][0].options.env.ANTHROPIC_API_KEY).toBe('second-auth-token');

      // Cleanup
      modelProviders.delete(secondProvider.id);
    });
  });
});
