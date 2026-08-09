import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import internalDataRouter from './internalData.js';
import { projects, sessions } from '../database.js';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/internal/data/v1', internalDataRouter);
  return server;
}

describe('internal shared-data API', () => {
  it('discovers its API version and validates requests', async () => {
    const server = app();
    const version = await request(server).get('/api/internal/data/v1/version');
    expect(version.status).toBe(200);
    expect(version.body).toMatchObject({ version: 1 });

    const invalid = await request(server).get('/api/internal/data/v1/sessions/due?now=not-a-time');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('allows exactly one atomic scheduled-work claim', async () => {
    const project = projects.create('Shared data', '/tmp/shared-data');
    const scheduledAt = Date.now() - 10;
    const session = sessions.create(project.id, 'Due work', 'Do it', { status: 'scheduled' });
    sessions.update(session.id, { scheduledAt, pendingPrompt: 'Do it' });

    const server = app();
    const claim = () => request(server)
      .post(`/api/internal/data/v1/sessions/${session.id}/claim-scheduled`)
      .send({ expectedScheduledAt: scheduledAt, claimedAt: Date.now() });
    const [first, second] = await Promise.all([claim(), claim()]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(sessions.getById(session.id)).toMatchObject({ status: 'starting', scheduledAt: null });
  });
});
