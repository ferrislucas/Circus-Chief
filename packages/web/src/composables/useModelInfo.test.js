import { describe, it, expect } from 'vitest';
import { useModelInfo } from './useModelInfo.js';

describe('useModelInfo', () => {
  describe('getModelDisplayName', () => {
    it('returns "Opus 4.6" for claude-opus-4-6', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('claude-opus-4-6')).toBe('Opus 4.6');
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
    it('returns "Most capable (default)" for Opus model', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('claude-opus-4-6')).toBe('Most capable (default)');
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
    it('returns object with name and description for valid model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-opus-4-6');

      expect(info).toEqual({
        name: 'Opus 4.6',
        description: 'Most capable (default)',
      });
    });

    it('returns object with name and description for Sonnet', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-sonnet-4-6');

      expect(info).toEqual({
        name: 'Sonnet 4.6',
        description: 'Balanced',
      });
    });

    it('returns object with name and description for Haiku', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('claude-haiku-4-5-20251001');

      expect(info).toEqual({
        name: 'Haiku 4.5',
        description: 'Fast & lightweight',
      });
    });

    it('returns Default name with default description for null model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo(null);

      expect(info).toEqual({
        name: 'Default',
        description: 'Most capable (default)',
      });
    });

    it('returns formatted name with raw model ID as description for unrecognized model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('unknown-model-id');

      expect(info).toEqual({
        name: 'Unknown Model Id',
        description: 'unknown-model-id',
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
});
