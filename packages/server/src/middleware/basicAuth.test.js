import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import {
  parseHtpasswd,
  loadAuthConfig,
  createAuthMiddleware,
  verifyBasicHeader,
  resolveStartupAuth,
  AUTH_REALM,
} from './basicAuth.js';

const PASSWORD = 's3cret-password';
let hash;

function htpasswdLine(user, password = PASSWORD) {
  return `${user}:${bcrypt.hashSync(password, 4)}`;
}

function basicHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('parseHtpasswd', () => {
  beforeEach(() => {
    hash = bcrypt.hashSync(PASSWORD, 4);
  });

  it('parses valid user:hash lines', () => {
    const users = parseHtpasswd(`alice:${hash}\nbob:${hash}\n`);
    expect(users.get('alice')).toBe(hash);
    expect(users.get('bob')).toBe(hash);
  });

  it('ignores blank lines and # comments', () => {
    const users = parseHtpasswd(`\n# a comment\n  \nalice:${hash}\n#another\n`);
    expect(users.size).toBe(1);
    expect(users.get('alice')).toBe(hash);
  });

  it('accepts $2y$ hashes as well as $2b$', () => {
    const yHash = hash.replace('$2b$', '$2y$');
    const users = parseHtpasswd(`alice:${yHash}\n`);
    expect(users.get('alice')).toBe(yHash);
  });

  // Note: it.each rows evaluate at collection time (before beforeEach),
  // so hashes here are computed inline rather than via the `hash` variable.
  it.each([
    ['no colon at all', 'not-a-valid-line', 1],
    ['empty user', `:${bcrypt.hashSync(PASSWORD, 4)}`, 1],
    ['non-bcrypt hash', 'alice:notahash', 1],
    ['second line malformed', `${bcrypt.hashSync(PASSWORD, 4)}`, 0, true],
  ])('throws with the line number when %s', (_label, contents, line, twoLines = false) => {
    const input = twoLines ? `alice:${contents}\nbroken` : contents;
    const expected = twoLines ? 2 : line;
    expect(() => parseHtpasswd(input)).toThrow(new RegExp(`line ${expected}`));
  });

  it('throws on duplicate users', () => {
    expect(() => parseHtpasswd(`alice:${hash}\nalice:${hash}\n`)).toThrow(/duplicate/i);
  });

  it('throws on empty input (fail-closed)', () => {
    expect(() => parseHtpasswd('')).toThrow();
    expect(() => parseHtpasswd('\n# only a comment\n')).toThrow();
  });
});

describe('loadAuthConfig', () => {
  let dir;
  let loaders;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'circuschief-auth-'));
    loaders = [];
  });

  afterEach(() => {
    for (const loader of loaders) loader.close();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function load(file) {
    const loader = loadAuthConfig(file);
    loaders.push(loader);
    return loader;
  }

  it('loads users from a valid file', () => {
    const file = join(dir, '.htpasswd');
    writeFileSync(file, `${htpasswdLine('alice')}\n`);
    const config = load(file);
    expect(config.users.has('alice')).toBe(true);
  });

  it('throws AUTH_FILE_MISSING for a missing file', () => {
    const missing = join(dir, 'nope.htpasswd');
    let caught = null;
    try {
      load(missing);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('AUTH_FILE_MISSING');
  });

  it('throws for a directory path', () => {
    expect(() => load(dir)).toThrow();
  });

  it('throws for a malformed file', () => {
    const file = join(dir, '.htpasswd');
    writeFileSync(file, 'broken-line\n');
    expect(() => load(file)).toThrow(/line 1/);
  });

  it('warns but does not throw on world-readable permissions', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = join(dir, '.htpasswd');
    writeFileSync(file, `${htpasswdLine('alice')}\n`);
    chmodSync(file, 0o644);
    expect(() => load(file)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('permissions'));
  });
});

describe('verifyBasicHeader', () => {
  let users;

  beforeEach(() => {
    users = new Map([['alice', bcrypt.hashSync(PASSWORD, 4)]]);
  });

  it('returns the username for valid credentials', async () => {
    await expect(verifyBasicHeader(users, basicHeader('alice', PASSWORD))).resolves.toBe('alice');
  });

  it('returns null for wrong password', async () => {
    await expect(verifyBasicHeader(users, basicHeader('alice', 'wrong'))).resolves.toBeNull();
  });

  it('returns null for unknown user', async () => {
    await expect(verifyBasicHeader(users, basicHeader('mallory', PASSWORD))).resolves.toBeNull();
  });

  it('returns null without a header', async () => {
    await expect(verifyBasicHeader(users, undefined)).resolves.toBeNull();
  });

  it('returns null for a non-Basic scheme', async () => {
    await expect(verifyBasicHeader(users, 'Bearer abc123')).resolves.toBeNull();
  });

  it('returns null for malformed base64', async () => {
    await expect(verifyBasicHeader(users, 'Basic %%%')).resolves.toBeNull();
  });
});

describe('createAuthMiddleware', () => {
  let users;

  beforeEach(() => {
    users = new Map([['alice', bcrypt.hashSync(PASSWORD, 4)]]);
  });

  function authedApp() {
    const app = express();
    app.use(createAuthMiddleware({ users }));
    app.get('/api/projects', (_req, res) => res.json({ ok: true, user: _req.authUser }));
    return app;
  }

  it('returns 401 + challenge without credentials', async () => {
    const res = await request(authedApp()).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Basic realm="${AUTH_REALM}"`);
  });

  it('returns byte-identical 401 bodies for wrong password and unknown user', async () => {
    const app = authedApp();
    const wrong = await request(app).get('/api/projects').set('Authorization', basicHeader('alice', 'wrong'));
    const unknown = await request(app).get('/api/projects').set('Authorization', basicHeader('mallory', PASSWORD));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.text).toBe(unknown.text);
  });

  it('passes valid credentials through with req.authUser set', async () => {
    const res = await request(authedApp())
      .get('/api/projects')
      .set('Authorization', basicHeader('alice', PASSWORD));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, user: 'alice' });
  });

  it('rejects malformed base64 and non-Basic schemes with 401', async () => {
    const app = authedApp();
    const malformed = await request(app).get('/api/projects').set('Authorization', 'Basic %%%');
    const bearer = await request(app).get('/api/projects').set('Authorization', 'Bearer abc');
    expect(malformed.status).toBe(401);
    expect(bearer.status).toBe(401);
  });

  describe('resolveStartupAuth', () => {
    let dir;
    let configs;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'circuschief-auth-startup-'));
      configs = [];
    });

    afterEach(() => {
      for (const config of configs) config?.close?.();
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('disabled returns null without touching the filesystem', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = resolveStartupAuth({ authEnabled: false, authFile: join(dir, 'missing.htpasswd') });
      expect(config).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('enabled with a missing file throws AUTH_FILE_MISSING', () => {
      expect(() => resolveStartupAuth({ authEnabled: true, authFile: join(dir, 'missing.htpasswd') }))
        .toThrow(expect.objectContaining({ code: 'AUTH_FILE_MISSING' }));
    });

    it('enabled with a valid file returns the loaded config', () => {
      const file = join(dir, '.htpasswd');
      writeFileSync(file, `${htpasswdLine('alice')}\n`);
      const config = resolveStartupAuth({ authEnabled: true, authFile: file });
      configs.push(config);
      expect(config.users.has('alice')).toBe(true);
    });
  });

  it('createAuthMiddleware(null) is a pass-through mounting nothing observable', async () => {
    const app = express();
    app.use(createAuthMiddleware(null));
    app.get('/api/projects', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});
