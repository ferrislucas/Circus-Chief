import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useModelInfo, __resetCapabilityCache } from './useModelInfo.js';
import { useProvidersStore } from '../stores/providers.js';
import { CLAUDE_MODELS } from '@circuschief/shared';
import { api } from './useApi.js';

describe('useModelInfo', () => {
  describe('getModelDisplayName', () => {
    it('returns "Opus 4.6" for claude-opus-4-6', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('claude-opus-4-6')).toBe('Opus 4.6');
    });

    it('returns "Opus 4.7" for claude-opus-4-7', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('claude-opus-4-7')).toBe('Opus 4.7');
    });

    it('returns "Sonnet 4.6" for claude-sonnet-4-6', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    });

    it('returns "Haiku 4.5" for claude-haiku-4-5-20251001', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    });

    it('returns "Default" when modelId is null', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName(null)).toBe('Default');
    });

    it('returns "Default" when modelId is undefined', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName(undefined)).toBe('Default');
    });

    it('returns "Default" when modelId is empty string', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('')).toBe('Default');
    });

    it('returns formatted name for unrecognized model ID', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('some-unknown-model')).toBe('Some Unknown Model');
    });
  });

  describe('getModelDescription', () => {
    it('returns "Previous generation" for Opus 4.6 model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('claude-opus-4-6')).toBe('Previous generation');
    });

    it('returns "Most capable (default)" for Opus 4.7 model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('claude-opus-4-7')).toBe('Most capable (default)');
    });

    it('returns "Balanced" for Sonnet model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('claude-sonnet-4-6')).toBe('Balanced');
    });

    it('returns "Fast & lightweight" for Haiku model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('claude-haiku-4-5-20251001')).toBe('Fast & lightweight');
    });

    it('returns default model description when modelId is null', () => {
      const { getModelDescription } = useModelInfo();
      // Default model is Opus, so it should return Opus description
      expect(getModelDescription(null)).toBe('Most capable (default)');
    });

    it('returns raw model ID for unrecognized model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('unknown-model')).toBe('unknown-model');
    });
  });

  describe('getModelInfo', () => {
    it('returns object with name and description for Opus 4.6', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-opus-4-6');

      expect(info).toMatchObject({
        name: 'Opus 4.6',
        description: 'Previous generation',
        agentType: 'claude-code',
      });
    });

    it('returns object with name and description for Opus 4.7', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-opus-4-7');

      expect(info).toMatchObject({
        name: 'Opus 4.7',
        description: 'Most capable (default)',
        agentType: 'claude-code',
      });
    });

    it('returns object with name and description for Sonnet', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-sonnet-4-6');

      expect(info).toMatchObject({
        name: 'Sonnet 4.6',
        description: 'Balanced',
        agentType: 'claude-code',
      });
    });

    it('returns object with name and description for Haiku', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-haiku-4-5-20251001');

      expect(info).toMatchObject({
        name: 'Haiku 4.5',
        description: 'Fast & lightweight',
        agentType: 'claude-code',
      });
    });

    it('returns Default name with default description for null model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo(null);

      expect(info).toMatchObject({
        name: 'Default',
        description: 'Most capable (default)',
        agentType: 'claude-code',
      });
    });

    it('returns formatted name with raw model ID as description for unrecognized model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('unknown-model-id');

      expect(info).toMatchObject({
        name: 'Unknown Model Id',
        description: 'unknown-model-id',
        agentType: 'claude-code',
      });
    });
  });

  describe('formatModelId', () => {
    it('formats simple model ID', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('some-unknown-model')).toBe('Some Unknown Model');
    });

    it('formats GPT model', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('gpt-4o')).toBe('Gpt 4o');
    });

    it('formats DeepSeek model', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('deepseek-chat')).toBe('Deepseek Chat');
    });

    it('formats Claude model with date stamp', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('claude-3-5-sonnet-20241022')).toBe('Claude 3 5 Sonnet');
    });

    it('formats model with path prefix', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('models/my-model')).toBe('My Model');
    });

    it('formats model with underscore', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('my_model_name')).toBe('My Model Name');
    });

    it('handles empty string', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId('')).toBe('Unknown');
    });

    it('handles null', () => {
      const { formatModelId } = useModelInfo();
      expect(formatModelId(null)).toBe('Unknown');
    });
  });

  describe('composable reusability', () => {
    it('returns new function instances on each call', () => {
      const result1 = useModelInfo();
      const result2 = useModelInfo();

      // Functions should be different instances
      expect(result1.getModelDisplayName).not.toBe(result2.getModelDisplayName);
    });

    it('all functions behave consistently across instances', () => {
      const { getModelDisplayName: fn1 } = useModelInfo();
      const { getModelDisplayName: fn2 } = useModelInfo();

      expect(fn1('claude-opus-4-6')).toBe(fn2('claude-opus-4-6'));
      expect(fn1(null)).toBe(fn2(null));
    });
  });

  describe('agent-aware getModelInfo (Phase 6)', () => {
    let getAgentsSpy;

    beforeEach(() => {
      setActivePinia(createPinia());
      __resetCapabilityCache();

      // Seed providers store with a mix of Anthropic and OpenAI providers.
      const providersStore = useProvidersStore();
      providersStore.providers = [
        {
          id: 'anthropic-default',
          name: 'Anthropic (Official)',
          isBuiltIn: true,
          kind: 'anthropic',
          models: [
            { id: 'a-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', tier: 'sonnet' },
          ],
        },
        {
          id: 'openai-prov',
          name: 'OpenAI',
          isBuiltIn: false,
          kind: 'openai',
          models: [
            { id: 'o-gpt4o', modelId: 'gpt-4o', displayName: 'GPT-4o' },
          ],
        },
      ];

      // Spy on the API so we can verify caching of /api/agents.
      getAgentsSpy = vi.spyOn(api, 'getAgents').mockResolvedValue([
        { agentType: 'claude-code', capabilities: { streaming: true, thinking: true, toolUse: true, resume: true } },
        { agentType: 'codex', capabilities: { streaming: true, thinking: false, toolUse: true, resume: false } },
      ]);
    });

    it('resolves Codex model ID to agentType="codex" with thinking disabled', async () => {
      const { getModelInfo, fetchAgentCapabilities } = useModelInfo();

      // Prime the capability cache synchronously before reading.
      await fetchAgentCapabilities();

      const info = getModelInfo('gpt-4o');
      expect(info.agentType).toBe('codex');
      expect(info.capabilities.thinking).toBe(false);
      expect(info.providerId).toBe('openai-prov');
      expect(info.providerName).toBe('OpenAI');
    });

    it('does NOT consult CLAUDE_MODELS for Codex model IDs', async () => {
      const findSpy = vi.spyOn(CLAUDE_MODELS, 'find');
      const { getModelInfo, fetchAgentCapabilities } = useModelInfo();
      await fetchAgentCapabilities();

      findSpy.mockClear();
      const info = getModelInfo('gpt-4o');

      // Name resolution falls through to providerModel.displayName; no lookups
      // were performed against the Claude constants for this Codex model.
      expect(info.name).toBe('GPT-4o');
      expect(findSpy).not.toHaveBeenCalled();

      findSpy.mockRestore();
    });

    it('resolves Anthropic model ID to agentType="claude-code" with thinking enabled', async () => {
      const { getModelInfo, fetchAgentCapabilities } = useModelInfo();
      await fetchAgentCapabilities();

      const info = getModelInfo('claude-sonnet-4-6');
      expect(info.agentType).toBe('claude-code');
      expect(info.capabilities.thinking).toBe(true);
      expect(info.providerId).toBe('anthropic-default');
      expect(info.providerName).toBe('Anthropic (Official)');
    });

    it('unknown model IDs default to claude-code agent with graceful defaults', async () => {
      const { getModelInfo, fetchAgentCapabilities } = useModelInfo();
      await fetchAgentCapabilities();

      const info = getModelInfo('never-heard-of-this-model');
      expect(info.agentType).toBe('claude-code');
      expect(info.providerId).toBeNull();
      expect(info.providerName).toBeNull();
      // Name falls back to formatModelId; does not crash.
      expect(info.name).toBe('Never Heard Of This Model');
    });

    it('caches /api/agents across calls (second call does not refetch)', async () => {
      const { getModelInfo, fetchAgentCapabilities } = useModelInfo();
      await fetchAgentCapabilities();

      expect(getAgentsSpy).toHaveBeenCalledTimes(1);

      // Multiple subsequent getModelInfo calls must NOT trigger additional
      // /api/agents fetches.
      getModelInfo('gpt-4o');
      getModelInfo('claude-sonnet-4-6');
      await fetchAgentCapabilities();

      expect(getAgentsSpy).toHaveBeenCalledTimes(1);
    });
  });
});
