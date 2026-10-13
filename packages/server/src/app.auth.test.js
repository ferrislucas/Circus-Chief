import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { AUTH_REALM } from './middleware/basicAuth.js';

const PASSWORD = 's3cret-password';

function testAuth() {
  return { users: new Map([['alice', bcrypt.hashSync(PASSWORD, 4)]]) };
}

function basicHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('createApp auth wiring', () => {
  it('serves without credentials when no auth option is given', async () => {
    const app = createApp({ production: false });
    const res = await request(app).get('/api/server-info');
    expect(res.status).toBe(200);
    const projects = await request(app).get('/api/projects');
    expect(projects.status).toBe(200);
  });

  it('serves without credentials when auth is explicitly null', async () => {
    const app = createApp({ production: false, auth: null });
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('returns 401 + challenge for unauthenticated API access when auth is on', async () => {
    const app = createApp({ production: false, auth: testAuth() });
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Basic realm="${AUTH_REALM}"`);
  });

  it('exempts GET /api/server-info from auth', async () => {
    const app = createApp({ production: false, auth: testAuth() });
    const res = await request(app).get('/api/server-info');
    expect(res.status).toBe(200);
  });

  it('returns only a minimal subset for unauthenticated server-info when auth is on', async () => {
    const app = createApp({ production: false, auth: testAuth() });
    const res = await request(app).get('/api/server-info');
    expect(res.status).toBe(200);
    expect(res.body.authEnabled).toBe(true);
    expect(res.body).not.toHaveProperty('cwd');
    expect(res.body).not.toHaveProperty('dbPath');
    expect(res.body).not.toHaveProperty('schedulerRunning');
    expect(res.body).not.toHaveProperty('e2eSpawnCaptureEnabled');
    expect(res.body).not.toHaveProperty('automationStatus');
  });

  it('returns the full payload for authenticated server-info when auth is on', async () => {
    const app = createApp({ production: false, auth: testAuth() });
    const res = await request(app)
      .get('/api/server-info')
      .set('Authorization', basicHeader('alice', PASSWORD));
    expect(res.status).toBe(200);
    expect(typeof res.body.cwd).toBe('string');
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body).toHaveProperty('schedulerRunning');
    expect(res.body).toHaveProperty('e2eSpawnCaptureEnabled');
    expect(res.body).toHaveProperty('automationStatus');
    expect(res.body.authEnabled).toBe(true);
  });

  it('returns the full payload with authEnabled:false when auth is off', async () => {
    const app = createApp({ production: false });
    const res = await request(app).get('/api/server-info');
    expect(res.status).toBe(200);
    expect(typeof res.body.cwd).toBe('string');
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body.authEnabled).toBe(false);
  });

  it('passes authenticated requests through', async () => {
    const app = createApp({ production: false, auth: testAuth() });
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', basicHeader('alice', PASSWORD));
    expect(res.status).toBe(200);
  });

  it('gates non-API paths (production static ordering) without credentials', async () => {
    const app = createApp({ production: true, auth: testAuth() });
    const res = await request(app).get('/some-frontend-route');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Basic realm="${AUTH_REALM}"`);
  });
});
