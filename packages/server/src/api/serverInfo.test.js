import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import apiRouter from './index.js';
import { schedulerService } from '../services/schedulerService.js';

/**
 * /api/server-info is the endpoint pw.sh uses to sanity-check it's talking
 * to the expected worktree server. The contract:
 *   - cwd: string (absolute path)
 *   - dbPath: string|null (absolute path of DB; ":memory:" in tests)
 *   - vcrMode: string|null (non-empty string or null; never "")
 *   - schedulerRunning: boolean
 * The endpoint must be additive-safe: consumers are required to ignore
 * unknown fields so we can add more without a coordinated release.
 */
describe('GET /api/server-info', () => {
  let app;
  const originalVcr = process.env.VCR_MODE;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    // Ensure scheduler is stopped for deterministic assertions
    schedulerService.stop();
  });

  afterEach(() => {
    // Restore VCR_MODE to whatever it was
    if (originalVcr === undefined) {
      delete process.env.VCR_MODE;
    } else {
      process.env.VCR_MODE = originalVcr;
    }
    schedulerService.stop();
  });

  it('returns all four fields with correct types', async () => {
    delete process.env.VCR_MODE;

    const res = await request(app).get('/api/server-info');
    expect(res.status).toBe(200);
    expect(typeof res.body.cwd).toBe('string');
    expect(typeof res.body.dbPath).toBe('string');
    expect(res.body.vcrMode).toBeNull();
    expect(typeof res.body.schedulerRunning).toBe('boolean');
  });

  it('dbPath matches the path the DB was initialized with', async () => {
    const res = await request(app).get('/api/server-info');
    // test/setup.js inits with ":memory:"
    expect(res.body.dbPath).toBe(':memory:');
  });

  it('vcrMode is null when env var is unset', async () => {
    delete process.env.VCR_MODE;
    const res = await request(app).get('/api/server-info');
    expect(res.body.vcrMode).toBeNull();
  });

  it('vcrMode is null when env var is the empty string (not "")', async () => {
    process.env.VCR_MODE = '';
    const res = await request(app).get('/api/server-info');
    expect(res.body.vcrMode).toBeNull();
  });

  it('vcrMode is the literal string when env var is set', async () => {
    process.env.VCR_MODE = 'replay';
    const res = await request(app).get('/api/server-info');
    expect(res.body.vcrMode).toBe('replay');
  });

  it('schedulerRunning reflects schedulerService.isRunning()', async () => {
    // Stopped
    schedulerService.stop();
    let res = await request(app).get('/api/server-info');
    expect(res.body.schedulerRunning).toBe(false);

    // Started
    schedulerService.initialize({});
    schedulerService.start();
    res = await request(app).get('/api/server-info');
    expect(res.body.schedulerRunning).toBe(true);

    // Stopped again
    schedulerService.stop();
    res = await request(app).get('/api/server-info');
    expect(res.body.schedulerRunning).toBe(false);
  });

  it('response shape is stable enough for consumers to tolerate extra fields', async () => {
    const res = await request(app).get('/api/server-info');
    // Presence check — consumers must not fail if we later add fields.
    expect(res.body).toHaveProperty('cwd');
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body).toHaveProperty('vcrMode');
    expect(res.body).toHaveProperty('schedulerRunning');
  });
});
