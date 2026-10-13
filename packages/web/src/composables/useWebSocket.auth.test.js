import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Real vue refs here (unlike useWebSocket.test.js, which mocks vue).
import { useWebSocket } from './useWebSocket.js';
import {
  authRequired,
  clearCredentials,
  getBasicCredentials,
  login,
  notifyAuthRequired,
} from '../api/auth.js';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send() {}
  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const originalWebSocket = globalThis.WebSocket;

describe('useWebSocket auth sequencing', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances.length = 0;
    clearCredentials();
    authRequired.value = false;
    const { disconnect } = useWebSocket();
    disconnect();
    MockWebSocket.instances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
    const { disconnect } = useWebSocket();
    disconnect();
    clearCredentials();
    authRequired.value = false;
  });

  it('connects immediately when no auth challenge has occurred', async () => {
    useWebSocket();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url.endsWith('/ws')).toBe(true);
    expect(MockWebSocket.instances[0].url).not.toContain('@');
  });

  it('defers connecting while a challenge is unresolved and connects after login', async () => {
    notifyAuthRequired();
    useWebSocket();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(MockWebSocket.instances.length).toBe(0);

    await login('alice', 's3cret', async () => ({}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('embeds stored credentials in the WebSocket URL (no header support)', async () => {
    await login('alice', 's3cret', async () => ({}));
    expect(getBasicCredentials()).not.toBeNull();
    useWebSocket();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const url = MockWebSocket.instances[0].url;
    expect(url).toContain('alice:s3cret@');
    expect(url.endsWith('/ws')).toBe(true);
  });
});
