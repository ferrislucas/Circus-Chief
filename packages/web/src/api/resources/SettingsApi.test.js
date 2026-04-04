import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('SettingsApi', () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    client = new ApiClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockResponse = (data, options = {}) => {
    return Promise.resolve({
      ok: options.ok !== undefined ? options.ok : true,
      status: options.status || 200,
      json: () => Promise.resolve(data),
    });
  };

  describe('Token Cost Weights', () => {
    describe('getTokenCostWeights', () => {
      it('sends GET to /settings/token-weights', async () => {
        const weights = { input: 1, output: 3, cacheRead: 0.1, cacheCreation: 1.25 };
        mockFetch.mockReturnValue(mockResponse(weights));

        const result = await client.getTokenCostWeights();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/token-weights', expect.objectContaining({ method: 'GET' }));
        expect(result).toEqual(weights);
      });
    });

    describe('updateTokenCostWeights', () => {
      it('sends PUT to /settings/token-weights', async () => {
        const weights = { input: 2, output: 6, cacheRead: 0.2, cacheCreation: 2.5 };
        mockFetch.mockReturnValue(mockResponse(weights));

        await client.updateTokenCostWeights(weights);

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/token-weights', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(weights),
        }));
      });
    });

    describe('resetTokenCostWeights', () => {
      it('sends DELETE to /settings/token-weights', async () => {
        mockFetch.mockReturnValue(mockResponse({ input: 1, output: 3, cacheRead: 0.1, cacheCreation: 1.25 }));

        await client.resetTokenCostWeights();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/token-weights', expect.objectContaining({ method: 'DELETE' }));
      });
    });
  });

  describe('Summary Settings', () => {
    describe('getSummarySettings', () => {
      it('sends GET to /settings/summary', async () => {
        const settings = { disableSessionSummaries: false, sessionTitlePrompt: '' };
        mockFetch.mockReturnValue(mockResponse(settings));

        const result = await client.getSummarySettings();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/summary', expect.any(Object));
        expect(result).toEqual(settings);
      });
    });

    describe('updateSummarySettings', () => {
      it('sends PUT to /settings/summary', async () => {
        const settings = { disableSessionSummaries: true };
        mockFetch.mockReturnValue(mockResponse(settings));

        await client.updateSummarySettings(settings);

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/summary', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(settings),
        }));
      });
    });

    describe('resetSummarySettings', () => {
      it('sends DELETE to /settings/summary', async () => {
        mockFetch.mockReturnValue(mockResponse({}));

        await client.resetSummarySettings();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/summary', expect.objectContaining({ method: 'DELETE' }));
      });
    });
  });

  describe('General Settings', () => {
    describe('getGeneralSettings', () => {
      it('sends GET to /settings/general', async () => {
        mockFetch.mockReturnValue(mockResponse({ disableAnalytics: false }));

        const result = await client.getGeneralSettings();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/general', expect.objectContaining({ method: 'GET' }));
        expect(result.disableAnalytics).toBe(false);
      });
    });

    describe('updateGeneralSettings', () => {
      it('sends PUT to /settings/general', async () => {
        const settings = { disableAnalytics: true };
        mockFetch.mockReturnValue(mockResponse(settings));

        const result = await client.updateGeneralSettings(settings);

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/general', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(settings),
        }));
        expect(result.disableAnalytics).toBe(true);
      });

      it('handles validation errors', async () => {
        mockFetch.mockReturnValue(mockResponse(
          { error: 'Invalid general settings' },
          { ok: false, status: 400 },
        ));

        await expect(client.updateGeneralSettings({ disableAnalytics: 'bad' }))
          .rejects.toThrow('Invalid general settings');
      });
    });

    describe('resetGeneralSettings', () => {
      it('sends DELETE to /settings/general and returns defaults', async () => {
        mockFetch.mockReturnValue(mockResponse({ disableAnalytics: false }));

        const result = await client.resetGeneralSettings();

        expect(mockFetch).toHaveBeenCalledWith('/api/settings/general', expect.objectContaining({ method: 'DELETE' }));
        expect(result.disableAnalytics).toBe(false);
      });
    });
  });
});
