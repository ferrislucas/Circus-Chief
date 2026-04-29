import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for fetchWithAuth.
 *
 * The module captures globalThis.fetch at import time as `originalFetch`.
 * To test the patched fetch behavior, we need to control what "original fetch"
 * returns. We do this by setting up a mock on globalThis.fetch BEFORE
 * the test module is imported (vi.hoisted or top-level vi.fn), then
 * calling the patched fetch which calls through to our mock.
 */

// Capture the mock reference before the module is imported
const mockOriginalFetch = vi.fn();

// Replace global fetch before the module captures it
const savedFetch = globalThis.fetch;
globalThis.fetch = mockOriginalFetch;

// Import after mock is set up so the module captures our mock as "original"
const {
  initFetchAuth,
  getAuthHeaderValue,
  getAuthToken,
  getOriginalFetch,
  reset401Handled,
} = await import('./fetchWithAuth.js');

describe('fetchWithAuth', () => {
  let mockAuthStore;
  let mockRouter;

  beforeEach(() => {
    mockAuthStore = {
      authHeader: { value: undefined },
      authToken: { value: undefined },
      markRequired: vi.fn(),
    };
    mockRouter = {
      push: vi.fn(),
    };
    mockOriginalFetch.mockReset();
  });

  afterEach(() => {
    // Restore original fetch so we don't pollute other tests
    globalThis.fetch = savedFetch;
    reset401Handled();
  });

  describe('before initialization', () => {
    it('getAuthHeaderValue returns undefined', () => {
      expect(getAuthHeaderValue()).toBeUndefined();
    });

    it('getAuthToken returns undefined', () => {
      expect(getAuthToken()).toBeUndefined();
    });
  });

  describe('getOriginalFetch', () => {
    it('returns the fetch that was captured at import time', () => {
      expect(getOriginalFetch()).toBe(mockOriginalFetch);
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      initFetchAuth(mockAuthStore, mockRouter);
    });

    it('patches globalThis.fetch', () => {
      expect(globalThis.fetch).not.toBe(mockOriginalFetch);
    });

    it('getOriginalFetch still returns the pre-init fetch', () => {
      expect(getOriginalFetch()).toBe(mockOriginalFetch);
    });

    describe('auth header injection', () => {
      it('does not add Authorization header when store has no credentials', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 200 }));

        await globalThis.fetch('/api/test');

        expect(mockOriginalFetch).toHaveBeenCalledWith('/api/test', {});
      });

      it('injects Authorization header when store has credentials', async () => {
        const token = btoa('admin:secret');
        mockAuthStore.authHeader.value = `Basic ${token}`;
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 200 }));

        await globalThis.fetch('/api/test');

        expect(mockOriginalFetch).toHaveBeenCalledWith('/api/test', {
          headers: { Authorization: `Basic ${token}` },
        });
      });

      it('merges with existing headers', async () => {
        const token = btoa('admin:secret');
        mockAuthStore.authHeader.value = `Basic ${token}`;
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 200 }));

        await globalThis.fetch('/api/test', {
          headers: { 'Content-Type': 'application/json' },
        });

        expect(mockOriginalFetch).toHaveBeenCalledWith('/api/test', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${token}`,
          },
        });
      });

      it('passes through non-200 responses', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('Not Found', { status: 404 }));

        const response = await globalThis.fetch('/api/test');

        expect(response.status).toBe(404);
        expect(mockAuthStore.markRequired).not.toHaveBeenCalled();
        expect(mockRouter.push).not.toHaveBeenCalled();
      });
    });

    describe('401 handling', () => {
      it('calls markRequired on 401', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 401 }));

        await globalThis.fetch('/api/test');

        expect(mockAuthStore.markRequired).toHaveBeenCalled();
      });

      it('redirects to /login on 401', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 401 }));

        await globalThis.fetch('/api/test');

        expect(mockRouter.push).toHaveBeenCalledWith('/login');
      });

      it('still returns the 401 response to the caller', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 401 }));

        const response = await globalThis.fetch('/api/test');

        expect(response.status).toBe(401);
      });

      it('only redirects once for concurrent 401s', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 401 }));

        // Fire multiple concurrent requests
        await Promise.all([
          globalThis.fetch('/api/test1'),
          globalThis.fetch('/api/test2'),
          globalThis.fetch('/api/test3'),
        ]);

        // markRequired may be called multiple times, but router.push should only be called once
        expect(mockRouter.push).toHaveBeenCalledTimes(1);
      });

      it('allows redirect again after reset401Handled', async () => {
        mockOriginalFetch.mockResolvedValue(new Response('{}', { status: 401 }));

        await globalThis.fetch('/api/test1');
        expect(mockRouter.push).toHaveBeenCalledTimes(1);

        reset401Handled();

        await globalThis.fetch('/api/test2');
        expect(mockRouter.push).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('reset401Handled', () => {
    it('does not throw', () => {
      expect(() => reset401Handled()).not.toThrow();
    });
  });
});
