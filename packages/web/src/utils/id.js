/**
 * Generate a unique client-side identifier for non-security purposes, such as
 * UI keys. `crypto.randomUUID()` is only available in secure contexts, while
 * the app is also commonly served over HTTP on a local network.
 *
 * @param {string} prefix - Prefix for fallback identifiers
 * @returns {string} A client-side identifier
 */
export function localId(prefix = 'local') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
