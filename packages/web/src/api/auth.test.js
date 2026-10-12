import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUTH_REQUIRED_CODE,
  authRequired,
  buildAuthHeader,
  getAuthorizationHeader,
  getBasicCredentials,
  hasCredentials,
  setCredentials,
  clearCredentials,
  isAuthRequired,
  notifyAuthRequired,
  onAuthRequired,
  onAuthed,
  login,
  logout,
} from './auth.js';

describe('auth store (memory-only Basic credentials)', () => {
  beforeEach(() => {
    clearCredentials();
    authRequired.value = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCredentials();
    authRequired.value = false;
  });

  it('builds a Basic header from credentials', () => {
    setCredentials('alice', 's3cret');
    expect(buildAuthHeader('alice', 's3cret')).toBe(`Basic ${btoa('alice:s3cret')}`);
    expect(getAuthorizationHeader()).toBe(`Basic ${btoa('alice:s3cret')}`);
  });

  it('builds a valid header for non-Latin1 credentials (no InvalidCharacterError)', () => {
    const header = buildAuthHeader('user', 'pässwörd-🔑-中文');
    expect(header.startsWith('Basic ')).toBe(true);
    // The server decodes the same bytes back to the original pair.
    const binary = atob(header.slice('Basic '.length));
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
    expect(decoded).toBe('user:pässwörd-🔑-中文');
  });

  it('returns null header when logged out', () => {
    expect(getAuthorizationHeader()).toBeNull();
    expect(hasCredentials()).toBe(false);
    expect(getBasicCredentials()).toBeNull();
  });

  it('exposes the raw pair for WebSocket URL embedding only', () => {
    setCredentials('alice', 's3cret');
    expect(getBasicCredentials()).toEqual({ username: 'alice', password: 's3cret' });
  });

  it('never persists credentials to storage', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    setCredentials('alice', 's3cret');
    notifyAuthRequired();
    expect(setSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth')).toBeNull();
    setSpy.mockRestore();
  });

  it('notifyAuthRequired flips the required flag and notifies subscribers', () => {
    const cb = vi.fn();
    const unsub = onAuthRequired(cb);
    notifyAuthRequired();
    expect(isAuthRequired()).toBe(true);
    expect(authRequired.value).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('login stores credentials and verifies once with the stored header', async () => {
    const verify = vi.fn().mockResolvedValue({ ok: true });
    await login('alice', 's3cret', verify);
    expect(hasCredentials()).toBe(true);
    expect(getAuthorizationHeader()).toBe(`Basic ${btoa('alice:s3cret')}`);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(isAuthRequired()).toBe(false);
  });

  it('login fires authed subscribers on success', async () => {
    const cb = vi.fn();
    const unsub = onAuthed(cb);
    await login('alice', 's3cret', async () => ({}));
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('login clears credentials when verification fails with AUTH_REQUIRED', async () => {
    const err = new Error('Authentication required');
    err.code = AUTH_REQUIRED_CODE;
    await expect(login('alice', 'wrong', async () => { throw err; })).rejects.toMatchObject({
      code: AUTH_REQUIRED_CODE,
    });
    expect(hasCredentials()).toBe(false);
    expect(isAuthRequired()).toBe(true);
  });

  it('logout clears credentials', async () => {
    await login('alice', 's3cret', async () => ({}));
    logout();
    expect(hasCredentials()).toBe(false);
    expect(getAuthorizationHeader()).toBeNull();
  });
});
