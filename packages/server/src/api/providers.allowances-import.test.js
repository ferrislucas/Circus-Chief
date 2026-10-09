import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import providersRouter from './providers.js';

describe('providers allowance router import', () => {
  it('serves snapshots without requiring the websocket broadcast singleton at module evaluation time', async () => {
    const app = express();
    app.use('/api/providers', providersRouter);

    await request(app)
      .get('/api/providers/allowances')
      .expect(200)
      .expect((response) => {
        expect(Array.isArray(response.body.snapshots)).toBe(true);
        expect(Array.isArray(response.body.activeProviderIds)).toBe(true);
        // No collection source fires in this context, so every snapshot is
        // honestly unknown rather than estimated.
        for (const snapshot of response.body.snapshots) {
          expect(snapshot.status).toBe('unknown');
        }
      });
  });
});
