import { sanitizeString } from './errorSanitizer.js';

/**
 * Remove provider payloads/secrets and keep terminal errors bounded for
 * UI/logs. Implemented on the shared {@link sanitizeString} entry point so
 * every outward reason uses the same redaction rules.
 */
export function sanitizeTierFailureReason(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const reason = typeof error?.reason === 'string' ? error.reason.trim() : '';
  // Prefer the failover sentence. Summary runners keep a generic public
  // message and put the provider quota text on `reason`; the gate and this
  // log both need that sentence, and it has to survive the 240-character cap.
  const combined = reason && reason !== message ? `${reason} ${message}`.trim() : (message || reason);
  const raw = sanitizeString(combined || 'provider start failed')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (raw || 'provider start failed').slice(0, 240);
}
