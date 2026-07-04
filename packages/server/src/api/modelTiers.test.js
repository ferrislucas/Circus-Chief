import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { modelProviders } from '../database.js';
import modelTiersRouter from './modelTiers.js';

describe('Model Tiers API', () => {
  let app;
  let providerA;
  let providerB;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/tiers', modelTiersRouter);

    providerA = modelProviders.create({ name: 'Provider A', kind: 'anthropic' });
    providerB = modelProviders.create({ name: 'Provider B', kind: 'openai' });
  });

  describe('GET /api/tiers', () => {
    it('returns an empty list when no tiers exist', async () => {
      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body).toEqual([]);
    });

    it('returns all tiers with members', async () => {
      await request(app)
        .post('/api/tiers')
        .send({
          name: 'Tier 1',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);

      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].members).toHaveLength(1);
    });
  });

  describe('POST /api/tiers', () => {
    it('creates a tier with members', async () => {
      const response = await request(app)
        .post('/api/tiers')
        .send({
          name: 'High Priority',
          description: 'top models',
          members: [
            { providerId: providerA.id, modelId: 'model-a', position: 0 },
            { providerId: providerB.id, modelId: 'model-b', position: 1 },
          ],
        })
        .expect(201);

      expect(response.body.name).toBe('High Priority');
      expect(response.body.members).toHaveLength(2);
    });

    it('rejects a request missing name', async () => {
      const response = await request(app)
        .post('/api/tiers')
        .send({ members: [] })
        .expect(400);
      expect(response.body.error).toBeDefined();
    });

    it('rejects a request with invalid member shape', async () => {
      const response = await request(app)
        .post('/api/tiers')
        .send({ name: 'Bad', members: [{ providerId: 'not-a-uuid', modelId: 'x', position: 0 }] })
        .expect(400);
      expect(response.body.error).toBeDefined();
    });

    it('returns 409 on duplicate name', async () => {
      await request(app).post('/api/tiers').send({ name: 'Dup', members: [] }).expect(201);
      const response = await request(app)
        .post('/api/tiers')
        .send({ name: 'Dup', members: [] })
        .expect(409);
      expect(response.body.error).toMatch(/already exists/i);
    });

    it('allows an empty tier (no members)', async () => {
      const response = await request(app)
        .post('/api/tiers')
        .send({ name: 'Empty Tier', members: [] })
        .expect(201);
      expect(response.body.members).toEqual([]);
    });
  });

  describe('GET /api/tiers/:id', () => {
    it('returns a tier by id', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({ name: 'Tier', members: [] })
        .expect(201);

      const response = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
      expect(response.body.id).toBe(created.body.id);
    });

    it('returns 404 for missing tier', async () => {
      await request(app).get('/api/tiers/nonexistent').expect(404);
    });
  });

  describe('PATCH /api/tiers/:id', () => {
    it('updates name and description', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({ name: 'Original', members: [] })
        .expect(201);

      const response = await request(app)
        .patch(`/api/tiers/${created.body.id}`)
        .send({ name: 'Renamed', description: 'new desc' })
        .expect(200);

      expect(response.body.name).toBe('Renamed');
      expect(response.body.description).toBe('new desc');
    });

    it('replaces members atomically', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);

      const response = await request(app)
        .patch(`/api/tiers/${created.body.id}`)
        .send({
          members: [{ providerId: providerB.id, modelId: 'model-b', position: 0 }],
        })
        .expect(200);

      expect(response.body.members).toHaveLength(1);
      expect(response.body.members[0].modelId).toBe('model-b');
    });

    it('rejects unknown fields (.strict())', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({ name: 'Tier', members: [] })
        .expect(201);

      const response = await request(app)
        .patch(`/api/tiers/${created.body.id}`)
        .send({ bogus: true })
        .expect(400);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 for missing tier', async () => {
      await request(app).patch('/api/tiers/nonexistent').send({ name: 'x' }).expect(404);
    });
  });

  describe('DELETE /api/tiers/:id', () => {
    it('deletes a tier', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({ name: 'ToDelete', members: [] })
        .expect(201);

      await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);
      await request(app).get(`/api/tiers/${created.body.id}`).expect(404);
    });

    it('returns 404 for missing tier', async () => {
      await request(app).delete('/api/tiers/nonexistent').expect(404);
    });
  });
});
