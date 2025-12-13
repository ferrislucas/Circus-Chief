import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import { WebSocketManager } from './WebSocketManager.js';
import { WS_MESSAGE_TYPES, createMessage } from '@claudetools/shared';

describe('WebSocketManager', () => {
  let server;
  let manager;
  let port;

  beforeEach(async () => {
    manager = new WebSocketManager();

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

  describe('constructor', () => {
    it('creates a new instance', () => {
      const instance = new WebSocketManager();
      expect(instance).toBeInstanceOf(WebSocketManager);
    });

    it('starts with no server', () => {
      const instance = new WebSocketManager();
      expect(instance.getServer()).toBeNull();
    });

    it('starts with empty clients set', () => {
      const instance = new WebSocketManager();
      expect(instance.getClients().size).toBe(0);
    });

    it('starts with empty subscriptions map', () => {
      const instance = new WebSocketManager();
      expect(instance.getSessionSubscriptions().size).toBe(0);
    });
  });

  describe('init', () => {
    it('creates WebSocket server', () => {
      const wss = manager.init(server);

      expect(wss).toBeDefined();
      expect(manager.getServer()).toBe(wss);
    });

    it('returns WebSocket server instance', () => {
      const wss = manager.init(server);
      expect(wss.constructor.name).toBe('WebSocketServer');
    });
  });

  describe('client tracking', () => {
    it('tracks connected clients', async () => {
      manager.init(server);

      expect(manager.getClients().size).toBe(0);

      const ws = await connectClient();
      expect(manager.getClients().size).toBe(1);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(manager.getClients().size).toBe(0);
    });

    it('tracks multiple clients', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();
      const ws3 = await connectClient();

      expect(manager.getClients().size).toBe(3);

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });

  describe('session subscriptions', () => {
    it('subscribes client to session', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.has('sess-123')).toBe(true);
      expect(subscriptions.get('sess-123').size).toBe(1);

      ws.close();
    });

    it('subscribes multiple clients to same session', async () => {
      manager.init(server);
      const ws1 = await connectClient();
      const ws2 = await connectClient();

      ws1.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      ws2.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.get('sess-123').size).toBe(2);

      ws1.close();
      ws2.close();
    });

    it('unsubscribes client from session', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.send(createMessage(WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.get('sess-123').size).toBe(0);

      ws.close();
    });

    it('removes client from all subscriptions on disconnect', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-1' }));
      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-2' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscriptions = manager.getSessionSubscriptions();
      expect(subscriptions.get('sess-1').size).toBe(0);
      expect(subscriptions.get('sess-2').size).toBe(0);
    });

    it('ignores subscribe without sessionId', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, {}));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(manager.getSessionSubscriptions().size).toBe(0);

      ws.close();
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

    it('skips closed connections', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();

      ws1.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const msgPromise = waitForMessage(ws2);

      manager.broadcast('TEST_MESSAGE', { data: 'hello' });

      const msg = await msgPromise;
      expect(msg.type).toBe('TEST_MESSAGE');

      ws2.close();
    });
  });

  describe('broadcastToSession', () => {
    it('broadcasts only to session subscribers', async () => {
      manager.init(server);

      const ws1 = await connectClient();
      const ws2 = await connectClient();

      ws1.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const msg1Promise = waitForMessage(ws1);

      let ws2Received = false;
      ws2.once('message', () => {
        ws2Received = true;
      });

      manager.broadcastToSession('sess-123', 'SESSION_MSG', { data: 'test' });

      const msg1 = await msg1Promise;
      expect(msg1.type).toBe('SESSION_MSG');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ws2Received).toBe(false);

      ws1.close();
      ws2.close();
    });

    it('does nothing for non-existent session', () => {
      manager.init(server);

      expect(() => {
        manager.broadcastToSession('non-existent', 'TEST', {});
      }).not.toThrow();
    });
  });

  describe('getServer', () => {
    it('returns null before init', () => {
      expect(manager.getServer()).toBeNull();
    });

    it('returns server after init', () => {
      manager.init(server);
      expect(manager.getServer()).not.toBeNull();
    });
  });

  describe('close', () => {
    it('closes server and clears state', async () => {
      manager.init(server);
      const ws = await connectClient();

      ws.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId: 'sess-123' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.close();

      expect(manager.getServer()).toBeNull();
      expect(manager.getClients().size).toBe(0);
      expect(manager.getSessionSubscriptions().size).toBe(0);
    });

    it('can be called multiple times safely', () => {
      manager.init(server);
      manager.close();
      manager.close();
      // Should not throw
    });

    it('can be called without init', () => {
      const newManager = new WebSocketManager();
      expect(() => newManager.close()).not.toThrow();
    });
  });
});
