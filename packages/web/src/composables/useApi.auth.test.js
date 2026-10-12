import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useApi } from './useApi.js';
import {
  authRequired,
  clearCredentials,
  isAuthRequired,
  setCredentials,
} from '../api/auth.js';

describe('useApi auth handling', () => {
  beforeEach(() => {
    clearCredentials();
    authRequired.value = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCredentials();
    authRequired.value = false;
  });

  it('attaches the stored Basic header to requests', async () => {
    setCredentials('alice', 's3cret');
    const { get } = useApi();
    await get('/projects');
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('alice:s3cret')}`,
        }),
      })
    );
  });

  it('funnels 401 into the login gate', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });
    const { get } = useApi();
    await expect(get('/projects')).rejects.toThrow();
    expect(isAuthRequired()).toBe(true);
  });
});
