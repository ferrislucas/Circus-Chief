import { DEFAULT_SERVER_PORT } from '@circuschief/shared';
import { apiHostFromBind } from '../bindAddress.js';

/**
 * Get the base API URL for canvas and session operations.
 *
 * Uses CIRCUSCHIEF_API_URL if set (explicit override), otherwise constructs
 * from the effective bind address and port. The bind address is set by the
 * server entry point into CIRCUSCHIEF_HOST after CLI/env resolution, so
 * agent prompt URLs follow the actual bind: dialing `localhost` against a
 * server bound to a specific interface IP would be refused.
 *
 * @returns {string} The base API URL (e.g. http://localhost:5000)
 */
export function getApiBaseUrl() {
  if (process.env.CIRCUSCHIEF_API_URL) return process.env.CIRCUSCHIEF_API_URL;

  const host = apiHostFromBind(process.env.CIRCUSCHIEF_HOST);
  return `http://${host}:${process.env.PORT || DEFAULT_SERVER_PORT}`;
}
