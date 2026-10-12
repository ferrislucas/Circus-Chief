import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authRequired,
  authorizedFetch,
  clearCredentials,
  isAuthRequired,
  setCredentials,
} from './auth.js';

describe('authorizedFetch (shared auth-aware fetch)', () => {
  beforeEach(() => {
    clearCredentials();
    authRequired.value = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCredentials();
    authRequired.value = false;
  });

  it('injects the stored Basic header', async () => {
    setCredentials('alice', 's3cret');
    await authorizedFetch('/api/sessions/x/streaming-state');
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/x/streaming-state',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('alice:s3cret')}`,
        }),
      })
    );
  });

  it('sends no Authorization header when logged out', async () => {
    await authorizedFetch('/api/settings/general');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it('merges with caller-provided headers and init', async () => {
    setCredentials('alice', 's3cret');
    const controller = new AbortController();
    await authorizedFetch('/api/sessions/x/streaming-state', {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/x/streaming-state',
      expect.objectContaining({
        signal: controller.signal,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('alice:s3cret')}`,
        }),
      })
    );
  });

  it('funnels 401 into notifyAuthRequired but still returns the response', async () => {
    setCredentials('alice', 's3cret');
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 });
    const res = await authorizedFetch('/api/sessions/x/streaming-state');
    expect(res.status).toBe(401);
    expect(isAuthRequired()).toBe(true);
  });
});
