import { verifyBasicHeader, AUTH_REALM } from '../middleware/basicAuth.js';

/**
 * Path filter preserving the old `new WebSocketServer({ server, path })`
 * behavior: only `/ws` upgrades are handled, everything else is left for
 * other listeners.
 */
export function isWsUpgradeRequest(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname === '/ws';
  } catch {
    return false;
  }
}

/** Answer a rejected upgrade with a 401 challenge and destroy the socket. */
export function rejectUpgrade(socket) {
  const body = 'Unauthorized';
  socket.write(
    `HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="${AUTH_REALM}"\r\n` +
    `Content-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`
  );
  socket.destroy();
}

/**
 * Build the `upgrade` listener for a `noServer`-mode WebSocketServer.
 * Failures get a 401 and a destroyed socket; the client never becomes a
 * connection. `getUsers` is called per upgrade so credential rotation
 * (via the shared startup loader) applies without a restart.
 *
 * @param {object} options
 * @param {import('ws').WebSocketServer} options.wss
 * @param {Function} options.getUsers - Returns the live user→hash Map, or null when auth is off.
 */
export function createUpgradeGate({ wss, getUsers }) {
  return async (req, socket, head) => {
    if (!isWsUpgradeRequest(req)) return;

    const users = getUsers();
    if (users) {
      let user = null;
      try {
        user = await verifyBasicHeader(users, req.headers.authorization);
      } catch {
        user = null;
      }
      if (!user) {
        rejectUpgrade(socket);
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
}
