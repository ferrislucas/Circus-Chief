import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth.js';

// Mock getOriginalFetch from fetchWithAuth — login() uses this instead of global fetch
const mockOriginalFetch = vi.fn();
vi.mock('../api/fetchWithAuth.js', () => ({
  getOriginalFetch: () => mockOriginalFetch,
  reset401Handled: () => {},
}));

describe('Auth Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has null credentials initially', () => {
      const store = useAuthStore();
      expect(store.credentials).toBeNull();
    });

    it('is not authenticated initially', () => {
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
    });

    it('does not require auth initially', () => {
      const store = useAuthStore();
      expect(store.required).toBe(false);
    });
  });

  describe('markRequired', () => {
    it('sets required to true', () => {
      const store = useAuthStore();
      store.markRequired();
      expect(store.required).toBe(true);
    });
  });

  describe('isAuthenticated computed', () => {
    it('returns true when credentials are set', () => {
      const store = useAuthStore();
      store.credentials = { username: 'admin', password: 'pass' };
      expect(store.isAuthenticated).toBe(true);
    });

    it('returns false when credentials are null', () => {
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe('authHeader computed', () => {
    it('returns undefined when not authenticated', () => {
      const store = useAuthStore();
      expect(store.authHeader).toBeUndefined();
    });

    it('returns Basic header when authenticated', () => {
      const store = useAuthStore();
      store.credentials = { username: 'admin', password: 'secret' };
      const expected = `Basic ${btoa('admin:secret')}`;
      expect(store.authHeader).toBe(expected);
    });
  });

  describe('authToken computed', () => {
    it('returns undefined when not authenticated', () => {
      const store = useAuthStore();
      expect(store.authToken).toBeUndefined();
    });

    it('returns base64 token when authenticated', () => {
      const store = useAuthStore();
      store.credentials = { username: 'admin', password: 'secret' };
      expect(store.authToken).toBe(btoa('admin:secret'));
    });
  });

  describe('login', () => {
    it('sets credentials on successful login', async () => {
      const store = useAuthStore();
      mockOriginalFetch.mockResolvedValue({ ok: true, status: 200 });

      await store.login('admin', 'secret');

      expect(store.credentials).toEqual({ username: 'admin', password: 'secret' });
      expect(store.required).toBe(true);
    });

    it('throws on 401 response', async () => {
      const store = useAuthStore();
      mockOriginalFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });

      await expect(store.login('admin', 'wrong')).rejects.toThrow('Invalid username or password');
      expect(store.credentials).toBeNull();
    });

    it('throws on non-ok response', async () => {
      const store = useAuthStore();
      mockOriginalFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

      await expect(store.login('admin', 'secret')).rejects.toThrow('Login failed: Internal Server Error');
    });

    it('sends Authorization header with credentials', async () => {
      const store = useAuthStore();
      mockOriginalFetch.mockResolvedValue({ ok: true, status: 200 });

      await store.login('admin', 'secret');

      expect(mockOriginalFetch).toHaveBeenCalledWith('/api/settings/general', {
        headers: {
          Authorization: `Basic ${btoa('admin:secret')}`,
        },
      });
    });
  });

  describe('logout', () => {
    it('clears credentials', () => {
      const store = useAuthStore();
      store.credentials = { username: 'admin', password: 'secret' };
      store.logout();
      expect(store.credentials).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });
  });
});
