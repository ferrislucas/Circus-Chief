import { DEFAULT_SERVER_PORT } from '@circuschief/shared';

/**
 * Get the base API URL for canvas and session operations.
 * Uses CIRCUSCHIEF_API_URL environment variable if set, otherwise constructs
 * from the runtime port to ensure dynamic port handling.
 * @returns {string} The base API URL (e.g., http://localhost:5000)
 */
export function getApiBaseUrl() {
  return process.env.CIRCUSCHIEF_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
}
