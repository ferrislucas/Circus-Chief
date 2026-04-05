import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { modelProviders } from '../database.js';

// Import the router
import providersRouter from './providers.js';

describe('Providers API', () => {
  let app;
  let testProviderId;
  let testModelId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/providers', providersRouter);
  });

  afterEach(() => {
    // Cleanup test data
    if (testProviderId) {
      try {
        modelProviders.delete(testProviderId);
      } catch (e) {
        // Ignore if already deleted
      }
      testProviderId = null;
    }
  });

  describe('PATCH /api/providers/:id/models/:modelId', () => {
    beforeEach(() => {
      // Create a test provider with a model
      const provider = modelProviders.create({
        name: 'Test Provider',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });
      testProviderId = provider.id;

      const model = modelProviders.addModel(provider.id, {
        modelId: 'test-sonnet-v1',
        displayName: 'Test Sonnet',
        tier: 'sonnet',
      });
      testModelId = model.id;
    });

    afterEach(() => {
      // Cleanup is handled in the outer afterEach
    });

    it('200: successfully updates a model\'s fields', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({ modelId: 'updated-sonnet-v2' })
        .expect(200);

      expect(response.body.modelId).toBe('updated-sonnet-v2');
      expect(response.body.displayName).toBe('Test Sonnet');
      expect(response.body.tier).toBe('sonnet');
    });

    it('200: updates multiple fields at once', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({
          modelId: 'new-model-id',
          displayName: 'New Display Name',
          tier: 'opus',
        })
        .expect(200);

      expect(response.body.modelId).toBe('new-model-id');
      expect(response.body.displayName).toBe('New Display Name');
      expect(response.body.tier).toBe('opus');
    });

    it('200: returns model unchanged when updating with empty object', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({})
        .expect(200);

      expect(response.body.modelId).toBe('test-sonnet-v1');
      expect(response.body.displayName).toBe('Test Sonnet');
      expect(response.body.tier).toBe('sonnet');
    });

    it('404: provider not found', async () => {
      const response = await request(app)
        .patch('/api/providers/non-existent-provider/models/some-model-id')
        .send({ modelId: 'new-id' })
        .expect(404);

      expect(response.body.error).toBe('Provider not found');
    });

    it('404: model not found', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/non-existent-model-id`)
        .send({ modelId: 'new-id' })
        .expect(404);

      expect(response.body.error).toBe('Model not found');
    });

    it('400: model doesn\'t belong to the specified provider', async () => {
      // Create another provider with its own model
      const otherProvider = modelProviders.create({
        name: 'Other Provider',
        baseUrl: 'https://api.other.com',
        authToken: 'other-token',
      });

      const otherModel = modelProviders.addModel(otherProvider.id, {
        modelId: 'other-model',
        displayName: 'Other Model',
        tier: 'sonnet',
      });

      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${otherModel.id}`)
        .send({ modelId: 'new-id' })
        .expect(400);

      expect(response.body.error).toBe('Model does not belong to this provider');

      // Cleanup
      modelProviders.delete(otherProvider.id);
    });

    it('400: invalid request body (Zod validation - empty modelId)', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({ modelId: '' }) // Empty string should fail min(1)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('400: invalid request body (Zod validation - invalid tier)', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({ tier: 'invalid-tier' })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error).toMatch(/tier|Invalid option/);
    });

    it('400: invalid request body (Zod validation - empty modelId)', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({ modelId: '' }) // Empty string should fail min(1)
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('200: valid request with displayName update only', async () => {
      const response = await request(app)
        .patch(`/api/providers/${testProviderId}/models/${testModelId}`)
        .send({ displayName: 'Updated Display Name' })
        .expect(200);

      expect(response.body.displayName).toBe('Updated Display Name');
      expect(response.body.modelId).toBe('test-sonnet-v1'); // Unchanged
    });
  });

  describe('POST /api/providers/:id/models', () => {
    beforeEach(() => {
      // Create a test provider
      const provider = modelProviders.create({
        name: 'Add Model Test Provider',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });
      testProviderId = provider.id;
    });

    it('201: successfully adds a model to a provider', async () => {
      const response = await request(app)
        .post(`/api/providers/${testProviderId}/models`)
        .send({
          modelId: 'new-sonnet-model',
          displayName: 'New Sonnet',
          tier: 'sonnet',
        })
        .expect(201);

      expect(response.body.modelId).toBe('new-sonnet-model');
      expect(response.body.displayName).toBe('New Sonnet');
      expect(response.body.tier).toBe('sonnet');
      expect(response.body.id).toBeDefined();

      // Verify model exists in database
      const models = modelProviders.getModels(testProviderId);
      expect(models.some((m) => m.modelId === 'new-sonnet-model')).toBe(true);
    });

    it('404: provider not found', async () => {
      const response = await request(app)
        .post('/api/providers/non-existent/models')
        .send({
          modelId: 'test-model',
          displayName: 'Test',
          tier: 'sonnet',
        })
        .expect(404);

      expect(response.body.error).toBe('Provider not found');
    });

    it('400: invalid request body (Zod validation)', async () => {
      const response = await request(app)
        .post(`/api/providers/${testProviderId}/models`)
        .send({
          modelId: 'ab', // Too short
          displayName: 'Test',
          tier: 'invalid-tier',
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('DELETE /api/providers/:providerId/models/:modelId', () => {
    beforeEach(() => {
      // Create a test provider with a model
      const provider = modelProviders.create({
        name: 'Delete Model Test Provider',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });
      testProviderId = provider.id;

      const model = modelProviders.addModel(provider.id, {
        modelId: 'model-to-delete',
        displayName: 'To Delete',
        tier: 'sonnet',
      });
      testModelId = model.id;
    });

    it('204: successfully removes a model from a provider', async () => {
      await request(app)
        .delete(`/api/providers/${testProviderId}/models/${testModelId}`)
        .expect(204);

      // Verify model is removed
      const models = modelProviders.getModels(testProviderId);
      expect(models.find((m) => m.id === testModelId)).toBeUndefined();
    });

    it('404: provider not found', async () => {
      const response = await request(app)
        .delete('/api/providers/non-existent/models/some-model-id')
        .expect(404);

      expect(response.body.error).toBe('Provider not found');
    });

    it('404: model not found', async () => {
      const response = await request(app)
        .delete(`/api/providers/${testProviderId}/models/non-existent-model-id`)
        .expect(404);

      expect(response.body.error).toBe('Model not found');
    });

    it('400: model doesn\'t belong to the specified provider', async () => {
      // Create another provider with its own model
      const otherProvider = modelProviders.create({
        name: 'Other Provider',
        baseUrl: 'https://api.other.com',
        authToken: 'other-token',
      });

      const otherModel = modelProviders.addModel(otherProvider.id, {
        modelId: 'other-model',
        displayName: 'Other Model',
        tier: 'sonnet',
      });

      const response = await request(app)
        .delete(`/api/providers/${testProviderId}/models/${otherModel.id}`)
        .expect(400);

      expect(response.body.error).toBe('Model does not belong to this provider');

      // Cleanup
      modelProviders.delete(otherProvider.id);
    });
  });
});
