/**
 * Shared classification of server bind addresses.
 *
 * A single home for the logic that decides, from a bind address:
 * - how to render it in a URL (`describeBindHost`)
 * - whether it exposes the server on every interface (`isWildcardAddress`)
 * - what host an agent process on the same machine should dial to reach the
 *   server (`apiHostFromBind`).
 *
 * Used by the CLI parser, the startup banner, and the agent-facing API base
 * URL so all three agree on the same spellings. Node's `listen()` accepts
 * several forms of "all interfaces" beyond the two obvious literals; the set
 * below covers the ones verified to expand to a wildcard on Linux and macOS.
 */

/**
 * Address spellings that make the server listen on all interfaces.
 * - '0.0.0.0' — all IPv4
 * - '::' — all, dual-stack (includes IPv4-mapped)
 * - '0' — numeric shorthand Node resolves to 0.0.0.0
 * - '::ffff:0.0.0.0' — IPv4-mapped wildcard, resolves to '::'
 */
export const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '0', '::ffff:0.0.0.0']);

/**
 * Return a URL-safe representation of a server bind address.
 *
 * @param {string} host - The bind address as given to `server.listen()`.
 * @returns {{ urlHost: string, wildcard: boolean }} URL host part and
 *   whether the address binds all interfaces.
 */
export function describeBindHost(host) {
  if (WILDCARD_HOSTS.has(host)) return { urlHost: 'localhost', wildcard: true };

  return { urlHost: host.includes(':') ? `[${host}]` : host, wildcard: false };
}

/**
 * Whether an address binds the server to all interfaces.
 *
 * @param {string} address - Bind address; for post-bind decisions pass
 *   `server.address().address` (the resolved address), not the raw input.
 * @returns {boolean}
 */
export function isWildcardAddress(address) {
  return WILDCARD_HOSTS.has(address);
}

/**
 * Map a server bind address to the host an agent child process on the same
 * machine should use to reach the server's HTTP API.
 *
 * Wildcards and IPv4 loopback dial `localhost`; IPv6 loopback dials `[::1]`
 * explicitly (a `localhost` literal may resolve IPv4-first on this machine,
 * which would fail against an `::1`-only bind); any other address is used
 * literally, bracketed when it contains `:`.
 *
 * @param {string|undefined} host - The effective bind address, or undefined.
 * @returns {string} Host part for a URL, safe to interpolate after a scheme.
 */
export function apiHostFromBind(host) {
  if (!host) return 'localhost';

  if (host === '::1') return '[::1]';

  if (isWildcardAddress(host) || host === '127.0.0.1' || host === 'localhost') {
    return 'localhost';
  }

  return host.includes(':') ? `[${host}]` : host;
}
