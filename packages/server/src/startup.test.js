import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { startServer, prepareBindFailureHandler } from './startup.js';

/**
 * Bind real servers on ephemeral ports (port 0) so these tests assert the
 * behavior the loopback default is actually about: which address the OS
 * bound, what the startup banner claims, and how listen-phase versus
 * post-startup errors are handled.
 */
describe('startServer', () => {
  let exitSpy;
  let logSpy;
  let warnSpy;
  let errorSpy;
  const servers = [];

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise((resolve) => {
            server.removeAllListeners('error');
            server.close(() => resolve());
          })
      )
    );
  });

  function makeServer() {
    const server = createServer(() => {});
    servers.push(server);
    return server;
  }

  function listen(server, { port = 0 } = {}) {
    return new Promise((resolve, reject) => {
      const onEarlyError = (err) => reject(err);
      server.once('error', onEarlyError);
      startServer(server, {
        port,
        host: server.__testHost || '127.0.0.1',
        isDefaultHost: (server.__testHost || '127.0.0.1') === '127.0.0.1',
      });
      const poll = setInterval(() => {
        if (server.listening) {
          clearInterval(poll);
          server.removeListener('error', onEarlyError);
          resolve(server.address());
        }
      }, 5);
      poll.unref?.();
    });
  }

  it('binds loopback by default', async () => {
    const server = makeServer();
    const bound = await listen(server);
    expect(bound.address).toBe('127.0.0.1');
  });

  it('passes an explicit wildcard through to listen()', async () => {
    const server = makeServer();
    server.__testHost = '0.0.0.0';
    const bound = await listen(server);
    expect(bound.address).toBe('0.0.0.0');
  });

  describe('startup banner', () => {
    it('announces the bound address and port', async () => {
      const server = makeServer();
      const bound = await listen(server);
      expect(logSpy).toHaveBeenCalledWith(`Circus Chief running on http://127.0.0.1:${bound.port}`);
      expect(logSpy).toHaveBeenCalledWith(`WebSocket available at ws://127.0.0.1:${bound.port}/ws`);
    });

    it('shows the loopback-only hint when the default host is used', async () => {
      const server = makeServer();
      await listen(server);
      expect(logSpy).toHaveBeenCalledWith(
        'Bound to 127.0.0.1 (loopback only — pass --host 0.0.0.0 for LAN/Docker access)'
      );
    });

    it('omits the loopback-only hint for a non-default host', async () => {
      const server = makeServer();
      server.__testHost = '0.0.0.0';
      await listen(server);
      expect(logSpy).not.toHaveBeenCalledWith(
        'Bound to 127.0.0.1 (loopback only — pass --host 0.0.0.0 for LAN/Docker access)'
      );
    });
  });

  describe('wildcard warning', () => {
    it('warns when the resolved address is a wildcard', async () => {
      const server = makeServer();
      server.__testHost = '0.0.0.0';
      await listen(server);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bound to all interfaces'));
    });

    it('warns for the numeric shorthand --host 0', async () => {
      const server = makeServer();
      server.__testHost = '0';
      const bound = await listen(server);
      // Node resolves '0' to 0.0.0.0 at bind time; the warning must fire and
      // the banner must not print the nonsensical http://0:<port>.
      expect(bound.address).toBe('0.0.0.0');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bound to all interfaces'));
      expect(logSpy).toHaveBeenCalledWith(`Circus Chief running on http://localhost:${bound.port}`);
    });

    it('does not warn for loopback', async () => {
      const server = makeServer();
      await listen(server);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('bound to all interfaces'));
    });
  });

  describe('bind failure', () => {
    it('reports the failure and exits non-zero', async () => {
      // Record rather than throw: libuv emits the listen error on a later
      // tick (emitErrorNT), where a thrown mock would surface as an
      // uncaught exception instead of a rejection.
      exitSpy.mockImplementation(() => {});

      const blocker = createServer();
      await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
      const { port } = blocker.address();

      const server = makeServer();
      // Register our observer AFTER startServer so its once('error') handler
      // runs first, exactly as it would in production.
      const sawError = new Promise((resolve) => server.once('error', resolve));
      startServer(server, { port, host: '127.0.0.1', isDefaultHost: true });

      await sawError;

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`failed to bind to 127.0.0.1:${port}`)
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      await new Promise((resolve) => blocker.close(resolve));
    });

    it('wins over the ws-forwarded error when a WebSocket layer is attached', async () => {
      // Regression: ws's WebSocketServer({ server }) forwards the HTTP
      // server's 'error' event onto itself. If its forwarding listener sits
      // ahead of ours, a bind failure re-emits on the WebSocketServer —
      // which has no error listener — and crashes with Unhandled 'error'
      // before our diagnosis can print. Production installs our handler
      // BEFORE initWebSocket; this test pins that ordering.
      exitSpy.mockImplementation(() => {});

      const blocker = createServer();
      await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
      const { port } = blocker.address();

      const server = makeServer();
      const { onListenFailure } = prepareBindFailureHandler(server, {
        port,
        host: '127.0.0.1',
      });
      const wss = new WebSocketServer({ server, path: '/ws' });
      wss.on('error', () => {}); // don't let a re-emitted error crash the test

      const sawError = new Promise((resolve) => server.once('error', resolve));
      startServer(server, {
        port,
        host: '127.0.0.1',
        isDefaultHost: true,
        onListenFailure,
      });

      // Our handler must be first in emit order, ahead of ws's forwarding
      // listener. Assert before the error fires: once() removes itself on
      // first call, so afterwards the ordering is no longer observable.
      expect(server.listeners('error')[0]).toBe(onListenFailure);

      await sawError;

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`failed to bind to 127.0.0.1:${port}`)
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      wss.close();
      await new Promise((resolve) => blocker.close(resolve));
    });
  });

  describe('post-startup errors', () => {
    it('logs but does not exit the process', async () => {
      const server = makeServer();
      await listen(server);

      // Emit as libuv's onconnection would for a transient accept failure.
      // The persistent handler registered inside the listen callback must
      // log it; process.exit must NOT be called — that would skip graceful
      // shutdown and orphan agent child processes.
      server.emit('error', Object.assign(new Error('accept EMFILE'), { code: 'EMFILE' }));

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Server error after startup'));
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
