import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';
import { settings } from '../db/index.js';
import settingsRouter from './settings.js';

// Use a generous timeout to avoid flakiness during full-suite runs
// where GC pressure and event-loop contention cause sporadic slowdowns.
describe('Settings API', { timeout: 30_000 }, () => {
  let app;
  let server;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);
    server = app.listen(0);

    // Reset token weights to defaults before each test
    settings.resetTokenCostWeights();
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('GET /api/settings/token-weights', () => {
    it('returns default weights when not customized', async () => {
      const res = await request(server).get('/api/settings/token-weights');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('returns custom weights when set', async () => {
      const customWeights = {
        input: 2.0,
        output: 10.0,
        cacheRead: 0.5,
        cacheCreation: 2.0,
      };
      settings.setTokenCostWeights(customWeights);

      const res = await request(server).get('/api/settings/token-weights');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(customWeights);
    });

    it('handles errors gracefully', async () => {
      // Force an error by breaking the database connection
      const originalGet = settings.getTokenCostWeights;
      settings.getTokenCostWeights = () => {
        throw new Error('Database error');
      };

      const res = await request(server).get('/api/settings/token-weights');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get token weights');

      // Restore original method
      settings.getTokenCostWeights = originalGet;
    });
  });

  describe('PUT /api/settings/token-weights', () => {
    it('updates and returns new weights', async () => {
      const newWeights = {
        input: 1.5,
        output: 7.5,
        cacheRead: 0.2,
        cacheCreation: 1.5,
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(newWeights);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(newWeights);

      // Verify weights are persisted
      const retrieved = settings.getTokenCostWeights();
      expect(retrieved).toEqual(newWeights);
    });

    it('validates all required fields are numbers', async () => {
      const invalidWeights = {
        input: 1.0,
        output: 'not-a-number',
        cacheRead: 0.1,
        cacheCreation: 1.25,
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(invalidWeights);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be numbers');
    });

    it('validates all required fields are present', async () => {
      const incompleteWeights = {
        input: 1.0,
        output: 5.0,
        // missing cacheRead and cacheCreation
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(incompleteWeights);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be numbers');
    });

    it('validates weights are non-negative', async () => {
      const negativeWeights = {
        input: -1.0,
        output: 5.0,
        cacheRead: 0.1,
        cacheCreation: 1.25,
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(negativeWeights);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-negative');
    });

    it('accepts zero values', async () => {
      // Note: The repository layer falls back to defaults for zero values,
      // but the API layer should accept them (validation passes)
      const zeroWeights = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(zeroWeights);

      expect(res.status).toBe(200);
      // The actual returned values will be defaults due to repository behavior
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('accepts decimal values', async () => {
      const decimalWeights = {
        input: 1.234,
        output: 5.678,
        cacheRead: 0.123,
        cacheCreation: 1.456,
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(decimalWeights);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(decimalWeights);
    });

    it('handles errors gracefully', async () => {
      const originalSet = settings.setTokenCostWeights;
      settings.setTokenCostWeights = () => {
        throw new Error('Database error');
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(DEFAULT_TOKEN_COST_WEIGHTS);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to update token weights');

      settings.setTokenCostWeights = originalSet;
    });

    it('rejects request with missing body', async () => {
      const res = await request(server)
        .put('/api/settings/token-weights')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be numbers');
    });

    it('ignores extra fields', async () => {
      const weightsWithExtra = {
        input: 2.0,
        output: 8.0,
        cacheRead: 0.3,
        cacheCreation: 1.8,
        extraField: 'ignored',
      };

      const res = await request(server)
        .put('/api/settings/token-weights')
        .send(weightsWithExtra);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        input: 2.0,
        output: 8.0,
        cacheRead: 0.3,
        cacheCreation: 1.8,
      });
    });
  });

  describe('DELETE /api/settings/token-weights', () => {
    it('resets weights to defaults', async () => {
      // First set custom weights
      settings.setTokenCostWeights({
        input: 10.0,
        output: 20.0,
        cacheRead: 5.0,
        cacheCreation: 15.0,
      });

      // Then reset
      const res = await request(server).delete('/api/settings/token-weights');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);

      // Verify weights are actually reset
      const retrieved = settings.getTokenCostWeights();
      expect(retrieved).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('returns defaults even if no custom weights were set', async () => {
      const res = await request(server).delete('/api/settings/token-weights');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });

    it('handles errors gracefully', async () => {
      const originalReset = settings.resetTokenCostWeights;
      settings.resetTokenCostWeights = () => {
        throw new Error('Database error');
      };

      const res = await request(server).delete('/api/settings/token-weights');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to reset token weights');

      settings.resetTokenCostWeights = originalReset;
    });
  });

  describe('Integration: Full lifecycle', () => {
    it('GET -> PUT -> GET -> DELETE -> GET', async () => {
      // 1. Get defaults
      let res = await request(server).get('/api/settings/token-weights');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);

      // 2. Update to custom
      const customWeights = {
        input: 3.0,
        output: 12.0,
        cacheRead: 0.4,
        cacheCreation: 2.5,
      };
      res = await request(server)
        .put('/api/settings/token-weights')
        .send(customWeights);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(customWeights);

      // 3. Get custom
      res = await request(server).get('/api/settings/token-weights');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(customWeights);

      // 4. Reset to defaults
      res = await request(server).delete('/api/settings/token-weights');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);

      // 5. Get defaults again
      res = await request(server).get('/api/settings/token-weights');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_TOKEN_COST_WEIGHTS);
    });
  });

  describe('GET /api/settings/general', () => {
    it('returns default settings when not customized', async () => {
      const res = await request(server).get('/api/settings/general');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });
    });

    it('returns custom settings when set', async () => {
      const customSettings = {
        disableAnalytics: true,
      };
      settings.setGeneralSettings(customSettings);

      const res = await request(server).get('/api/settings/general');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(customSettings);
    });

    it('handles errors gracefully', async () => {
      // Force an error by breaking the database connection
      const originalGet = settings.getGeneralSettings;
      settings.getGeneralSettings = () => {
        throw new Error('Database error');
      };

      const res = await request(server).get('/api/settings/general');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get general settings');

      // Restore original method
      settings.getGeneralSettings = originalGet;
    });
  });

  describe('PUT /api/settings/general', () => {
    it('updates and returns new settings', async () => {
      const newSettings = {
        disableAnalytics: true,
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send(newSettings);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(newSettings);

      // Verify settings are persisted
      const retrieved = settings.getGeneralSettings();
      expect(retrieved).toEqual(newSettings);
    });

    it('validates disableAnalytics is a boolean', async () => {
      const invalidSettings = {
        disableAnalytics: 'not-a-boolean',
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send(invalidSettings);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be a boolean');
    });

    it('accepts false value for disableAnalytics', async () => {
      const newSettings = {
        disableAnalytics: false,
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send(newSettings);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(newSettings);
    });

    it('accepts true value for disableAnalytics', async () => {
      const newSettings = {
        disableAnalytics: true,
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send(newSettings);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(newSettings);
    });

    it('handles errors gracefully', async () => {
      const originalSet = settings.setGeneralSettings;
      settings.setGeneralSettings = () => {
        throw new Error('Database error');
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send({ disableAnalytics: false });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to update general settings');

      settings.setGeneralSettings = originalSet;
    });

    it('rejects request with missing body', async () => {
      const res = await request(server)
        .put('/api/settings/general')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be a boolean');
    });

    it('ignores extra fields', async () => {
      const settingsWithExtra = {
        disableAnalytics: true,
        extraField: 'ignored',
      };

      const res = await request(server)
        .put('/api/settings/general')
        .send(settingsWithExtra);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: true,
      });
    });
  });

  describe('DELETE /api/settings/general', () => {
    it('resets settings to defaults', async () => {
      // First set custom settings
      settings.setGeneralSettings({
        disableAnalytics: true,
      });

      // Then reset
      const res = await request(server).delete('/api/settings/general');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });

      // Verify settings are actually reset
      const retrieved = settings.getGeneralSettings();
      expect(retrieved).toEqual({
        disableAnalytics: false,
      });
    });

    it('returns defaults even if no custom settings were set', async () => {
      const res = await request(server).delete('/api/settings/general');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });
    });

    it('handles errors gracefully', async () => {
      const originalReset = settings.resetGeneralSettings;
      settings.resetGeneralSettings = () => {
        throw new Error('Database error');
      };

      const res = await request(server).delete('/api/settings/general');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to reset general settings');

      settings.resetGeneralSettings = originalReset;
    });
  });

  describe('Integration: General settings full lifecycle', () => {
    it('GET -> PUT -> GET -> DELETE -> GET', async () => {
      // 1. Get defaults
      let res = await request(server).get('/api/settings/general');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });

      // 2. Update to custom
      const customSettings = {
        disableAnalytics: true,
      };
      res = await request(server)
        .put('/api/settings/general')
        .send(customSettings);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(customSettings);

      // 3. Get custom
      res = await request(server).get('/api/settings/general');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(customSettings);

      // 4. Reset to defaults
      res = await request(server).delete('/api/settings/general');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });

      // 5. Get defaults again
      res = await request(server).get('/api/settings/general');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        disableAnalytics: false,
      });
    });
  });
});
