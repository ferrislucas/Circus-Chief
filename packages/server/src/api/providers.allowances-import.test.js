import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import providersRouter from './providers.js';

describe('providers allowance router import', () => {
  it('does not require the websocket broadcast singleton at module evaluation time', async () => {
    const app = express();
    app.use('/api/providers', providersRouter);

    await request(app)
      .get('/api/providers/allowances')
      .expect(200)
      .expect((response) => expect(response.body).toEqual(expect.any(Array)));
  });
});
