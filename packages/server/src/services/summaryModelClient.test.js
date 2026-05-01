import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openAIInstances: [],
  openAICreate: vi.fn(),
  callClaude: vi.fn(),
  buildProviderEnv: vi.fn(),
  agentCallLogger: {
    startCall: vi.fn(),
    updateUsage: vi.fn(),
    completeCall: vi.fn(),
  },
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAI(options) {
    mocks.openAIInstances.push(options);
    return {
      chat: {
        completions: {
          create: mocks.openAICreate,
        },
      },
    };
  }),
}));

vi.mock('./summaryClaudeClient.js', () => ({
  SESSION_SUMMARY_SCHEMA: {
    type: 'object',
    properties: { short_summary: { type: 'string' } },
    required: ['short_summary'],
  },
  callClaude: mocks.callClaude,
}));

vi.mock('./agentCallLogger.js', () => ({
  agentCallLogger: mocks.agentCallLogger,
}));

vi.mock('./sessionProvider.js', () => ({
  buildProviderEnv: mocks.buildProviderEnv,
}));

import { SESSION_SUMMARY_SCHEMA, callSummaryModel } from './summaryModelClient.js';

describe('summaryModelClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAIInstances.length = 0;
    delete process.env.OPENAI_API_KEY;
    mocks.openAICreate.mockResolvedValue({
      choices: [{ message: { content: '{"short_summary":"ok"}' } }],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    });
    mocks.callClaude.mockResolvedValue('{"short_summary":"ok"}');
    mocks.buildProviderEnv.mockReturnValue({ ANTHROPIC_API_KEY: 'custom-token' });
    mocks.agentCallLogger.startCall.mockReturnValue('call-1');
  });

  it('calls built-in Anthropic through Claude with provider metadata', async () => {
    const resolution = {
      model: 'claude-haiku-4-5-20251001',
      providerId: 'anthropic-default',
      provider: { id: 'anthropic-default', isBuiltIn: true, kind: 'anthropic' },
      kind: 'anthropic',
      selectionReason: 'explicit',
    };

    await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(mocks.callClaude).toHaveBeenCalledWith('prompt', [], 'completed', expect.objectContaining({
      model: 'claude-haiku-4-5-20251001',
      providerId: 'anthropic-default',
      selectionReason: 'explicit',
    }));
    expect(mocks.callClaude.mock.calls[0][3]).not.toHaveProperty('env');
  });

  it('merges custom Anthropic provider env into Claude calls', async () => {
    const provider = { id: 'anthropic-custom', isBuiltIn: false, kind: 'anthropic' };
    const resolution = {
      model: 'custom-haiku',
      providerId: provider.id,
      provider,
      kind: 'anthropic',
      selectionReason: 'explicit',
    };

    await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(mocks.buildProviderEnv).toHaveBeenCalledWith(provider);
    expect(mocks.callClaude).toHaveBeenCalledWith('prompt', [], 'completed', expect.objectContaining({
      env: expect.objectContaining({
        ...process.env,
        ANTHROPIC_API_KEY: 'custom-token',
      }),
    }));
  });

  it('creates built-in OpenAI client with OPENAI_API_KEY and logs usage metadata', async () => {
    process.env.OPENAI_API_KEY = 'official-key';
    const resolution = {
      model: 'gpt-5.4-mini',
      providerId: 'openai-default',
      provider: { id: 'openai-default', isBuiltIn: true, kind: 'openai' },
      kind: 'openai',
      selectionReason: 'recent-built-in-provider',
    };

    const result = await callSummaryModel('prompt', [], 'completed', {
      resolvedModel: resolution,
      logMeta: { sessionId: 'session-1', conversationId: 'conversation-1', callType: 'session-summary' },
    });

    expect(result).toBe('{"short_summary":"ok"}');
    expect(mocks.openAIInstances[0]).toEqual({ apiKey: 'official-key' });
    expect(mocks.agentCallLogger.startCall).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      model: 'gpt-5.4-mini',
      metadata: {
        providerId: 'openai-default',
        selectionReason: 'recent-built-in-provider',
      },
    }));
    expect(mocks.agentCallLogger.updateUsage).toHaveBeenCalledWith('call-1', {
      inputTokens: 3,
      outputTokens: 5,
      thinkingTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(mocks.agentCallLogger.completeCall).toHaveBeenCalledWith('call-1', { success: true });
  });

  it('uses custom OpenAI-compatible provider auth, base URL, and timeout', async () => {
    const resolution = {
      model: 'custom-gpt',
      providerId: 'custom-openai',
      provider: {
        id: 'custom-openai',
        kind: 'openai',
        authToken: 'custom-token',
        baseUrl: 'https://openai-compatible.test/v1',
        apiTimeoutMs: 12_000,
      },
      kind: 'openai',
      selectionReason: 'explicit',
    };

    await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(mocks.openAIInstances[0]).toEqual({
      apiKey: 'custom-token',
      baseURL: 'https://openai-compatible.test/v1',
      timeout: 12_000,
    });
  });

  it('requests structured JSON schema first', async () => {
    const resolution = {
      model: 'gpt-5.4-mini',
      providerId: 'openai-default',
      provider: { id: 'openai-default', kind: 'openai' },
      kind: 'openai',
      selectionReason: 'explicit',
    };

    await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(mocks.openAICreate).toHaveBeenCalledWith(expect.objectContaining({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'session_summary',
          schema: SESSION_SUMMARY_SCHEMA,
          strict: false,
        },
      },
    }));
  });

  it('retries unsupported structured output with JSON object mode and JSON-only instruction', async () => {
    mocks.openAICreate
      .mockRejectedValueOnce(Object.assign(new Error('unsupported response_format json_schema'), { status: 400 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"short_summary":"fallback"}' } }],
      });
    const resolution = {
      model: 'custom-gpt',
      providerId: 'custom-openai',
      provider: { id: 'custom-openai', kind: 'openai' },
      kind: 'openai',
      selectionReason: 'explicit',
    };

    const result = await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(result).toBe('{"short_summary":"fallback"}');
    expect(mocks.openAICreate).toHaveBeenCalledTimes(2);
    expect(mocks.openAICreate.mock.calls[1][0]).toMatchObject({
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: expect.stringContaining('Return only a valid JSON object') }],
    });
  });

  it('completes OpenAI log entries as failed when calls fail', async () => {
    const error = new Error('OpenAI failed');
    mocks.openAICreate.mockRejectedValue(error);
    const resolution = {
      model: 'gpt-5.4-mini',
      providerId: 'openai-default',
      provider: { id: 'openai-default', kind: 'openai' },
      kind: 'openai',
      selectionReason: 'explicit',
    };

    await expect(callSummaryModel('prompt', [], 'completed', {
      resolvedModel: resolution,
      logMeta: { sessionId: 'session-1', callType: 'session-summary' },
    })).rejects.toThrow('OpenAI failed');

    expect(mocks.agentCallLogger.completeCall).toHaveBeenCalledWith('call-1', { success: false, error });
  });
});
