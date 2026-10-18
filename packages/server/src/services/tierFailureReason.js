import { sanitizeString } from './errorSanitizer.js';

/**
 * Remove provider payloads/secrets and keep terminal errors bounded for
 * UI/logs. Implemented on the shared {@link sanitizeString} entry point so
 * every outward reason uses the same redaction rules.
 */
export function sanitizeTierFailureReason(error) {
  const raw = sanitizeString(error?.message || 'provider start failed')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (raw || 'provider start failed').slice(0, 240);
}
