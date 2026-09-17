/**
 * Extract the documented OpenAI HTTP rate-limit headers from a direct SDK
 * response. This boundary deliberately emits only normalized measurements;
 * request IDs, authorization, and every other raw response header stay here.
 */
export function extractOpenAIAllowance(headers, { observedAt = Date.now() } = {}) {
  const values = readHeaderValues(headers);
  const allowances = [
    extractAllowance(values, { suffix: 'requests', label: 'Requests', unit: 'requests', observedAt }),
    extractAllowance(values, { suffix: 'tokens', label: 'Tokens', unit: 'tokens', observedAt }),
  ].filter(Boolean);

  if (allowances.length === 0) return null;
  const resets = allowances.map(({ resetsAt }) => resetsAt).filter((value) => value !== null);
  // A header observation stops being current at the first advertised reset.
  // The shared allowance service converts this neutral freshness duration to
  // its canonical staleAt timestamp.
  const staleAfterMs = resets.length > 0 ? Math.min(...resets) - observedAt : null;

  return {
    providerKind: 'openai',
    source: 'observed-header',
    updatedAt: observedAt,
    staleAfterMs,
    allowances,
  };
}

function extractAllowance(headers, { suffix, label, unit, observedAt }) {
  const limit = parsePositiveInteger(headers.get(`x-ratelimit-limit-${suffix}`));
  const remaining = parseNonNegativeInteger(headers.get(`x-ratelimit-remaining-${suffix}`));
  if (limit === null || remaining === null) return null;

  const resetMs = parseResetDuration(headers.get(`x-ratelimit-reset-${suffix}`));
  if (resetMs === null) return null;
  return {
    key: suffix,
    label,
    remaining,
    limit,
    unit,
    resetsAt: observedAt + resetMs,
  };
}

function readHeaderValues(headers) {
  if (headers && typeof headers.get === 'function') {
    return { get: (name) => headers.get(name) };
  }
  const normalized = new Map(
    Object.entries(headers && typeof headers === 'object' ? headers : {})
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name) => normalized.get(name.toLowerCase()) };
}

function parsePositiveInteger(value) {
  const parsed = parseStrictInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value) {
  const parsed = parseStrictInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function parseStrictInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// OpenAI documents reset headers as compact duration strings such as `12s`,
// `2m0s`, or `1h15m0s`. Rejecting other values keeps time conversion honest.
export function parseResetDuration(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const matches = [...value.matchAll(/(\d+)(ms|h|m|s)/g)];
  if (matches.length === 0 || matches.map((match) => match[0]).join('') !== value) return null;

  const multipliers = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  const duration = matches.reduce((total, [, amount, unit]) => total + Number(amount) * multipliers[unit], 0);
  return Number.isSafeInteger(duration) && duration >= 0 ? duration : null;
}
