import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import {
  WebSocketManager,
  webSocketManager,
  initWebSocket,
  broadcast,
  broadcastToSession,
  getWebSocketServer,
} from '../src/websocket.js';
import { WS_MESSAGE_TYPES, createMessage } from '@claudetools/shared';

describe('WebSocketManager', () => {
  let server;
  let manager;
  let port;

  beforeEach(async () => {
    // Create a fresh manager for each test
    manager = new WebSocketManager();

    // Create HTTP server on random port
    server = createServer();
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    manager.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const connectClient = () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  };

  const waitForMessage = (ws) => {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
  };

  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(WebSocketManager).toBeTypeOf('function');
      expect(manager).toBeInstanceOf(WebSocketManager);
    });

    it('exports singleton instance', () => {
      expect(webSocketManager).toBeInstanceOf(WebSocketManager);
    });

    it('has required methods', () => {
      expect(manager.init).toBeTypeOf('function');
      expect(manager.broadcast).toBeTypeOf('function');
      expect(manager.broadcastToSession).toBeTypeOf('function');
      expect(manager.getServer).toBeTypeOf('function');
      expect(manager.getClients).toBeTypeOf('function');
      expect(manager.getSessionSubscriptions).toBeTypeOf('function');
      expect(manager.close).toBeTypeOf('function');
    });
  });

  describe('init', () => {
    it('creates WebSocket server on specified path', () => {
      const wss = manager.init(server);

      expect(wss).toBeDefined();
      expect(manager.getServer()).toBe(wss);
    });

    it('tracks connected clients', async () => {
      manager.init(server);

      expect(manager.getClients().size).toBe(0);

      const ws = await connectClient();
      expect(manager.getClients().size).toBe(1);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(manager.getClients().size).toBe(0);
    });
  });

  describe('subscriptions', () => {
    it('subscribes client to session', async () => {
      manager.init(server);
      const ws = await connectClient();

      // Send subscribe message
      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.has('sess-123')).toBe(true);
      expect(subscriptions.get('sess-123').size).toBe(1);

      ws.close();
    });

    it('unsubscribes client from session', async () => {
      manager.init(server);
      const ws = await connectClient();

      // Subscribe
      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Unsubscribe
      ws.send(createMessage(WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.get('sess-123').size).toBe(0);

      ws.close();
    });

    it('removes client from subscriptions on disconnect', async () => {
      manager.init(server);
      const ws = await connectClient();

      // Subscribe
      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.getSessionSubscriptions().get('sess-123').size).toBe(1);

      // Disconnect
      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.getSessionSubscriptions().get('sess-123').size).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('broadcasts to all connected clients', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();

      const msg1Promise = waitForMessage(ws1);
      const msg2Promise = waitForMessage(ws2);

      manager.broadcast('TEST_MESSAGE', { data: 'hello' });

      const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

      expect(msg1.type).toBe('TEST_MESSAGE');
      expect(msg1.data).toBe('hello');
      expect(msg2.type).toBe('TEST_MESSAGE');
      expect(msg2.data).toBe('hello');

      ws1.close();
      ws2.close();
    });

    it('broadcasts only to session subscribers', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();

      // Only ws1 subscribes to session
      ws1.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const msg1Promise = waitForMessage(ws1);

      // Track if ws2 receives anything
      let ws2Received = false;
      ws2.once('message', () => {
        ws2Received = true;
      });

      manager.broadcastToSession('sess-123', 'SESSION_MESSAGE', { data: 'test' });

      const msg1 = await msg1Promise;
      expect(msg1.type).toBe('SESSION_MESSAGE');
      expect(msg1.data).toBe('test');

      // Wait a bit to ensure ws2 doesn't receive
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ws2Received).toBe(false);

      ws1.close();
      ws2.close();
    });

    it('skips clients with closed connections', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();

      // Close ws1
      ws1.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const msgPromise = waitForMessage(ws2);

      // Should not throw even though ws1 is closed
      manager.broadcast('TEST_MESSAGE', { data: 'hello' });

      const msg = await msgPromise;
      expect(msg.type).toBe('TEST_MESSAGE');

      ws2.close();
    });

    it('does nothing for non-existent session', () => {
      manager.init(server);

      // Should not throw
      expect(() => {
        manager.broadcastToSession('non-existent', 'TEST', {});
      }).not.toThrow();
    });
  });

  describe('close', () => {
    it('closes WebSocket server and clears state', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.getClients().size).toBe(1);
      expect(manager.getSessionSubscriptions().size).toBe(1);

      // Close client first to avoid hanging
      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.close();

      expect(manager.getServer()).toBeNull();
      expect(manager.getClients().size).toBe(0);
      expect(manager.getSessionSubscriptions().size).toBe(0);
    });
  });

  describe('legacy function exports', () => {
    it('exports backward-compatible functions', () => {
      expect(initWebSocket).toBeTypeOf('function');
      expect(broadcast).toBeTypeOf('function');
      expect(broadcastToSession).toBeTypeOf('function');
      expect(getWebSocketServer).toBeTypeOf('function');
    });
  });
});
