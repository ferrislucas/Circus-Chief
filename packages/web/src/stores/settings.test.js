import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from './settings.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getTokenCostWeights: vi.fn(),
    updateTokenCostWeights: vi.fn(),
    resetTokenCostWeights: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('Settings Store', () => {
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('state', () => {
    it('has correct initial state', () => {
      const store = useSettingsStore();
      expect(store.tokenCostWeights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('weights getter', () => {
    it('returns current token cost weights', () => {
      const store = useSettingsStore();
      const customWeights = {
        input: 2.0,
        output: 10.0,
        cacheRead: 0.5,
        cacheCreation: 2.0,
      };
      store.tokenCostWeights = customWeights;

      expect(store.weights).toEqual(customWeights);
    });

    it('returns default weights initially', () => {
      const store = useSettingsStore();
      expect(store.weights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });
  });

  describe('fetchTokenCostWeights action', () => {
    it('fetches weights from API and updates state', async () => {
      const store = useSettingsStore();
      const customWeights = {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.2,
        cacheCreation: 1.5,
      };
      api.getTokenCostWeights.mockResolvedValue(customWeights);

      await store.fetchTokenCostWeights();

      expect(api.getTokenCostWeights).toHaveBeenCalledOnce();
      expect(store.tokenCostWeights).toEqual(customWeights);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets loading state during fetch', async () => {
      const store = useSettingsStore();
      let loadingDuringFetch = false;

      api.getTokenCostWeights.mockImplementation(async () => {
        // Capture loading state during the async operation
        loadingDuringFetch = store.loading;
        return DEFAULT_TOKEN_COST_WEIGHTS;
      });

      await store.fetchTokenCostWeights();

      expect(loadingDuringFetch).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('handles fetch errors gracefully', async () => {
      const store = useSettingsStore();
      const errorMessage = 'Network error';
      api.getTokenCostWeights.mockRejectedValue(new Error(errorMessage));

      await store.fetchTokenCostWeights();

      expect(store.error).toBe(errorMessage);
      expect(store.tokenCostWeights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(store.loading).toBe(false);
    });

    it('falls back to defaults on error', async () => {
      const store = useSettingsStore();
      // Set custom weights first
      store.tokenCostWeights = {
        input: 10.0,
        output: 20.0,
        cacheRead: 5.0,
        cacheCreation: 15.0,
      };

      api.getTokenCostWeights.mockRejectedValue(new Error('Server error'));

      await store.fetchTokenCostWeights();

      expect(store.tokenCostWeights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });
  });

  describe('updateTokenCostWeights action', () => {
    it('updates weights via API and updates state', async () => {
      const store = useSettingsStore();
      const newWeights = {
        input: 3.0,
        output: 12.0,
        cacheRead: 0.4,
        cacheCreation: 2.5,
      };
      api.updateTokenCostWeights.mockResolvedValue(newWeights);

      const result = await store.updateTokenCostWeights(newWeights);

      expect(api.updateTokenCostWeights).toHaveBeenCalledWith(newWeights);
      expect(store.tokenCostWeights).toEqual(newWeights);
      expect(result).toEqual(newWeights);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets loading state during update', async () => {
      const store = useSettingsStore();
      let loadingDuringUpdate = false;

      api.updateTokenCostWeights.mockImplementation(async (weights) => {
        loadingDuringUpdate = store.loading;
        return weights;
      });

      await store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS);

      expect(loadingDuringUpdate).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('handles update errors by setting error state', async () => {
      const store = useSettingsStore();
      const errorMessage = 'Validation failed';
      api.updateTokenCostWeights.mockRejectedValue(new Error(errorMessage));

      await expect(
        store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS)
      ).rejects.toThrow(errorMessage);

      expect(store.error).toBe(errorMessage);
      expect(store.loading).toBe(false);
    });

    it('does not update state on error', async () => {
      const store = useSettingsStore();
      const originalWeights = { ...store.tokenCostWeights };

      api.updateTokenCostWeights.mockRejectedValue(new Error('Failed'));

      try {
        await store.updateTokenCostWeights({
          input: 999,
          output: 999,
          cacheRead: 999,
          cacheCreation: 999,
        });
      } catch {
        // Expected to throw
      }

      expect(store.tokenCostWeights).toEqual(originalWeights);
    });

    it('returns updated weights on success', async () => {
      const store = useSettingsStore();
      const newWeights = {
        input: 2.5,
        output: 9.0,
        cacheRead: 0.3,
        cacheCreation: 1.8,
      };
      api.updateTokenCostWeights.mockResolvedValue(newWeights);

      const result = await store.updateTokenCostWeights(newWeights);

      expect(result).toEqual(newWeights);
    });
  });

  describe('resetTokenCostWeights action', () => {
    it('resets weights to defaults via API', async () => {
      const store = useSettingsStore();
      // Set custom weights first
      store.tokenCostWeights = {
        input: 10.0,
        output: 20.0,
        cacheRead: 5.0,
        cacheCreation: 15.0,
      };

      api.resetTokenCostWeights.mockResolvedValue(DEFAULT_TOKEN_COST_WEIGHTS);

      const result = await store.resetTokenCostWeights();

      expect(api.resetTokenCostWeights).toHaveBeenCalledOnce();
      expect(store.tokenCostWeights).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(result).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('sets loading state during reset', async () => {
      const store = useSettingsStore();
      let loadingDuringReset = false;

      api.resetTokenCostWeights.mockImplementation(async () => {
        loadingDuringReset = store.loading;
        return DEFAULT_TOKEN_COST_WEIGHTS;
      });

      await store.resetTokenCostWeights();

      expect(loadingDuringReset).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('handles reset errors by setting error state', async () => {
      const store = useSettingsStore();
      const errorMessage = 'Reset failed';
      api.resetTokenCostWeights.mockRejectedValue(new Error(errorMessage));

      await expect(store.resetTokenCostWeights()).rejects.toThrow(errorMessage);

      expect(store.error).toBe(errorMessage);
      expect(store.loading).toBe(false);
    });

    it('does not update state on error', async () => {
      const store = useSettingsStore();
      const customWeights = {
        input: 5.0,
        output: 15.0,
        cacheRead: 2.0,
        cacheCreation: 3.0,
      };
      store.tokenCostWeights = customWeights;

      api.resetTokenCostWeights.mockRejectedValue(new Error('Failed'));

      try {
        await store.resetTokenCostWeights();
      } catch {
        // Expected to throw
      }

      expect(store.tokenCostWeights).toEqual(customWeights);
    });
  });

  describe('Error handling and state management', () => {
    it('clears error on successful operation after previous error', async () => {
      const store = useSettingsStore();

      // First, cause an error
      api.updateTokenCostWeights.mockRejectedValue(new Error('Error 1'));
      try {
        await store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS);
      } catch {
        // Expected
      }
      expect(store.error).toBe('Error 1');

      // Then, perform successful operation
      api.updateTokenCostWeights.mockResolvedValue(DEFAULT_TOKEN_COST_WEIGHTS);
      await store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS);

      expect(store.error).toBeNull();
    });

    it('loading flag is always false after operation completes', async () => {
      const store = useSettingsStore();

      // Test successful fetch
      api.getTokenCostWeights.mockResolvedValue(DEFAULT_TOKEN_COST_WEIGHTS);
      await store.fetchTokenCostWeights();
      expect(store.loading).toBe(false);

      // Test failed fetch
      api.getTokenCostWeights.mockRejectedValue(new Error('Fail'));
      await store.fetchTokenCostWeights();
      expect(store.loading).toBe(false);

      // Test successful update
      api.updateTokenCostWeights.mockResolvedValue(DEFAULT_TOKEN_COST_WEIGHTS);
      await store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS);
      expect(store.loading).toBe(false);

      // Test failed update
      api.updateTokenCostWeights.mockRejectedValue(new Error('Fail'));
      try {
        await store.updateTokenCostWeights(DEFAULT_TOKEN_COST_WEIGHTS);
      } catch {
        // Expected
      }
      expect(store.loading).toBe(false);
    });
  });
});
