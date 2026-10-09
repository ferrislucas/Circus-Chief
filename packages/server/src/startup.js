import { describeBindHost, isWildcardAddress } from './bindAddress.js';

/**
 * Install the listen-phase bind-failure handler on a server.
 *
 * MUST be called before the WebSocket layer attaches to the server: `ws`
 * forwards the HTTP server's 'error' event onto itself, and a bind failure
 * re-emitted on the WebSocketServer has no listener — an Unhandled 'error'
 * crash that beats this handler to process.exit. Registered first, this
 * handler runs first and exits cleanly with a diagnosis.
 *
 * The handler is removed by `startServer` once listening succeeds.
 *
 * @param {import('http').Server} server - Server that will be bound.
 * @param {object} options
 * @param {number} options.port - Port that will be listened on.
 * @param {string} options.host - Bind address as resolved by the CLI.
 * @returns {{ onListenFailure: Function }} The installed handler.
 */
export function prepareBindFailureHandler(server, { port, host }) {
  const onListenFailure = (err) => {
    console.error(`Error: failed to bind to ${host}:${port}: ${err.code || err.message}`);
    process.exit(1);
  };

  server.once('error', onListenFailure);
  return { onListenFailure };
}

/**
 * Bind the HTTP server and log the startup banner.
 *
 * Extracted from the entry point so the security-relevant bind behavior is
 * unit-testable: which address is bound, what the banner says, and how bind
 * failures versus post-startup server errors are handled.
 *
 * Error handling has two distinct phases:
 * - Listen phase: the handler installed by `prepareBindFailureHandler`
 *   reports the bind failure and exits non-zero. A failed bind must not
 *   leave a live, non-listening process behind at exit code 0.
 * - Post-listen phase: that handler is removed and replaced by one that only
 *   logs. A transient accept error (e.g. EMFILE under fd pressure) on a
 *   healthy server must not `process.exit` — that would skip graceful
 *   shutdown and orphan agent child processes.
 *
 * @param {import('http').Server} server - Server to bind.
 * @param {object} options
 * @param {number} options.port - Port to listen on.
 * @param {string} options.host - Bind address as resolved by the CLI.
 * @param {boolean} options.isDefaultHost - Whether `host` is the loopback
 *   default (drives the loopback-only hint line in the banner).
 * @param {Function} [options.onListenFailure] - Handler previously installed
 *   by `prepareBindFailureHandler`; defaults to installing a fresh one for
 *   callers (and tests) that attach no WebSocket layer.
 * @returns {void}
 */
export function startServer(server, { port, host, isDefaultHost, onListenFailure }) {
  let failBind = onListenFailure;
  if (!failBind) {
    ({ onListenFailure: failBind } = prepareBindFailureHandler(server, { port, host }));
  }

  server.listen(port, host, () => {
    server.removeListener('error', failBind);
    server.on('error', (err) => {
      console.error(`Server error after startup: ${err.code || err.message}`);
    });

    // The resolved address is authoritative regardless of the input form
    // ('0', '::ffff:0.0.0.0', and hostnames all expand or resolve here).
    const bound = server.address();
    const { urlHost } = describeBindHost(bound.address);

    console.log(`Circus Chief running on http://${urlHost}:${bound.port}`);
    console.log(`WebSocket available at ws://${urlHost}:${bound.port}/ws`);

    if (isWildcardAddress(bound.address)) {
      console.warn(
        `Warning: bound to all interfaces (${bound.address}) — the API is unauthenticated; anyone who can reach this port can run commands on this machine.`
      );
    } else if (isDefaultHost) {
      console.log('Bound to 127.0.0.1 (loopback only — pass --host 0.0.0.0 for LAN/Docker access)');
    }
  });
}
