/**
 * errorSanitizer.js — the SINGLE OWNER of credential redaction for diagnostics.
 *
 * Provider errors flow to three outward sinks: persisted agent-call logs,
 * WebSocket broadcasts, and console output. Raw `error.message` values and
 * provider SDK metadata can echo credentials (API keys in request URLs,
 * `Authorization` headers, error payloads). Every sink must pass through
 * this module first.
 *
 * Sink-audit checklist — a new write path for provider error text must
 * register itself here and sanitize at its own persistence boundary:
 *   - agent-call logs: `AgentCallLogger.completeCall` + `_logFailoverEvent`
 *     (agentCallLogger.js) sanitize `errorMessage` / `reason` in place.
 *   - workflow failure reasons: `closeOwnWork` (workflowSessionService.js)
 *     sanitizes `reason` before `workflow_reason` + audit `details`.
 *   - console reschedule diagnostics: `checkRescheduleTrigger`
 *     (sessionErrors.js) sanitizes the logged message body.
 *   - visible session errors: `normalizeFinalErrorMessage`
 *     (visibleFinalErrorMessage.js) is the single choke point for
 *     sessions.error, broadcasts, and visible chat messages.
 *
 * Two entry points:
 *   - `sanitizeValue` / `sanitizeString` — recursive, depth- and
 *     size-bounded redaction of arbitrary values. Fails closed: circular
 *     structures, throwing getters, and over-deep values become inert
 *     placeholders instead of throwing or leaking raw data.
 *   - `normalizeProviderError` — allowlisted diagnostic structure for a
 *     thrown provider error: provider kind/id, normalized category,
 *     retryability, status/code, and a sanitized bounded message. Raw
 *     payloads (`response`, `config`, `cause`, …) are never carried over.
 */

export const SECRET_PLACEHOLDER = '[redacted]';

/**
 * Redact embedded URL credentials (userinfo) for safe logging.
 *
 * A user-configured provider `baseUrl` may embed `user:password@` credentials;
 * error text and debug logs that echo the URL must not repeat them. Only the
 * userinfo segment is replaced — host, port, and path are preserved for
 * debuggability. Non-string inputs pass through unchanged.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactUrlCredentials(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/:\/\/([^/@\s]+)@/g, '://[redacted]@');
}

const MAX_DEPTH = 10;
const MAX_OBJECT_KEYS = 100;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4000;
const MAX_MESSAGE_LENGTH = 500;

// ── Secret-pattern registry ─────────────────────────────────────────────
// ONE canonical credential-word list feeds both the key-name classifier
// below and the anchored value matcher, so the two can never drift apart:
// every word the classifier treats as secret-bearing is also an anchor the
// value matcher redacts on.
//
// Lowercase matching: a key is secret-bearing when it equals (or, for
// compound names, is bounded by non-letters around) a known credential word.
// The boundary guards keep ordinary words (`monkey`, `keyboard`, `turkey`)
// from matching the bare `key` alternative.
const SECRET_WORDS = [
  'api[_-]?key',
  'auth[_-]?token',
  'access[_-]?token',
  'refresh[_-]?token',
  'id[_-]?token',
  'client[_-]?secret',
  'secret[_-]?key',
  'access[_-]?key',
  'authorization',
  'proxy[_-]?authorization',
  'password',
  'passwd',
  'secret',
  'token',
  'key',
];
const SECRET_WORD = SECRET_WORDS.join('|');
const SECRET_KEY_PATTERN = new RegExp(`(^|[^a-z])(${SECRET_WORD})([^a-z]|$)`);

/**
 * @param {unknown} name - Object key / parameter name to classify.
 * @returns {boolean} True when the name plausibly carries a credential.
 */
export function isSecretKeyName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return SECRET_KEY_PATTERN.test(name.toLowerCase());
}

// Bare provider-token shapes (no name anchor required). Each entry keeps its
// own replacement: scheme-prefixed matches preserve the scheme word for
// debuggability, bare tokens redact fully. Length floors follow each
// provider's published key format; the `AIza`/`xai-` prefixes are
// distinctive enough that prose collisions are not a practical risk.
const SECRET_VALUE_PATTERNS = [
  { pattern: /\bBearer\s+[A-Za-z0-9\-._~+/=]+/g, replacement: `Bearer ${SECRET_PLACEHOLDER}` },
  { pattern: /\bBasic\s+[A-Za-z0-9+/=]+/g, replacement: `Basic ${SECRET_PLACEHOLDER}` },
  { pattern: /\bsk-[A-Za-z0-9\-_]{8,}\b/g, replacement: SECRET_PLACEHOLDER },
  { pattern: /\bAIza[0-9A-Za-z_-]{35,}/g, replacement: SECRET_PLACEHOLDER },
  { pattern: /\bxai-[A-Za-z0-9]{16,}/g, replacement: SECRET_PLACEHOLDER },
  { pattern: /\bgh[opurs]_[A-Za-z0-9]{32,}/g, replacement: SECRET_PLACEHOLDER },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, replacement: SECRET_PLACEHOLDER },
  { pattern: /\bAKIA[0-9A-Z]{16,}/g, replacement: SECRET_PLACEHOLDER },
];

// Secret-anchored assignments: `name = value`, `name: value`, JSON
// `"name": "value"`, and percent-encoded forms (`name%3Dvalue`). The match
// can only START at a known credential word, so an outer non-secret binding
// (`request failed: x-goog-api-key: …`) can never swallow the real
// credential — the leftmost match begins at the secret word itself. The full
// name (prefix + word) is still verified with isSecretKeyName so `monkey=abc`
// is left alone.
const SECRET_ANCHORED_SOURCE =
  `(?<q1>"|')?(?<sprefix>[A-Za-z0-9_.$@|x-]*?)(?<sname>${SECRET_WORD})(?<q2>"|')?\\s*(?<ssep>=|:|%3D|%3A)\\s*(?<sscheme>Bearer\\s+|Basic\\s+)?(?<sraw>"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;&}"']+)`;
// Query-string parameters: split on the separator so the parameter NAME can
// be classified exactly (catches bare `?key=` / `&token=` without matching
// `monkey=`).
const QUERY_PARAM_PATTERN = /([?&])([^=&#\s]+)=([^&#\s]*)/g;
const MAX_ANCHORED_RECURSION = 2;

function quoteBody(rawValue) {
  const quote = rawValue[0];
  if (quote === '"' || quote === "'") return `${quote}${SECRET_PLACEHOLDER}${quote}`;
  return SECRET_PLACEHOLDER;
}

function rescueInnerCredential(g, depth) {
  if (depth >= MAX_ANCHORED_RECURSION || !g.sraw) return null;
  const inner = redactAnchoredFragment(g.sraw, depth + 1);
  if (inner === g.sraw) return null;
  const fullName = `${g.sprefix || ''}${g.sname || ''}`;
  return `${g.q1 || ''}${fullName}${g.q2 || ''}${g.ssep}${inner}`;
}

function redactAnchoredMatch(match, g, depth) {
  const fullName = `${g.sprefix || ''}${g.sname || ''}`;
  if (!g.sscheme && !isSecretKeyName(fullName.trim())) {
    // A non-secret outer binding (e.g. `note: api_key=x`) matched only
    // because its VALUE contains a secret assignment — recurse into the
    // value half so the inner credential is still redacted.
    return rescueInnerCredential(g, depth) ?? match;
  }
  return `${g.q1 || ''}${fullName}${g.q2 || ''}${g.ssep}${g.sscheme || ''}${quoteBody(g.sraw)}`;
}

function redactAnchoredFragment(text, depth) {
  // Fresh regex per call: redactAnchoredFragment recurses, and a shared
  // global regex would corrupt the outer replace's lastIndex.
  const pattern = new RegExp(SECRET_ANCHORED_SOURCE, 'gi');
  return text.replace(pattern, (match, ...args) => redactAnchoredMatch(match, args[args.length - 1], depth));
}

function redactQueryParam(match, sep, name, value) {
  if (!isSecretKeyName(name) || !value) return match;
  return `${sep}${name}=${SECRET_PLACEHOLDER}`;
}

/**
 * Redact credentials from free text: query strings, headers, plain text,
 * quoted JSON, nested-string payloads, and URL-encoded values.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  // Finding 6: redact URL userinfo FIRST, on the untruncated input. The
  // `@` marker may sit beyond MAX_STRING_LENGTH — truncating first would
  // keep a `user:pass-fragment` prefix behind with no marker left to match.
  // redactUrlCredentials is idempotent, so sinks that already call it (and
  // repeated sanitizeString passes) stay stable.
  let out = redactUrlCredentials(input);
  if (out.length > MAX_STRING_LENGTH) out = out.slice(0, MAX_STRING_LENGTH);
  out = out.replace(QUERY_PARAM_PATTERN, redactQueryParam);
  out = redactAnchoredFragment(out, 0);
  for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const CIRCULAR_PLACEHOLDER = '[circular]';
const TRUNCATED_PLACEHOLDER = '[truncated]';
const UNSERIALIZABLE_PLACEHOLDER = '[unserializable]';
const UNREADABLE_PLACEHOLDER = '[unreadable]';

function sanitizeArray(value, seen, depth) {
  const items = value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((entry) => sanitizeChild(entry, seen, depth + 1));
  if (value.length > MAX_ARRAY_ITEMS) items.push(TRUNCATED_PLACEHOLDER);
  return items;
}

function readOwnChild(container, key) {
  try {
    return { ok: true, value: container[key] };
  } catch {
    return { ok: false, value: undefined };
  }
}

function sanitizeObject(value, seen, depth) {
  const out = {};
  const allKeys = Object.keys(value);
  for (const key of allKeys.slice(0, MAX_OBJECT_KEYS)) {
    if (isSecretKeyName(key)) {
      out[key] = SECRET_PLACEHOLDER;
      continue;
    }
    const child = readOwnChild(value, key);
    out[key] = child.ok ? sanitizeChild(child.value, seen, depth + 1) : UNREADABLE_PLACEHOLDER;
  }
  if (allKeys.length > MAX_OBJECT_KEYS) out.__truncated = TRUNCATED_PLACEHOLDER;
  return out;
}

function sanitizePrimitive(value) {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) ? value : UNSERIALIZABLE_PLACEHOLDER;
  }
  if (typeof value === 'bigint') return value.toString();
  return UNSERIALIZABLE_PLACEHOLDER;
}

function sanitizeChild(value, seen, depth) {
  if (depth > MAX_DEPTH) return TRUNCATED_PLACEHOLDER;
  if (typeof value !== 'object' || value === null) return sanitizePrimitive(value);
  if (value instanceof Error) {
    return { name: value.name || 'Error', message: sanitizeString(value.message || '') };
  }
  if (seen.has(value)) return CIRCULAR_PLACEHOLDER;
  seen.add(value);
  try {
    if (Array.isArray(value)) return sanitizeArray(value, seen, depth);
    return sanitizeObject(value, seen, depth);
  } finally {
    seen.delete(value);
  }
}

/**
 * Recursively redact an arbitrary value. Never throws: circular, throwing,
 * over-deep, and oversized inputs degrade to inert placeholders.
 *
 * @param {unknown} value
 * @returns {unknown} JSON-safe redacted value.
 */
export function sanitizeValue(value) {
  try {
    return sanitizeChild(value, new Set(), 0);
  } catch {
    return UNSERIALIZABLE_PLACEHOLDER;
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 502, 503, 504, 529]);
const QUOTA_PATTERN = /quota|usage limit|out of tokens|insufficient credit|billing/i;
const TRANSIENT_PATTERN = /overloaded|unavailable|too many requests|rate limit|temporarily|timeout|timed out|econnreset|socket hang up|service unavailable|server error/i;
const FALLBACK_MESSAGE = 'provider request failed';

function readErrorMessage(error) {
  if (error instanceof Error) return error.message || FALLBACK_MESSAGE;
  if (typeof error === 'string') return error;
  return FALLBACK_MESSAGE;
}

function isErrorLike(error) {
  return error instanceof Error || (typeof error === 'object' && error !== null);
}

function readStatus(error) {
  const candidates = [error?.status, error?.statusCode];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function readCode(error) {
  const code = error?.code;
  if (typeof code === 'number' && Number.isFinite(code)) return code;
  if (typeof code === 'string' && code.length > 0) return sanitizeString(code).slice(0, 80);
  return null;
}

function classifyCategory(message, status) {
  const lowered = String(message).toLowerCase();
  if (QUOTA_PATTERN.test(lowered)) return 'quota';
  if (TRANSIENT_PATTERN.test(lowered)) return 'transient';
  if (status !== null && TRANSIENT_STATUS_CODES.has(status)) return 'transient';
  return 'unknown';
}

/**
 * Normalize a thrown provider error to the allowlisted diagnostic structure.
 * Only these fields survive: provider kind/id, normalized category,
 * retryability, status/code, and a sanitized bounded message. Provider
 * payloads (`response`, `config`, `cause`, headers, bodies) are dropped —
 * they are the usual credential echo path.
 *
 * @param {unknown} error
 * @param {{ providerKind?: string|null, providerId?: string|null }} [ids]
 * @returns {{ providerKind: string|null, providerId: string|null, category: 'quota'|'transient'|'unknown', retryable: boolean, status: number|null, code: string|number|null, message: string }}
 */
export function normalizeProviderError(error, { providerKind = null, providerId = null } = {}) {
  const message = readErrorMessage(error);
  const errorLike = isErrorLike(error);
  const status = errorLike ? readStatus(error) : null;
  const code = errorLike ? readCode(error) : null;
  const category = classifyCategory(message, status);
  const sanitized = sanitizeString(String(message)).slice(0, MAX_MESSAGE_LENGTH);
  return {
    providerKind: providerKind ?? null,
    providerId: providerId ?? null,
    category,
    retryable: category !== 'unknown',
    status,
    code,
    message: sanitized || FALLBACK_MESSAGE,
  };
}
