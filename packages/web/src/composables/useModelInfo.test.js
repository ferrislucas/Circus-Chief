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

    it('returns "Unknown" for unrecognized model ID', () => {
      const { getModelDisplayName } = useModelInfo();
      expect(getModelDisplayName('some-unknown-model')).toBe('Unknown');
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

    it('returns empty string for unrecognized model ID', () => {
      const { getModelDescription } = useModelInfo();
      expect(getModelDescription('unknown-model')).toBe('');
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

    it('returns Unknown name with empty description for unrecognized model', () => {
      const { getModelInfo } = useModelInfo();
      const info = getModelInfo('unknown-model-id');

      expect(info).toEqual({
        name: 'Unknown',
        description: '',
      });
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
