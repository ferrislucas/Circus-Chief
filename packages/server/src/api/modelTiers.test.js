import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  modelProviders,
  settings,
  projects,
  projectDefaults,
  sessionTemplates,
  sessions,
  kanbanBoards,
  kanbanLanes,
} from '../database.js';
import { buildTierRef } from '@circuschief/shared';
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
    // Work Item 3: write-time validation now checks provider/model
    // ownership, so every test using these shared providers with
    // 'model-a' / 'model-b' needs them actually registered.
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
    modelProviders.addModel(providerB.id, { modelId: 'model-b', displayName: 'Model B' });
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

    it('omits members whose provider is disabled', async () => {
      await request(app).post('/api/tiers').send({
        name: 'Unavailable Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      }).expect(201);
      modelProviders.update(providerA.id, { enabled: false });

      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body[0].members).toEqual([]);
    });

    it('omits members whose model has been removed', async () => {
      await request(app).post('/api/tiers').send({
        name: 'Orphaned Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      }).expect(201);
      const model = modelProviders.getById(providerA.id).models.find((entry) => entry.modelId === 'model-a');
      modelProviders.removeModel(model.id);

      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body[0].members).toEqual([]);
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
        .send({ name: 'Bad', members: [{ providerId: '', modelId: 'x', position: 0 }] })
        .expect(400);
      expect(response.body.error).toBeDefined();
    });

    it('creates a tier from built-in (non-uuid) provider ids', async () => {
      // Built-in providers are seeded with fixed ids ("anthropic-default",
      // "openai-default") rather than UUIDs — see seedBaselineData.js.
      const response = await request(app)
        .post('/api/tiers')
        .send({
          name: 'High',
          members: [
            { providerId: 'anthropic-default', modelId: 'claude-opus-4-8', position: 0 },
            { providerId: 'openai-default', modelId: 'gpt-5.5', position: 1 },
          ],
        })
        .expect(201);

      expect(response.body.members).toHaveLength(2);
      expect(response.body.members.map((m) => m.providerId)).toEqual([
        'anthropic-default',
        'openai-default',
      ]);
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

    // ── Work Item 3: catalog/ownership validation ─────────────────────────
    describe('member catalog/ownership validation', () => {
      it('rejects an unknown provider id and persists nothing', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Bad Provider Tier',
            members: [{ providerId: 'nonexistent-provider', modelId: 'model-a', position: 0 }],
          })
          .expect(400);
        expect(response.body.error).toContain('nonexistent-provider');

        const list = await request(app).get('/api/tiers').expect(200);
        expect(list.body.find((t) => t.name === 'Bad Provider Tier')).toBeUndefined();
      });

      it('rejects an unknown model id for a real provider', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Bad Model Tier',
            members: [{ providerId: providerA.id, modelId: 'not-a-real-model', position: 0 }],
          })
          .expect(400);
        expect(response.body.error).toContain('not-a-real-model');
      });

      it('rejects a real model id paired with the wrong provider', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Mismatched Pair Tier',
            members: [{ providerId: 'anthropic-default', modelId: 'gpt-5.5', position: 0 }],
          })
          .expect(400);
        expect(response.body.error).toContain('gpt-5.5');
        expect(response.body.error).toContain('anthropic-default');
      });

      it('rejects a mixed payload of valid and invalid members atomically', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Mixed Payload Tier',
            members: [
              { providerId: providerA.id, modelId: 'model-a', position: 0 },
              { providerId: providerA.id, modelId: 'not-a-real-model', position: 1 },
            ],
          })
          .expect(400);
        expect(response.body.error).toContain('not-a-real-model');

        const list = await request(app).get('/api/tiers').expect(200);
        expect(list.body.find((t) => t.name === 'Mixed Payload Tier')).toBeUndefined();
      });

      it('accepts a disabled-but-present model (claude-opus-4-8) for the existing cross-provider creation test', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Disabled Model OK Tier',
            members: [
              { providerId: 'anthropic-default', modelId: 'claude-opus-4-8', position: 0 },
              { providerId: 'openai-default', modelId: 'gpt-5.5', position: 1 },
            ],
          })
          .expect(201);
        expect(response.body.members).toHaveLength(2);
      });

      it('accepts a model owned by a disabled provider', async () => {
        modelProviders.update(providerA.id, { enabled: false });

        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Disabled Provider OK Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);
        expect(response.body.members).toHaveLength(1);
      });

      it('accepts a valid cross-provider tier, preserving configured ordering', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Valid Cross-Provider Tier',
            members: [
              { providerId: providerB.id, modelId: 'model-b', position: 0 },
              { providerId: providerA.id, modelId: 'model-a', position: 1 },
            ],
          })
          .expect(201);
        expect(response.body.members.map((m) => m.modelId)).toEqual(['model-b', 'model-a']);
      });
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

    // ── Work Item 3: catalog/ownership validation on update ───────────────
    describe('member catalog/ownership validation', () => {
      it('rejects introducing an unknown provider id via PATCH and leaves existing members untouched', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Patch Bad Provider Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        const response = await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({ members: [{ providerId: 'nonexistent-provider', modelId: 'model-a', position: 0 }] })
          .expect(400);
        expect(response.body.error).toContain('nonexistent-provider');

        const stillThere = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
        expect(stillThere.body.members).toHaveLength(1);
        expect(stillThere.body.members[0].providerId).toBe(providerA.id);
      });

      it('rejects an unknown model id for a real provider via PATCH', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({ name: 'Patch Bad Model Tier', members: [] })
          .expect(201);

        const response = await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({ members: [{ providerId: providerA.id, modelId: 'not-a-real-model', position: 0 }] })
          .expect(400);
        expect(response.body.error).toContain('not-a-real-model');
      });

      it('rejects a mixed payload of valid and invalid members atomically via PATCH', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({ name: 'Patch Mixed Tier', members: [] })
          .expect(201);

        await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({
            members: [
              { providerId: providerA.id, modelId: 'model-a', position: 0 },
              { providerId: providerA.id, modelId: 'not-a-real-model', position: 1 },
            ],
          })
          .expect(400);

        const stillThere = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
        expect(stillThere.body.members).toEqual([]);
      });

      it('does not validate members when the PATCH does not include a members field', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Patch Name Only Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        const response = await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({ name: 'Renamed Only' })
          .expect(200);
        expect(response.body.name).toBe('Renamed Only');
      });

      it('accepts introducing a valid cross-provider member via PATCH', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Patch Valid Add Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        const response = await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({
            members: [
              { providerId: providerA.id, modelId: 'model-a', position: 0 },
              { providerId: providerB.id, modelId: 'model-b', position: 1 },
            ],
          })
          .expect(200);
        expect(response.body.members).toHaveLength(2);
      });
    });

    // ── Work Item 3: close the summary-settings bypass ─────────────────────
    describe('summary-tier kind guard', () => {
      it('rejects introducing an unsupported-kind member when this tier is the configured summary tier', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Summary-Bound Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        settings.setSummarySettings({ summaryModel: buildTierRef(created.body.id), summaryProviderId: null });

        const googleProvider = modelProviders.create({ name: 'Summary Guard Google Provider', kind: 'google' });
        modelProviders.addModel(googleProvider.id, { modelId: 'gemini-guard-model', displayName: 'Gemini' });

        try {
          const response = await request(app)
            .patch(`/api/tiers/${created.body.id}`)
            .send({
              members: [
                { providerId: providerA.id, modelId: 'model-a', position: 0 },
                { providerId: googleProvider.id, modelId: 'gemini-guard-model', position: 1 },
              ],
            })
            .expect(400);
          expect(response.body.error).toMatch(/summary/i);

          const stillThere = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
          expect(stillThere.body.members).toHaveLength(1);
        } finally {
          settings.setSummarySettings({ summaryModel: '', summaryProviderId: null });
        }
      });

      it('allows introducing an unsupported-kind member when this tier is NOT the configured summary tier', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Non-Summary Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        const googleProvider = modelProviders.create({ name: 'Non-Summary Google Provider', kind: 'google' });
        modelProviders.addModel(googleProvider.id, { modelId: 'gemini-non-summary-model', displayName: 'Gemini' });

        const response = await request(app)
          .patch(`/api/tiers/${created.body.id}`)
          .send({
            members: [
              { providerId: providerA.id, modelId: 'model-a', position: 0 },
              { providerId: googleProvider.id, modelId: 'gemini-non-summary-model', position: 1 },
            ],
          })
          .expect(200);
        expect(response.body.members).toHaveLength(2);
      });
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

    it('atomically degrades every persisted tier configuration to its active member', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Deletion Fallback Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);
      const tierRef = buildTierRef(created.body.id);
      const project = projects.create('Tier deletion references', '/tmp/tier-deletion-references');
      const template = sessionTemplates.create({
        projectId: project.id, name: 'Tier template', prompt: 'Run', model: tierRef,
      });
      projectDefaults.upsert(project.id, { model: tierRef, providerId: null });
      const board = kanbanBoards.create(project.id);
      const lane = kanbanLanes.create(board.id, { name: 'Tier lane', onEnterModel: tierRef });
      const session = sessions.create(project.id, 'Tier session', 'Later', {
        status: 'scheduled', model: tierRef,
      });
      sessions.update(session.id, { pendingModel: tierRef });
      settings.setSummarySettings({
        disableSessionSummaries: false,
        sessionTitlePrompt: '',
        summaryModel: tierRef,
        summaryProviderId: null,
      });

      await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

      expect(sessionTemplates.getById(template.id).model).toBe('model-a');
      expect(projectDefaults.getByProjectId(project.id)).toMatchObject({
        model: 'model-a', providerId: providerA.id,
      });
      expect(kanbanLanes.getById(lane.id).onEnterModel).toBe('model-a');
      expect(sessions.getById(session.id)).toMatchObject({
        model: 'model-a', pendingModel: 'model-a', providerId: providerA.id,
        resolvedModel: null, resolvedProviderId: null,
      });
      expect(settings.getSummarySettings()).toMatchObject({
        summaryModel: 'model-a', summaryProviderId: providerA.id,
      });
    });

    it('clears every persisted selection when a tier has no active member', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Deletion Empty Fallback Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);
      const tierRef = buildTierRef(created.body.id);
      const project = projects.create('Tier deletion no member', '/tmp/tier-deletion-no-member');
      const template = sessionTemplates.create({
        projectId: project.id, name: 'Tier template', prompt: 'Run', model: tierRef,
      });
      projectDefaults.upsert(project.id, { model: tierRef, providerId: providerA.id });
      const board = kanbanBoards.create(project.id);
      const lane = kanbanLanes.create(board.id, { name: 'Tier lane', onEnterModel: tierRef });
      const session = sessions.create(project.id, 'Tier session', 'Later', {
        status: 'scheduled', model: tierRef,
      });
      sessions.update(session.id, { pendingModel: tierRef });
      settings.setSummarySettings({
        disableSessionSummaries: false,
        sessionTitlePrompt: '',
        summaryModel: tierRef,
        summaryProviderId: null,
      });
      modelProviders.update(providerA.id, { enabled: false });

      await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

      expect(sessionTemplates.getById(template.id).model).toBeNull();
      expect(projectDefaults.getByProjectId(project.id)).toMatchObject({ model: null, providerId: null });
      expect(kanbanLanes.getById(lane.id).onEnterModel).toBeNull();
      expect(sessions.getById(session.id)).toMatchObject({ model: null, pendingModel: null, providerId: null });
      expect(settings.getSummarySettings()).toMatchObject({ summaryModel: '', summaryProviderId: null });
    });
  });
});
