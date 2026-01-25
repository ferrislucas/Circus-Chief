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
      defaultOpusModel: 'custom-opus-v2',
      defaultSonnetModel: 'custom-sonnet-v1',
      defaultHaikuModel: 'custom-haiku-lite',
    });
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

    // Reset default provider
    const defaultProvider = modelProviders.getDefault();
    if (defaultProvider && !defaultProvider.isBuiltIn) {
      try {
        modelProviders.delete(defaultProvider.id);
      } catch (e) {
        // Ignore
      }
    }
  });

  // Helper to create async generator that simulates SDK response
  async function* createMockQueryResponse() {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-123',
      model: 'custom-sonnet-v1',
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

  describe('runSession with custom provider', () => {
    it('maps sonnet tier to provider defaultSonnetModel', async () => {
      // Set provider as default
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-sonnet-v1');
    });

    it('maps opus tier to provider defaultOpusModel', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'opus');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-opus-v2');
    });

    it('maps haiku tier to provider defaultHaikuModel', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'haiku');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-haiku-lite');
    });

    it('uses specific model ID when not a tier name', async () => {
      modelProviders.setDefault(customProvider.id);

      // Use a specific model ID that's not a tier name
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'specific-custom-model-123');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('specific-custom-model-123');
    });

    it('sets ANTHROPIC_API_KEY from provider authToken', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBe('custom-auth-token');
    });

    it('sets ANTHROPIC_BASE_URL from provider baseUrl', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBe('https://api.custom-provider.com');
    });

    it('passes provider default models as env vars', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('custom-sonnet-v1');
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('custom-opus-v2');
      expect(queryParams.options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('custom-haiku-lite');
    });

    it('parameter model overrides session model with custom provider', async () => {
      modelProviders.setDefault(customProvider.id);

      // Session has sonnet, but pass opus as parameter
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], 'opus');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-opus-v2');
    });

    it('returns null for model when provider has no defaultSonnetModel', async () => {
      // Create provider without sonnet model
      const limitedProvider = modelProviders.create({
        name: 'Limited Provider',
        baseUrl: 'https://api.limited.com',
        authToken: 'limited-token',
        defaultOpusModel: 'limited-opus',
        // No defaultSonnetModel
        defaultHaikuModel: 'limited-haiku',
      });

      modelProviders.setDefault(limitedProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBeNull();

      // Cleanup
      modelProviders.delete(limitedProvider.id);
    });
  });

  describe('continueSession with custom provider', () => {
    it('maps sonnet tier to provider defaultSonnetModel', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-sonnet-v1');
    });

    it('maps opus tier to provider defaultOpusModel', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'opus');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('custom-opus-v2');
    });

    it('sets both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN', async () => {
      modelProviders.setDefault(customProvider.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'haiku');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBe('custom-auth-token');
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBe('custom-auth-token');
    });
  });

  describe('without custom provider (default behavior)', () => {
    it('passes model as-is when no custom provider is set', async () => {
      // No default provider set
      const defaultProvider = modelProviders.getDefault();
      if (defaultProvider) {
        modelProviders.setDefault(null); // Unset default
      }

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      // Without custom provider, tier names pass through to SDK
      expect(queryParams.options.model).toBe('sonnet');
    });

    it('passes specific model ID as-is when no custom provider', async () => {
      // No default provider set
      const defaultProvider = modelProviders.getDefault();
      if (defaultProvider) {
        modelProviders.setDefault(null); // Unset default
      }

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('does not set custom env vars when no custom provider', async () => {
      // No default provider set
      const defaultProvider = modelProviders.getDefault();
      if (defaultProvider) {
        modelProviders.setDefault(null); // Unset default
      }

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(queryParams.options.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });
  });

  describe('provider with additional environment variables', () => {
    it('includes additional env vars from provider configuration', async () => {
      const providerWithExtras = modelProviders.create({
        name: 'Provider with Extras',
        baseUrl: 'https://api.extras.com',
        authToken: 'extras-token',
        defaultSonnetModel: 'extras-sonnet',
        additionalEnvVars: {
          CUSTOM_VAR_1: 'value1',
          CUSTOM_VAR_2: 'value2',
        },
      });

      modelProviders.setDefault(providerWithExtras.id);

      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'sonnet');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.env.CUSTOM_VAR_1).toBe('value1');
      expect(queryParams.options.env.CUSTOM_VAR_2).toBe('value2');

      // Cleanup
      modelProviders.delete(providerWithExtras.id);
    });
  });
});
