import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWebSocketUrl } from './useWebSocket.js';
import { authRequired, clearCredentials, setCredentials } from '../api/auth.js';

describe('getWebSocketUrl Basic userinfo encoding', () => {
  beforeEach(() => {
    clearCredentials();
    authRequired.value = false;
  });

  afterEach(() => {
    clearCredentials();
    authRequired.value = false;
  });

  it('builds a plain /ws URL with no userinfo when logged out', () => {
    const url = getWebSocketUrl();
    expect(url.endsWith('/ws')).toBe(true);
    expect(url).not.toContain('@');
  });

  it('percent-encodes spaces, @, :, and non-Latin1 credentials', () => {
    setCredentials('us er@x', 'päss:wörd/🔑-中文');
    const url = getWebSocketUrl();
    expect(url.endsWith('/ws')).toBe(true);
    const userinfo = url.split('//')[1].split('@').slice(0, -1).join('@');
    // No literal spaces, @-signs, or non-ASCII bytes survive in userinfo.
    expect(userinfo).not.toMatch(/[@\s]/);
    expect([...userinfo].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    // The userinfo round-trips to the original pair (split on the single
    // literal ':' — encodeURIComponent escapes every ':' inside the values).
    const [encUser, encPass] = userinfo.split(':');
    expect(decodeURIComponent(encUser)).toBe('us er@x');
    expect(decodeURIComponent(encPass)).toBe('päss:wörd/🔑-中文');
  });
});
