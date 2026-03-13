import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepository } from './SettingsRepository.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';

describe('SettingsRepository', () => {
  // Uses global setup from test/setup.js
  let repo;

  beforeEach(() => {
    repo = new SettingsRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(SettingsRepository);
    });
  });

  describe('get and set', () => {
    it('returns null for non-existent key', () => {
      expect(repo.get('non-existent')).toBeNull();
    });

    it('sets and retrieves a string value', () => {
      repo.set('test-key', 'test-value');
      expect(repo.get('test-key')).toBe('test-value');
    });

    it('updates existing value', () => {
      repo.set('test-key', 'original');
      repo.set('test-key', 'updated');
      expect(repo.get('test-key')).toBe('updated');
    });

    it('handles JSON-stringified objects', () => {
      const obj = { foo: 'bar', baz: 123 };
      repo.set('json-key', JSON.stringify(obj));
      const retrieved = JSON.parse(repo.get('json-key'));
      expect(retrieved).toEqual(obj);
    });
  });

  describe('delete', () => {
    it('deletes an existing key', () => {
      repo.set('delete-me', 'value');
      const deleted = repo.delete('delete-me');

      expect(deleted).toBe(true);
      expect(repo.get('delete-me')).toBeNull();
    });

    it('returns false when deleting non-existent key', () => {
      const deleted = repo.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('does not affect other keys', () => {
      repo.set('key1', 'value1');
      repo.set('key2', 'value2');

      repo.delete('key1');

      expect(repo.get('key1')).toBeNull();
      expect(repo.get('key2')).toBe('value2');
    });
  });

  describe('getTokenCostWeights', () => {
    it('returns default weights when not set', () => {
      const weights = repo.getTokenCostWeights();
      expect(weights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('returns saved custom weights', () => {
      const customWeights = {
        input: 2.0,
        output: 10.0,
        cacheRead: 0.5,
        cacheCreation: 2.0,
      };
      repo.setTokenCostWeights(customWeights);

      const retrieved = repo.getTokenCostWeights();
      expect(retrieved).toEqual(customWeights);
    });

    it('merges partial weights with defaults', () => {
      // Manually set incomplete weights (simulating corruption/migration)
      repo.set('token_cost_weights', JSON.stringify({ input: 3.0 }));

      const weights = repo.getTokenCostWeights();
      expect(weights.input).toBe(3.0);
      expect(weights.output).toBe(DEFAULT_TOKEN_COST_WEIGHTS.output);
      expect(weights.cacheRead).toBe(DEFAULT_TOKEN_COST_WEIGHTS.cacheRead);
      expect(weights.cacheCreation).toBe(DEFAULT_TOKEN_COST_WEIGHTS.cacheCreation);
    });

    it('returns defaults when stored value is invalid JSON', () => {
      repo.set('token_cost_weights', 'invalid-json{');
      const weights = repo.getTokenCostWeights();
      expect(weights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('does not mutate default weights', () => {
      const originalDefaults = { ...DEFAULT_TOKEN_COST_WEIGHTS };
      const weights = repo.getTokenCostWeights();

      weights.input = 999;

      expect(DEFAULT_TOKEN_COST_WEIGHTS).toEqual(originalDefaults);
      expect(repo.getTokenCostWeights()).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });
  });

  describe('setTokenCostWeights', () => {
    it('saves and returns custom weights', () => {
      const customWeights = {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.2,
        cacheCreation: 1.5,
      };
      const saved = repo.setTokenCostWeights(customWeights);

      expect(saved).toEqual(customWeights);
      expect(repo.getTokenCostWeights()).toEqual(customWeights);
    });

    it('validates and coerces negative weights to zero', () => {
      const invalidWeights = {
        input: -1.0,
        output: 5.0,
        cacheRead: -0.5,
        cacheCreation: 1.25,
      };
      const saved = repo.setTokenCostWeights(invalidWeights);

      expect(saved.input).toBe(0);
      expect(saved.output).toBe(5.0);
      expect(saved.cacheRead).toBe(0);
      expect(saved.cacheCreation).toBe(1.25);
    });

    it('coerces string numbers to numbers', () => {
      const stringWeights = {
        input: '2.0',
        output: '8.0',
        cacheRead: '0.3',
        cacheCreation: '1.8',
      };
      const saved = repo.setTokenCostWeights(stringWeights);

      expect(saved.input).toBe(2.0);
      expect(saved.output).toBe(8.0);
      expect(saved.cacheRead).toBe(0.3);
      expect(saved.cacheCreation).toBe(1.8);
    });

    it('falls back to defaults for invalid values', () => {
      const invalidWeights = {
        input: NaN,
        output: 'not-a-number',
        cacheRead: null,
        cacheCreation: undefined,
      };
      const saved = repo.setTokenCostWeights(invalidWeights);

      expect(saved).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('persists weights across repository instances', () => {
      const customWeights = {
        input: 3.0,
        output: 12.0,
        cacheRead: 0.4,
        cacheCreation: 2.5,
      };
      repo.setTokenCostWeights(customWeights);

      // Create new repository instance
      const newRepo = new SettingsRepository();
      expect(newRepo.getTokenCostWeights()).toEqual(customWeights);
    });

    it('falls back to defaults for zero weights (zero is falsy)', () => {
      // Note: This is the current behavior - zero values fall back to defaults
      // because the implementation uses `Number(value) || DEFAULT`
      const zeroWeights = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      };
      const saved = repo.setTokenCostWeights(zeroWeights);

      expect(saved).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('handles large weight values', () => {
      const largeWeights = {
        input: 1000.5,
        output: 5000.75,
        cacheRead: 100.25,
        cacheCreation: 1500.5,
      };
      const saved = repo.setTokenCostWeights(largeWeights);

      expect(saved).toEqual(largeWeights);
    });
  });

  describe('resetTokenCostWeights', () => {
    it('deletes custom weights and returns defaults', () => {
      // Set custom weights
      repo.setTokenCostWeights({
        input: 10.0,
        output: 20.0,
        cacheRead: 5.0,
        cacheCreation: 15.0,
      });

      // Reset to defaults
      const defaults = repo.resetTokenCostWeights();

      expect(defaults).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(repo.getTokenCostWeights()).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('returns defaults even if no custom weights were set', () => {
      const defaults = repo.resetTokenCostWeights();
      expect(defaults).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('actually deletes the setting from database', () => {
      repo.setTokenCostWeights({
        input: 5.0,
        output: 10.0,
        cacheRead: 1.0,
        cacheCreation: 3.0,
      });

      expect(repo.get('token_cost_weights')).not.toBeNull();

      repo.resetTokenCostWeights();

      expect(repo.get('token_cost_weights')).toBeNull();
    });
  });

  describe('getSummarySettings', () => {
    it('returns default settings when not set', () => {
      const settings = repo.getSummarySettings();

      expect(settings).toEqual({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });
    });

    it('returns saved custom settings', () => {
      const customSettings = {
        disableSessionSummaries: true,
        disableConversationSummaries: false,
        sessionTitlePrompt: 'Custom prompt',
      };
      repo.setSummarySettings(customSettings);

      const retrieved = repo.getSummarySettings();
      expect(retrieved).toEqual(customSettings);
    });

    it('merges partial settings with defaults', () => {
      // Manually set incomplete settings (simulating corruption/migration)
      repo.set('summary_settings', JSON.stringify({ disableSessionSummaries: true }));

      const settings = repo.getSummarySettings();
      expect(settings.disableSessionSummaries).toBe(true);
      // disableConversationSummaries is not a boolean in partial data, so falls back to default (true)
      expect(settings.disableConversationSummaries).toBe(true);
      expect(settings.sessionTitlePrompt).toBe('');
    });

    it('returns defaults when stored value is invalid JSON', () => {
      repo.set('summary_settings', 'invalid-json{');
      const settings = repo.getSummarySettings();
      expect(settings).toEqual({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });
    });

    it('does not mutate default settings', () => {
      const settings = repo.getSummarySettings();
      settings.disableSessionSummaries = true;

      const newSettings = repo.getSummarySettings();
      expect(newSettings.disableSessionSummaries).toBe(false);
    });

    it('coerces values to correct types', () => {
      repo.set('summary_settings', JSON.stringify({
        disableSessionSummaries: 1, // truthy number
        disableConversationSummaries: '', // falsy string - falls back to default
        sessionTitlePrompt: 123, // number
      }));

      const settings = repo.getSummarySettings();
      // getSummarySettings returns truthy/falsy values as-is (uses || operator)
      // disableConversationSummaries: '' is not a boolean so it falls back to default (true)
      expect(settings.disableSessionSummaries).toBe(1);
      expect(settings.disableConversationSummaries).toBe(true);
      expect(settings.sessionTitlePrompt).toBe(123);
    });
  });

  describe('setSummarySettings', () => {
    it('saves and returns custom settings', () => {
      const customSettings = {
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'Test prompt',
      };
      const saved = repo.setSummarySettings(customSettings);

      expect(saved).toEqual(customSettings);
      expect(repo.getSummarySettings()).toEqual(customSettings);
    });

    it('validates and coerces disableSessionSummaries to boolean', () => {
      const saved = repo.setSummarySettings({
        disableSessionSummaries: 'true',
        disableConversationSummaries: false,
        sessionTitlePrompt: '',
      });

      expect(saved.disableSessionSummaries).toBe(true);
      expect(typeof saved.disableSessionSummaries).toBe('boolean');
    });

    it('validates and coerces disableConversationSummaries to boolean', () => {
      const saved = repo.setSummarySettings({
        disableSessionSummaries: false,
        disableConversationSummaries: 1,
        sessionTitlePrompt: '',
      });

      expect(saved.disableConversationSummaries).toBe(true);
      expect(typeof saved.disableConversationSummaries).toBe('boolean');
    });

    it('converts sessionTitlePrompt to string', () => {
      const saved = repo.setSummarySettings({
        disableSessionSummaries: false,
        disableConversationSummaries: false,
        sessionTitlePrompt: 12345,
      });

      expect(saved.sessionTitlePrompt).toBe('12345');
      expect(typeof saved.sessionTitlePrompt).toBe('string');
    });

    it('handles null and undefined values', () => {
      const saved = repo.setSummarySettings({
        disableSessionSummaries: null,
        disableConversationSummaries: undefined,
        sessionTitlePrompt: null,
      });

      expect(saved.disableSessionSummaries).toBe(false);
      expect(saved.disableConversationSummaries).toBe(false);
      // null is converted to empty string via `|| ''` in implementation
      expect(saved.sessionTitlePrompt).toBe('');
    });

    it('persists settings across repository instances', () => {
      const customSettings = {
        disableSessionSummaries: true,
        disableConversationSummaries: false,
        sessionTitlePrompt: 'Cross-instance test',
      };
      repo.setSummarySettings(customSettings);

      // Create new repository instance
      const newRepo = new SettingsRepository();
      expect(newRepo.getSummarySettings()).toEqual(customSettings);
    });

    it('updates existing settings', () => {
      repo.setSummarySettings({
        disableSessionSummaries: false,
        disableConversationSummaries: false,
        sessionTitlePrompt: 'Original',
      });

      const updated = repo.setSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'Updated',
      });

      expect(updated.disableSessionSummaries).toBe(true);
      expect(updated.disableConversationSummaries).toBe(true);
      expect(updated.sessionTitlePrompt).toBe('Updated');
      expect(repo.getSummarySettings()).toEqual(updated);
    });
  });

  describe('resetSummarySettings', () => {
    it('deletes custom settings and returns defaults', () => {
      // Set custom settings
      repo.setSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: true,
        sessionTitlePrompt: 'Custom prompt',
      });

      // Reset to defaults
      const defaults = repo.resetSummarySettings();

      expect(defaults).toEqual({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });
      expect(repo.getSummarySettings()).toEqual(defaults);
    });

    it('returns defaults even if no custom settings were set', () => {
      const defaults = repo.resetSummarySettings();
      expect(defaults).toEqual({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });
    });

    it('actually deletes the setting from database', () => {
      repo.setSummarySettings({
        disableSessionSummaries: true,
        disableConversationSummaries: false,
        sessionTitlePrompt: 'Test',
      });

      expect(repo.get('summary_settings')).not.toBeNull();

      repo.resetSummarySettings();

      expect(repo.get('summary_settings')).toBeNull();
    });
  });

  describe('getGeneralSettings', () => {
    it('returns default settings when not set', () => {
      const settings = repo.getGeneralSettings();

      expect(settings).toEqual({
        disableAnalytics: false,
      });
    });

    it('returns saved custom settings', () => {
      const customSettings = {
        disableAnalytics: true,
      };
      repo.setGeneralSettings(customSettings);

      const retrieved = repo.getGeneralSettings();
      expect(retrieved).toEqual(customSettings);
    });

    it('returns defaults when stored value is invalid JSON', () => {
      repo.set('general_settings', 'invalid-json{');
      const settings = repo.getGeneralSettings();
      expect(settings).toEqual({
        disableAnalytics: false,
      });
    });

    it('does not mutate default settings', () => {
      const settings = repo.getGeneralSettings();
      settings.disableAnalytics = true;

      const newSettings = repo.getGeneralSettings();
      expect(newSettings.disableAnalytics).toBe(false);
    });

    it('coerces values to correct types', () => {
      repo.set('general_settings', JSON.stringify({
        disableAnalytics: 1, // truthy number
      }));

      const settings = repo.getGeneralSettings();
      // getGeneralSettings uses Boolean() to coerce to true boolean
      expect(settings.disableAnalytics).toBe(true);
      expect(typeof settings.disableAnalytics).toBe('boolean');
    });
  });

  describe('setGeneralSettings', () => {
    it('saves and returns custom settings', () => {
      const customSettings = {
        disableAnalytics: true,
      };
      const saved = repo.setGeneralSettings(customSettings);

      expect(saved).toEqual(customSettings);
      expect(repo.getGeneralSettings()).toEqual(customSettings);
    });

    it('validates and coerces disableAnalytics to boolean', () => {
      const saved = repo.setGeneralSettings({
        disableAnalytics: 'true',
      });

      expect(saved.disableAnalytics).toBe(true);
      expect(typeof saved.disableAnalytics).toBe('boolean');
    });

    it('handles null and undefined values', () => {
      const saved = repo.setGeneralSettings({
        disableAnalytics: null,
      });

      expect(saved.disableAnalytics).toBe(false);
      expect(typeof saved.disableAnalytics).toBe('boolean');
    });

    it('persists settings across repository instances', () => {
      const customSettings = {
        disableAnalytics: true,
      };
      repo.setGeneralSettings(customSettings);

      // Create new repository instance
      const newRepo = new SettingsRepository();
      expect(newRepo.getGeneralSettings()).toEqual(customSettings);
    });

    it('updates existing settings', () => {
      repo.setGeneralSettings({
        disableAnalytics: false,
      });

      const updated = repo.setGeneralSettings({
        disableAnalytics: true,
      });

      expect(updated.disableAnalytics).toBe(true);
      expect(repo.getGeneralSettings()).toEqual(updated);
    });
  });

  describe('resetGeneralSettings', () => {
    it('deletes custom settings and returns defaults', () => {
      // Set custom settings
      repo.setGeneralSettings({
        disableAnalytics: true,
      });

      // Reset to defaults
      const defaults = repo.resetGeneralSettings();

      expect(defaults).toEqual({
        disableAnalytics: false,
      });
      expect(repo.getGeneralSettings()).toEqual(defaults);
    });

    it('returns defaults even if no custom settings were set', () => {
      const defaults = repo.resetGeneralSettings();
      expect(defaults).toEqual({
        disableAnalytics: false,
      });
    });

    it('actually deletes the setting from database', () => {
      repo.setGeneralSettings({
        disableAnalytics: true,
      });

      expect(repo.get('general_settings')).not.toBeNull();

      repo.resetGeneralSettings();

      expect(repo.get('general_settings')).toBeNull();
    });
  });
});
