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
});
