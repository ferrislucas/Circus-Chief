import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import modelTiersRouter from './modelTiers.js';

// Degradation broadcasts are asserted against this mock; the real layer owns
// live sockets. sessions-messages.js is mounted only in the stale-echo suite,
// where its continueSession side effect is stubbed out.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
  broadcast: vi.fn(),
  broadcastToSessionAndProject: vi.fn(),
  broadcastCommandRunOutput: vi.fn(),
  setCommandRunOutputAuthorizer: vi.fn(),
  getWebSocketServer: vi.fn(),
  initWebSocket: vi.fn(),
  webSocketManager: {
    registerClient: vi.fn(),
    broadcastToSession: vi.fn(),
    broadcastToProject: vi.fn(),
    broadcast: vi.fn(),
  },
}));

vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn(async () => ({ started: true })),
  runSession: vi.fn(async () => ({ started: true })),
}));

import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { continueSession } from '../services/sessionManager.js';
import sessionsMessagesRouter from './sessions-messages.js';

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

    it('preloads member availability instead of looking up each tier member', async () => {
      await request(app).post('/api/tiers').send({
        name: 'Preloaded availability',
        members: [
          { providerId: providerA.id, modelId: 'model-a', position: 0 },
          { providerId: providerB.id, modelId: 'model-b', position: 1 },
        ],
      }).expect(201);
      const getById = vi.spyOn(modelProviders, 'getById');

      const response = await request(app).get('/api/tiers').expect(200);

      expect(getById).not.toHaveBeenCalled();
      expect(response.body[0].members.every((member) => member.available)).toBe(true);
    });

    it('returns disabled-provider members with availability metadata', async () => {
      await request(app).post('/api/tiers').send({
        name: 'Unavailable Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      }).expect(201);
      modelProviders.update(providerA.id, { enabled: false });

      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body[0].members).toMatchObject([{
        providerId: providerA.id,
        modelId: 'model-a',
        position: 0,
        available: false,
        providerEnabled: false,
        modelEnabled: true,
        unavailabilityReason: 'provider_disabled',
      }]);
    });

    it('returns removed-model members with availability metadata', async () => {
      await request(app).post('/api/tiers').send({
        name: 'Orphaned Tier',
        members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
      }).expect(201);
      const model = modelProviders.getById(providerA.id).models.find((entry) => entry.modelId === 'model-a');
      modelProviders.removeModel(model.id);

      const response = await request(app).get('/api/tiers').expect(200);
      expect(response.body[0].members).toMatchObject([{
        providerId: providerA.id,
        modelId: 'model-a',
        available: false,
        providerEnabled: true,
        modelEnabled: false,
        unavailabilityReason: 'model_missing',
      }]);
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
            { providerId: 'anthropic-default', modelId: 'claude-opus-5', position: 0 },
            { providerId: 'openai-default', modelId: 'gpt-5.6-sol', position: 1 },
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

      it('rejects a disabled model instead of creating an unusable member', async () => {
        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Disabled Model Tier',
            members: [
              { providerId: 'anthropic-default', modelId: 'claude-opus-4-8', position: 0 },
            ],
          })
          .expect(400);
        expect(response.body.error).toMatch(/claude-opus-4-8.*disabled/i);
      });

      it('rejects a model owned by a disabled provider', async () => {
        modelProviders.update(providerA.id, { enabled: false });

        const response = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Disabled Provider Tier',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(400);
        expect(response.body.error).toMatch(/provider.*disabled/i);
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

    it('returns disabled-model members with availability metadata', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Disabled Model Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);
      const model = modelProviders.getById(providerA.id).models.find((entry) => entry.modelId === 'model-a');
      modelProviders.updateModel(model.id, { enabled: false });

      const response = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
      expect(response.body.members).toMatchObject([{
        providerId: providerA.id,
        modelId: 'model-a',
        available: false,
        providerEnabled: true,
        modelEnabled: false,
        unavailabilityReason: 'model_disabled',
      }]);
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

    it('degrades persisted consumers when a members PATCH empties a referenced tier', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Patch Emptied Tier',
          members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
        })
        .expect(201);
      const tierRef = buildTierRef(created.body.id);
      const project = projects.create('Tier patch emptied', '/tmp/tier-patch-emptied');
      projectDefaults.upsert(project.id, { model: tierRef, providerId: null });
      const template = sessionTemplates.create({
        projectId: project.id, name: 'Patch emptied template', prompt: 'Run', model: tierRef,
      });

      // members: [] empties the tier (not the configured summary tier, so the
      // summary kind guard does not apply). Consumers must be degraded, and
      // the tier row itself must survive for repopulation.
      await request(app)
        .patch(`/api/tiers/${created.body.id}`)
        .send({ members: [] })
        .expect(200);

      expect(projectDefaults.getByProjectId(project.id)).toMatchObject({ model: null, providerId: null });
      expect(sessionTemplates.getById(template.id).model).toBeNull();
      const emptiedTier = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
      expect(emptiedTier.body.members).toEqual([]);
    });

    it('preserves a disabled member when a name-only UI edit submits the full member list', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Preserve Disabled Member',
          members: [
            { providerId: providerA.id, modelId: 'model-a', position: 0 },
            { providerId: providerB.id, modelId: 'model-b', position: 1 },
          ],
        })
        .expect(201);
      modelProviders.update(providerB.id, { enabled: false });

      const response = await request(app)
        .patch(`/api/tiers/${created.body.id}`)
        .send({
          name: 'Renamed with Disabled Member',
          members: [
            { providerId: providerA.id, modelId: 'model-a', position: 0 },
            { providerId: providerB.id, modelId: 'model-b', position: 1 },
          ],
        })
        .expect(200);

      expect(response.body.members).toMatchObject([
        { providerId: providerA.id, modelId: 'model-a', position: 0, available: true },
        {
          providerId: providerB.id,
          modelId: 'model-b',
          position: 1,
          available: false,
          unavailabilityReason: 'provider_disabled',
        },
      ]);

      modelProviders.update(providerB.id, { enabled: true });
      const afterReenable = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
      expect(afterReenable.body.members).toMatchObject([
        { providerId: providerA.id, modelId: 'model-a', position: 0, available: true },
        { providerId: providerB.id, modelId: 'model-b', position: 1, available: true },
      ]);
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
      it('rejects emptying the configured summary tier', async () => {
        const created = await request(app)
          .post('/api/tiers')
          .send({
            name: 'Summary Tier Cannot Be Emptied',
            members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
          })
          .expect(201);

        settings.setSummarySettings({ summaryModel: buildTierRef(created.body.id), summaryProviderId: null });

        try {
          const response = await request(app)
            .patch(`/api/tiers/${created.body.id}`)
            .send({ members: [] })
            .expect(400);
          expect(response.body.error).toContain('at least one executable model');

          const unchanged = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
          expect(unchanged.body.members).toHaveLength(1);
        } finally {
          settings.setSummarySettings({ summaryModel: '', summaryProviderId: null });
        }
      });

      it('allows introducing a Google member when this tier is the configured summary tier', async () => {
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
          await request(app)
            .patch(`/api/tiers/${created.body.id}`)
            .send({
              members: [
                { providerId: providerA.id, modelId: 'model-a', position: 0 },
                { providerId: googleProvider.id, modelId: 'gemini-guard-model', position: 1 },
              ],
            })
            .expect(200);

          const stillThere = await request(app).get(`/api/tiers/${created.body.id}`).expect(200);
          expect(stillThere.body.members).toHaveLength(2);
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

    it('keeps summary settings pointed at the active Google member when deleting the configured summary tier', async () => {
      const googleProvider = modelProviders.create({ name: 'Deletion Google Provider', kind: 'google' });
      modelProviders.addModel(googleProvider.id, { modelId: 'gemini-deletion-model', displayName: 'Gemini' });
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Deletion Google Summary Tier',
          members: [{ providerId: googleProvider.id, modelId: 'gemini-deletion-model', position: 0 }],
        })
        .expect(201);
      const tierRef = buildTierRef(created.body.id);
      settings.setSummarySettings({
        disableSessionSummaries: false,
        sessionTitlePrompt: '',
        summaryModel: tierRef,
        summaryProviderId: null,
      });

      await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

      expect(settings.getSummarySettings()).toMatchObject({
        summaryModel: 'gemini-deletion-model',
        summaryProviderId: googleProvider.id,
      });
    });

    it('pins a failed-over session to its own resolved member when deleting the tier', async () => {
      const created = await request(app)
        .post('/api/tiers')
        .send({
          name: 'Deletion Failed-Over Tier',
          members: [
            { providerId: providerA.id, modelId: 'model-a', position: 0 },
            { providerId: providerB.id, modelId: 'model-b', position: 1 },
          ],
        })
        .expect(201);
      const tierRef = buildTierRef(created.body.id);
      const project = projects.create('Tier deletion failed over', '/tmp/tier-deletion-failed-over');
      const session = sessions.create(project.id, 'Failed-over tier session', 'Later', {
        status: 'waiting', model: tierRef,
      });
      sessions.update(session.id, {
        resolvedModel: 'model-b',
        resolvedProviderId: providerB.id,
      });

      await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

      expect(sessions.getById(session.id)).toMatchObject({
        model: 'model-b',
        providerId: providerB.id,
        resolvedModel: null,
        resolvedProviderId: null,
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

// ── Tier degradation client synchronization (review remediation §2) ─────────
//
// Deleting a tier (or emptying it via PATCH) must publish the canonical
// post-degradation state to connected websocket clients in the same request,
// so a client holding the old `tier::<id>` selection is reconciled instead of
// discovering the repair on its next full refetch (or worse, failing its next
// request against a server row that no longer matches what it displays).

describe('tier degradation client synchronization (websocket broadcasts)', () => {
  let app;
  let providerA;

  beforeEach(() => {
    broadcastToSession.mockClear();
    broadcastToProject.mockClear();

    app = express();
    app.use(express.json());
    app.use('/api/tiers', modelTiersRouter);

    providerA = modelProviders.create({ name: 'Sync Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'sync-model-a', displayName: 'Sync Model A' });
  });

  it('broadcasts the degraded concrete binding to session and project subscribers when a tier is deleted', async () => {
    const created = await request(app)
      .post('/api/tiers')
      .send({ name: 'Sync Delete Tier', members: [{ providerId: providerA.id, modelId: 'sync-model-a', position: 0 }] })
      .expect(201);
    const tierRef = buildTierRef(created.body.id);
    const project = projects.create('Sync Delete Project', '/tmp/sync-delete');
    const session = sessions.create(project.id, 'Sync Delete Session', 'Later', {
      status: 'waiting', model: tierRef,
    });
    const bystanderProject = projects.create('Sync Bystander Project', '/tmp/sync-bystander');
    const bystander = sessions.create(bystanderProject.id, 'Sync Bystander Session', 'Later', {
      status: 'waiting', model: null,
    });

    await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

    // Session subscribers receive the canonical degraded row.
    const sessionUpdate = broadcastToSession.mock.calls
      .find((c) => c[0] === session.id && c[1] === WS_MESSAGE_TYPES.SESSION_UPDATED);
    expect(sessionUpdate).toBeTruthy();
    expect(sessionUpdate[2]).toMatchObject({
      sessionId: session.id,
      session: expect.objectContaining({
        id: session.id,
        model: 'sync-model-a',
        providerId: providerA.id,
        resolvedModel: null,
        resolvedProviderId: null,
      }),
    });

    // Project subscribers receive the same canonical update.
    const projectUpdate = broadcastToProject.mock.calls
      .find((c) => c[0] === project.id && c[1] === WS_MESSAGE_TYPES.SESSION_UPDATED);
    expect(projectUpdate).toBeTruthy();
    expect(projectUpdate[2]).toMatchObject({
      projectId: project.id,
      sessionId: session.id,
      session: expect.objectContaining({ model: 'sync-model-a' }),
    });

    // Unrelated sessions are not broadcast.
    expect(broadcastToSession.mock.calls.some((c) => c[0] === bystander.id)).toBe(false);
    expect(broadcastToProject.mock.calls.some((c) => c[0] === bystanderProject.id)).toBe(false);
  });

  it('broadcasts the updated kanban board when a deleted tier rewrites a lane', async () => {
    const created = await request(app)
      .post('/api/tiers')
      .send({ name: 'Sync Lane Tier', members: [{ providerId: providerA.id, modelId: 'sync-model-a', position: 0 }] })
      .expect(201);
    const tierRef = buildTierRef(created.body.id);
    const project = projects.create('Sync Lane Project', '/tmp/sync-lane');
    const board = kanbanBoards.create(project.id);
    kanbanLanes.create(board.id, { name: 'Sync lane', onEnterModel: tierRef });

    await request(app).delete(`/api/tiers/${created.body.id}`).expect(204);

    const boardUpdate = broadcastToProject.mock.calls
      .find((c) => c[0] === project.id && c[1] === WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED);
    expect(boardUpdate).toBeTruthy();
    expect(boardUpdate[2]).toMatchObject({ projectId: project.id });
    expect(boardUpdate[2].board).toBeTruthy();
  });

  it('broadcasts degraded sessions when a members PATCH empties a referenced tier', async () => {
    const created = await request(app)
      .post('/api/tiers')
      .send({ name: 'Sync Patch Tier', members: [{ providerId: providerA.id, modelId: 'sync-model-a', position: 0 }] })
      .expect(201);
    const tierRef = buildTierRef(created.body.id);
    const project = projects.create('Sync Patch Project', '/tmp/sync-patch');
    const session = sessions.create(project.id, 'Sync Patch Session', 'Later', {
      status: 'waiting', model: tierRef,
    });

    broadcastToSession.mockClear();
    await request(app)
      .patch(`/api/tiers/${created.body.id}`)
      .send({ members: [] })
      .expect(200);

    const sessionUpdate = broadcastToSession.mock.calls
      .find((c) => c[0] === session.id && c[1] === WS_MESSAGE_TYPES.SESSION_UPDATED);
    expect(sessionUpdate).toBeTruthy();
    // No active member exists, so the degraded binding is the per-surface
    // default (cleared selection).
    expect(sessionUpdate[2].session).toMatchObject({ id: session.id, model: null, providerId: null });
  });

  it('does not broadcast when a tier mutation degrades nothing', async () => {
    const created = await request(app)
      .post('/api/tiers')
      .send({ name: 'Sync Quiet Tier', members: [{ providerId: providerA.id, modelId: 'sync-model-a', position: 0 }] })
      .expect(201);

    broadcastToSession.mockClear();
    broadcastToProject.mockClear();
    await request(app).patch(`/api/tiers/${created.body.id}`).send({ name: 'Renamed, still populated' }).expect(200);

    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastToProject).not.toHaveBeenCalled();
  });
});

// ── Stale deleted-tier echo tolerance (review remediation §2) ───────────────
//
// An open client that submits its next follow-up with the old `tier::<id>`
// selection must not fail merely because the deletion repaired the server row
// while the request was in flight (the race between deletion and event
// delivery). The echo is accepted ONLY for the session that was just degraded
// from that exact tier and is normalized to the server-side concrete
// selection; unknown-tier validation is otherwise unchanged.

describe('stale deleted-tier echo tolerance', () => {
  let combinedApp;
  let providerA;

  beforeEach(() => {
    broadcastToSession.mockClear();
    broadcastToProject.mockClear();
    continueSession.mockClear();

    combinedApp = express();
    combinedApp.use(express.json());
    combinedApp.use('/api/tiers', modelTiersRouter);
    combinedApp.use('/api/sessions', sessionsMessagesRouter);

    providerA = modelProviders.create({ name: 'Echo Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'echo-model-a', displayName: 'Echo Model A' });
  });

  it('accepts the deleted tier echo for the just-degraded session and normalizes it to the concrete binding', async () => {
    const created = await request(combinedApp)
      .post('/api/tiers')
      .send({ name: 'Echo Tier', members: [{ providerId: providerA.id, modelId: 'echo-model-a', position: 0 }] })
      .expect(201);
    const tierRef = buildTierRef(created.body.id);
    const project = projects.create('Echo Project', '/tmp/echo-project');
    const session = sessions.create(project.id, 'Echo Session', 'Later', {
      status: 'waiting', model: tierRef,
    });

    // The deletion races with the client's in-flight follow-up that still
    // carries the old tier ref.
    await request(combinedApp).delete(`/api/tiers/${created.body.id}`).expect(204);

    const response = await request(combinedApp)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'hello', model: tierRef })
      .expect(200);

    expect(response.body).toMatchObject({ success: true });
    // The stale echo was normalized away: the continuation runs on the
    // session's own (server-canonical, degraded) binding.
    expect(continueSession).toHaveBeenCalledWith(
      session.id, 'hello', expect.anything(),
      expect.objectContaining({ model: null }),
    );
  });

  it('still rejects an unknown tier ref the session was never degraded from', async () => {
    const created = await request(combinedApp)
      .post('/api/tiers')
      .send({ name: 'Echo Control Tier', members: [{ providerId: providerA.id, modelId: 'echo-model-a', position: 0 }] })
      .expect(201);
    const project = projects.create('Echo Control Project', '/tmp/echo-control');
    const session = sessions.create(project.id, 'Echo Control Session', 'Later', {
      status: 'waiting', model: buildTierRef(created.body.id),
    });

    await request(combinedApp).delete(`/api/tiers/${created.body.id}`).expect(204);

    const otherTierRef = buildTierRef('00000000-0000-0000-0000-000000000000');
    await request(combinedApp)
      .post(`/api/sessions/${session.id}/message`)
      .send({ content: 'hello', model: otherTierRef })
      .expect(400);

    expect(continueSession).not.toHaveBeenCalled();
  });
});
