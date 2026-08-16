import {
  SESSION_CALLER_IDENTITY_HINT_HEADER,
} from '@circuschief/shared';
import { createSessionCallerCapability } from './sessionCallerCapability.js';

export const REDACTED_SESSION_CALLER_IDENTITY_HINT = '[REDACTED_SESSION_IDENTITY_HINT]';

const headerPattern = new RegExp(`(${SESSION_CALLER_IDENTITY_HINT_HEADER}:\\s*)[^\\s\\"']+`, 'gi');

/**
 * Remove a session caller identity hint before durable or externally visible
 * output is written. Header-form redaction protects VCR fixtures even when a
 * session id is unavailable; the exact-value pass catches an echoed bare hint.
 */
export function redactSessionCallerIdentityHint(value, sessionId = null) {
  if (typeof value !== 'string') return value;
  let redacted = value.replace(headerPattern, `$1${REDACTED_SESSION_CALLER_IDENTITY_HINT}`);
  if (sessionId) {
    const hint = createSessionCallerCapability(sessionId);
    redacted = redacted.split(hint).join(REDACTED_SESSION_CALLER_IDENTITY_HINT);
  }
  return redacted;
}

/** Recursively redact serializable content without mutating its caller. */
export function redactSessionCallerIdentityHintValue(value, sessionId = null) {
  if (typeof value === 'string') return redactSessionCallerIdentityHint(value, sessionId);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSessionCallerIdentityHintValue(item, sessionId));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    redactSessionCallerIdentityHintValue(item, sessionId),
  ]));
}
