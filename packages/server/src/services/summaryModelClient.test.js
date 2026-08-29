import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openAIInstances: [],
  openAICreate: vi.fn(),
  callClaude: vi.fn(),
  buildProviderEnv: vi.fn(),
  callCodexSummary: vi.fn(),
  agentCallLogger: {
    startCall: vi.fn(),
    updateUsage: vi.fn(),
    completeCall: vi.fn(),
    _logFailoverEvent: vi.fn(),
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

vi.mock('./summaryCodexClient.js', () => ({
  callCodexSummary: mocks.callCodexSummary,
}));

import { SESSION_SUMMARY_SCHEMA, callSummaryModel } from './summaryModelClient.js';
import { modelProviders, modelTiers } from '../database.js';
import { isUnhealthy } from './tierResolutionService.js';
import { DEFAULT_ANTHROPIC_SUMMARY_MODEL } from './summaryModelResolver.js';
import { buildTierRef } from '@circuschief/shared';

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
    mocks.callCodexSummary.mockResolvedValue('{"short_summary":"codex"}');
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

  it('routes built-in OpenAI through Codex even when OPENAI_API_KEY is present', async () => {
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

    expect(result).toBe('{"short_summary":"codex"}');
    expect(mocks.callCodexSummary).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4-mini', prompt: 'prompt',
    }), undefined);
    expect(mocks.openAIInstances).toHaveLength(0);
    expect(mocks.agentCallLogger.startCall).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ route: 'codex-cli' }),
    }));
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

  it('does not route a custom provider with the same model ID to Codex', async () => {
    const resolution = {
      model: 'gpt-5.4-mini',
      providerId: 'custom-openai',
      provider: { id: 'custom-openai', isBuiltIn: false, kind: 'openai' },
      kind: 'openai',
      selectionReason: 'explicit',
    };

    await callSummaryModel('prompt', [], 'completed', { resolvedModel: resolution });

    expect(mocks.callCodexSummary).not.toHaveBeenCalled();
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

  it('keeps OpenAI failure logging on custom providers', async () => {
    const error = new Error('OpenAI failed');
    mocks.openAICreate.mockRejectedValue(error);
    const resolution = {
      model: 'gpt-5.4-mini',
      providerId: 'custom-openai',
      provider: { id: 'custom-openai', isBuiltIn: false, kind: 'openai' },
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

// ── Work Item 2: failure-driven failover for a tier-bound summary model ────

describe('callSummaryModel tier failover (Work Item 2)', () => {
  let providerA;
  let providerB;
  let tier;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openAIInstances.length = 0;
    mocks.agentCallLogger.startCall.mockReturnValue('call-1');

    providerA = modelProviders.create({ name: 'Summary Tier Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Summary Tier Provider B', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'summary-model-a', displayName: 'A' });
    modelProviders.addModel(providerB.id, { modelId: 'summary-model-b', displayName: 'B' });

    tier = modelTiers.create({
      name: 'Summary Tier',
      members: [
        { providerId: providerA.id, modelId: 'summary-model-a', position: 0 },
        { providerId: providerB.id, modelId: 'summary-model-b', position: 1 },
      ],
    });
  });

  function tierSettings(tierId) {
    return { summaryModel: buildTierRef(tierId), summaryProviderId: null };
  }

  it('advances to the next member in order on a retryable failure, cools the failed member, and logs a failover event', async () => {
    mocks.callClaude
      .mockRejectedValueOnce(Object.assign(new Error('Error: 529 Service overloaded'), { status: 529 }))
      .mockResolvedValueOnce('{"short_summary":"from B"}');

    const result = await callSummaryModel('prompt', [], 'completed', {
      summarySettings: tierSettings(tier.id),
      logMeta: { sessionId: 'summary-session-1', callType: 'generateSessionSummary' },
    });

    expect(result).toBe('{"short_summary":"from B"}');
    expect(mocks.callClaude).toHaveBeenCalledTimes(2);
    expect(mocks.callClaude.mock.calls[0][3]).toMatchObject({ model: 'summary-model-a', providerId: providerA.id });
    expect(mocks.callClaude.mock.calls[1][3]).toMatchObject({ model: 'summary-model-b', providerId: providerB.id });

    expect(isUnhealthy(providerA.id, 'summary-model-a')).toBe(true);
    expect(isUnhealthy(providerB.id, 'summary-model-b')).toBe(false);

    expect(mocks.agentCallLogger._logFailoverEvent).toHaveBeenCalledWith(
      'summary-session-1',
      expect.objectContaining({
        fromModel: 'summary-model-a',
        fromProviderId: providerA.id,
        toModel: 'summary-model-b',
        toProviderId: providerB.id,
        agentType: 'summary',
      })
    );
  });

  it('does not advance past a non-retryable error (e.g. auth failure)', async () => {
    const authError = new Error('Invalid API key provided');
    mocks.callClaude.mockRejectedValueOnce(authError);

    await expect(
      callSummaryModel('prompt', [], 'completed', {
        summarySettings: tierSettings(tier.id),
        logMeta: { sessionId: 'summary-session-2', callType: 'generateSessionSummary' },
      })
    ).rejects.toThrow('Invalid API key provided');

    expect(mocks.callClaude).toHaveBeenCalledTimes(1);
    expect(isUnhealthy(providerA.id, 'summary-model-a')).toBe(false);
    expect(mocks.agentCallLogger._logFailoverEvent).not.toHaveBeenCalled();
  });

  it('exhausts every eligible member before throwing a terminal error', async () => {
    mocks.callClaude.mockRejectedValue(Object.assign(new Error('Error: 529 Service overloaded'), { status: 529 }));

    await expect(
      callSummaryModel('prompt', [], 'completed', {
        summarySettings: tierSettings(tier.id),
        logMeta: { sessionId: 'summary-session-3', callType: 'generateSessionSummary' },
      })
    ).rejects.toThrow(/529/);

    expect(mocks.callClaude).toHaveBeenCalledTimes(2);
    expect(isUnhealthy(providerA.id, 'summary-model-a')).toBe(true);
    expect(isUnhealthy(providerB.id, 'summary-model-b')).toBe(true);
  });

  it('skips a member whose provider kind is unsupported for summaries (google), without attempting or cooling it down', async () => {
    const googleProvider = modelProviders.create({ name: 'Summary Google Provider', kind: 'google' });
    modelProviders.addModel(googleProvider.id, { modelId: 'gemini-summary-model', displayName: 'Gemini' });
    const mixedTier = modelTiers.create({
      name: 'Mixed Summary Tier',
      members: [
        { providerId: googleProvider.id, modelId: 'gemini-summary-model', position: 0 },
        { providerId: providerA.id, modelId: 'summary-model-a', position: 1 },
      ],
    });
    mocks.callClaude.mockResolvedValueOnce('{"short_summary":"from A"}');

    const result = await callSummaryModel('prompt', [], 'completed', {
      summarySettings: tierSettings(mixedTier.id),
      logMeta: { sessionId: 'summary-session-4', callType: 'generateSessionSummary' },
    });

    expect(result).toBe('{"short_summary":"from A"}');
    expect(mocks.callClaude).toHaveBeenCalledTimes(1);
    expect(mocks.callClaude.mock.calls[0][3]).toMatchObject({ model: 'summary-model-a' });
    // The Google member was skipped — never attempted, never cooled down,
    // and its skip must not be logged as a failover.
    expect(isUnhealthy(googleProvider.id, 'gemini-summary-model')).toBe(false);
    expect(mocks.agentCallLogger._logFailoverEvent).not.toHaveBeenCalled();
  });

  it('falls through to the default summary model when the tier has no resolvable members', async () => {
    const emptyTier = modelTiers.create({ name: 'Empty Summary Tier' });
    mocks.callClaude.mockResolvedValueOnce('{"short_summary":"default"}');

    const result = await callSummaryModel('prompt', [], 'completed', {
      summarySettings: tierSettings(emptyTier.id),
      logMeta: { sessionId: 'summary-session-5', callType: 'generateSessionSummary' },
    });

    expect(result).toBe('{"short_summary":"default"}');
    expect(mocks.callClaude).toHaveBeenCalledTimes(1);
    expect(mocks.callClaude.mock.calls[0][3]).toMatchObject({ model: DEFAULT_ANTHROPIC_SUMMARY_MODEL });
  });

  it('falls through to the default summary model when the tier ref no longer resolves (deleted)', async () => {
    mocks.callClaude.mockResolvedValueOnce('{"short_summary":"default"}');

    const result = await callSummaryModel('prompt', [], 'completed', {
      summarySettings: tierSettings('deleted-tier-id'),
      logMeta: { sessionId: 'summary-session-6', callType: 'generateSessionSummary' },
    });

    expect(result).toBe('{"short_summary":"default"}');
    expect(mocks.callClaude.mock.calls[0][3]).toMatchObject({ model: DEFAULT_ANTHROPIC_SUMMARY_MODEL });
  });
});
