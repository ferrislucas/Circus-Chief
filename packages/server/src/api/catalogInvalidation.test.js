import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { modelProviders, modelTiers } from '../database.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

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

import { broadcast } from '../websocket.js';
import modelTiersRouter from './modelTiers.js';
import providersRouter from './providers.js';

function invalidations() {
  return broadcast.mock.calls.filter(([type]) => type === WS_MESSAGE_TYPES.CATALOG_INVALIDATED);
}

describe('catalog invalidation broadcasts', () => {
  let app;
  let providerA;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tiers', modelTiersRouter);
    app.use('/api/providers', providersRouter);

    providerA = modelProviders.create({ name: 'Invalidation Provider A', kind: 'anthropic' });
    modelProviders.addModel(providerA.id, { modelId: 'model-a', displayName: 'Model A' });
  });

  it('emits a versioned tiers invalidation after tier create', async () => {
    await request(app).post('/api/tiers').send({
      name: 'Invalidation Tier',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    }).expect(201);

    const events = invalidations();
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ scope: 'tiers' });
    expect(typeof events[0][1].revision).toBe('number');
  });

  it('emits a versioned tiers invalidation after tier update and tier delete', async () => {
    const tier = modelTiers.create({
      name: 'Invalidation Tier',
      members: [{ providerId: providerA.id, modelId: 'model-a', position: 0 }],
    });

    await request(app).patch(`/api/tiers/${tier.id}`).send({ name: 'Renamed' }).expect(200);
    await request(app).delete(`/api/tiers/${tier.id}`).expect(204);

    const events = invalidations();
    expect(events).toHaveLength(2);
    expect(events[0][1].scope).toBe('tiers');
    expect(events[1][1].scope).toBe('tiers');
    // Revisions are strictly increasing so clients can drop delayed dupes.
    expect(events[1][1].revision).toBeGreaterThan(events[0][1].revision);
  });

  it('emits a versioned providers invalidation after provider disable and delete', async () => {
    await request(app).patch(`/api/providers/${providerA.id}`).send({ enabled: false }).expect(200);
    await request(app).delete(`/api/providers/${providerA.id}`).expect(204);

    const events = invalidations();
    expect(events).toHaveLength(2);
    expect(events.every(([, payload]) => payload.scope === 'providers')).toBe(true);
    expect(events[1][1].revision).toBeGreaterThan(events[0][1].revision);
  });

  it('emits a providers invalidation after model-catalog mutation', async () => {
    await request(app).post(`/api/providers/${providerA.id}/models`).send({
      modelId: 'model-new',
      displayName: 'Model New',
    }).expect(201);

    const events = invalidations();
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ scope: 'providers' });
  });

  it('emits nothing when the mutation fails validation', async () => {
    await request(app).post('/api/tiers').send({ members: [] }).expect(400);

    expect(invalidations()).toHaveLength(0);
  });
});
