import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './ApiClient.js';
import { AUTH_REQUIRED_CODE, authRequired, setCredentials, clearCredentials } from './auth.js';

describe('ApiClient Basic-auth handling', () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    client = new ApiClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    clearCredentials();
    authRequired.value = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCredentials();
    authRequired.value = false;
  });

  const okResponse = (data) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });

  const unauthorizedResponse = () => Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: 'Unauthorized' }),
  });

  it('attaches the stored Basic header to requests', async () => {
    setCredentials('alice', 's3cret');
    mockFetch.mockReturnValue(okResponse([]));

    await client.getProjects();

    expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Basic ${btoa('alice:s3cret')}` }),
    }));
  });

  it('sends no Authorization header when logged out', async () => {
    mockFetch.mockReturnValue(okResponse([]));

    await client.getProjects();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('surfaces 401 as a distinct AUTH_REQUIRED error, not the generic path', async () => {
    mockFetch.mockReturnValue(unauthorizedResponse());

    const err = await client.getProjects().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(AUTH_REQUIRED_CODE);
    expect(err.status).toBe(401);
  });

  it('flags authRequired on 401 so the login view appears', async () => {
    mockFetch.mockReturnValue(unauthorizedResponse());

    await client.getProjects().catch(() => {});
    expect(authRequired.value).toBe(true);
  });

  it('non-401 errors keep the generic shape without the auth flag', async () => {
    mockFetch.mockReturnValue(Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
    }));

    const err = await client.getProjects().catch((e) => e);
    expect(err.code).toBeUndefined();
    expect(authRequired.value).toBe(false);
  });

  it('attaches the header to FormData uploads too', async () => {
    setCredentials('alice', 's3cret');
    mockFetch.mockReturnValue(okResponse({}));
    const form = new FormData();

    await client._uploadFormData('/upload', form);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe(`Basic ${btoa('alice:s3cret')}`);
  });
});
