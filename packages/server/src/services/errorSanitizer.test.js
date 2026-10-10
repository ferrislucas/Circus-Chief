import { describe, expect, it } from 'vitest';
import {
  SECRET_PLACEHOLDER,
  isSecretKeyName,
  normalizeProviderError,
  redactUrlCredentials,
  sanitizeString,
  sanitizeValue,
} from './errorSanitizer.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { sanitizeTierFailureReason } from './tierFailureReason.js';

// Sentinel stands in for a real credential. No test may let it reach a
// persistence or websocket boundary unsanitized.
const SENTINEL = 'sentinel-9f8e7d6c5b4a-credential';

describe('isSecretKeyName', () => {
  it.each([
    'apiKey',
    'api_key',
    'API-KEY',
    'x-goog-api-key',
    'X-Api-Key',
    'authorization',
    'token',
    'authToken',
    'access_token',
    'refreshToken',
    'client_secret',
    'secretKey',
    'password',
    'key',
  ])('treats %s as secret-bearing', (name) => {
    expect(isSecretKeyName(name)).toBe(true);
  });

  it.each(['model', 'providerId', 'monkey', 'keyboard', 'tokens_used', 'turkey'])(
    'does not treat %s as secret-bearing',
    (name) => {
      expect(isSecretKeyName(name)).toBe(false);
    }
  );
});

describe('sanitizeString', () => {
  it('redacts a bare key query parameter (Google-style ?key=)', () => {
    const out = sanitizeString(
      `https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=${SENTINEL}`
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain(SECRET_PLACEHOLDER);
    // The endpoint itself stays debuggable — only the credential is redacted.
    expect(out).toContain('generateContent');
  });

  it('redacts named credentials in Authorization-style headers text', () => {
    const out = sanitizeString(`request failed: x-goog-api-key: ${SENTINEL}, retry later`);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain(SECRET_PLACEHOLDER);
  });

  it('redacts plain-text api_key assignments', () => {
    expect(sanitizeString(`api_key=${SENTINEL}`)).not.toContain(SENTINEL);
  });

  it('redacts Bearer tokens', () => {
    const out = sanitizeString(`authorization=Bearer ${SENTINEL}`);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain(SECRET_PLACEHOLDER);
  });

  it('redacts quoted JSON credential values', () => {
    const out = sanitizeString(`{"apiKey": "${SENTINEL}", "model": "m"}`);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('"model": "m"');
  });

  it('redacts URL-encoded credential values', () => {
    const encoded = encodeURIComponent(SENTINEL);
    const out = sanitizeString(`callback failed: api_key%3D${encoded}&next=1`);
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain(encoded);
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeString('Error: 529 Service overloaded')).toBe('Error: 529 Service overloaded');
  });

  it.each([
    ['Google', 'call failed for key AIzaSyA-1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7'],
    ['xAI', 'auth error for token xai-9f8e7d6c5b4a3928173645a1b2c3d4e5f'],
    ['GitHub', 'bad credentials for token ghp_9f8e7d6c5b4a3928173645a1b2c3d4e5f'],
    ['AWS', 'auth failure for key AKIA9F8E7D6C5B4A39281'],
  ])('redacts a bare %s token shape with no name anchor', (_label, token) => {
    const out = sanitizeString(`provider request failed: ${token}; retry later`);
    expect(out).not.toContain(token);
    expect(out).toContain(SECRET_PLACEHOLDER);
  });
});

describe('sanitizeValue', () => {
  it('redacts secrets in nested objects and arrays by key name', () => {
    const out = sanitizeValue({
      nested: { headers: { 'x-goog-api-key': SENTINEL } },
      list: [{ api_key: SENTINEL }, 'plain'],
      model: 'm',
    });
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
    expect(out.model).toBe('m');
    expect(out.list[1]).toBe('plain');
  });

  it('redacts token-shaped strings nested anywhere inside evidence payloads', () => {
    const googleToken = 'AIzaSyA-1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7';
    const xaiToken = 'xai-9f8e7d6c5b4a3928173645a1b2c3d4e5f';
    const out = sanitizeValue({
      evidence: {
        reason: `provider start failed: ${googleToken}`,
        nested: [`inner failure ${xaiToken}`, { deep: { key: `k=${xaiToken}` } }],
      },
      model: 'm',
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(googleToken);
    expect(serialized).not.toContain(xaiToken);
    expect(out.model).toBe('m');
  });

  it('fails closed on circular structures instead of throwing', () => {
    const circular = { apiKey: SENTINEL };
    circular.self = circular;
    let out;
    expect(() => {
      out = sanitizeValue(circular);
    }).not.toThrow();
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
  });

  it('fails closed on throwing getters and unreadable values', () => {
    const evil = {};
    Object.defineProperty(evil, 'boom', {
      get() {
        throw new Error('nope');
      },
    });
    let out;
    expect(() => {
      out = sanitizeValue({ evil, fn: () => {}, sym: Symbol('s') });
    }).not.toThrow();
    expect(JSON.stringify(out)).not.toContain('nope');
  });

  it('bounds deep structures instead of recursing forever', () => {
    let deep = { level: 0 };
    for (let i = 0; i < 50; i += 1) deep = { child: deep };
    let out;
    expect(() => {
      out = sanitizeValue(deep);
    }).not.toThrow();
    expect(JSON.stringify(out)).toContain('truncated');
  });
});

describe('normalizeProviderError', () => {
  it('returns only the allowlisted diagnostic shape', () => {
    const error = Object.assign(new Error(`google call failed: key=${SENTINEL}`), {
      status: 503,
      code: 'OVERLOADED',
      response: { data: { apiKey: SENTINEL } },
      config: { headers: { 'x-goog-api-key': SENTINEL }, url: `https://x?key=${SENTINEL}` },
    });
    const normalized = normalizeProviderError(error, { providerKind: 'google', providerId: 'g1' });
    expect(Object.keys(normalized).sort()).toEqual(
      ['category', 'code', 'message', 'providerId', 'providerKind', 'retryable', 'status'].sort()
    );
    expect(JSON.stringify(normalized)).not.toContain(SENTINEL);
    expect(normalized).toMatchObject({ providerKind: 'google', providerId: 'g1', status: 503 });
  });

  it('never throws on malformed or circular error metadata', () => {
    const error = new Error('weird');
    error.cause = error;
    error.response = { data: {} };
    error.response.data.self = error.response;
    let normalized;
    expect(() => {
      normalized = normalizeProviderError(error, {});
    }).not.toThrow();
    expect(typeof normalized.message).toBe('string');
  });

  it('bounds long messages', () => {
    const normalized = normalizeProviderError(
      new Error(`${'x'.repeat(100)} key=${SENTINEL} ${'y'.repeat(5000)}`),
      {}
    );
    expect(normalized.message.length).toBeLessThanOrEqual(500);
    expect(normalized.message).not.toContain(SENTINEL);
  });
});

describe('redactUrlCredentials', () => {
  it('redacts userinfo credentials but keeps host and path', () => {
    const out = redactUrlCredentials(`https://user:${SENTINEL}@proxy.example:8080/v1`);
    expect(out).toBe('https://[redacted]@proxy.example:8080/v1');
    expect(out).not.toContain(SENTINEL);
  });

  it('leaves credential-free URLs and non-strings alone', () => {
    expect(redactUrlCredentials('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(redactUrlCredentials(undefined)).toBe(undefined);
    expect(redactUrlCredentials(null)).toBe(null);
  });
});

// ── Finding 6: URL userinfo through the shared sanitizer ───────────────────
// Every outward sink (persisted session errors, websocket payloads, failover
// history, logs) funnels through sanitizeString — so userinfo redaction must
// live there, not only in the standalone redactUrlCredentials helper used by
// console baseUrl logging. Truncation must never run before redaction:
// otherwise a credential sitting past the cut keeps its leading fragment.
describe('sanitizeString URL userinfo (finding 6)', () => {
  const USER = `user-${SENTINEL}`;
  const PASS = `pass-${SENTINEL}`;

  it('redacts username:password userinfo but keeps host and path', () => {
    const out = sanitizeString(`fetch failed for https://${USER}:${PASS}@proxy.example:8080/v1: refused`);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('https://[redacted]@proxy.example:8080/v1');
  });

  it('redacts username-only userinfo', () => {
    const out = sanitizeString(`dial https://${USER}@proxy.example/v1 failed`);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('https://[redacted]@proxy.example/v1');
  });

  it('redacts percent-encoded userinfo credentials', () => {
    const out = sanitizeString(`dial https://${USER}%3A${PASS}@proxy.example/v1 failed`);
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain(encodeURIComponent(PASS));
    expect(out).toContain('https://[redacted]@proxy.example/v1');
  });

  it('redacts userinfo in every URL when several appear', () => {
    const out = sanitizeString(
      `primary https://${USER}:${PASS}@a.example/v1 failed over to https://other:${SENTINEL}@b.example/v1`
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('https://[redacted]@a.example/v1');
    expect(out).toContain('https://[redacted]@b.example/v1');
  });

  it('redacts userinfo inside nested values and Error objects', () => {
    const url = `https://${USER}:${PASS}@proxy.example:8080/v1`;
    const out = sanitizeValue({
      endpoint: url,
      list: [`retrying ${url}`],
      err: new Error(`boom for ${url}`),
    });
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
  });

  it('redacts a credential whose password spans the truncation boundary', () => {
    // Module truncation cuts at 4000 chars; the password crosses the cut and
    // the `@` marker sits beyond it — truncating first would keep a
    // `user:pass-fragment` prefix behind.
    const longPass = (`pass-${SENTINEL}.`).repeat(30);
    const input = `${'z'.repeat(3950)}https://a:${longPass}@proxy.example/v1`;
    expect(input.indexOf('@')).toBeGreaterThan(4000);
    const out = sanitizeString(input);
    expect(out).not.toContain(SENTINEL);
    expect(out.length).toBeLessThanOrEqual(4000);
  });

  it('redacts long userinfo whose @ falls beyond the truncation boundary', () => {
    const longUser = (`${USER}.`).repeat(110);
    const input = `https://${longUser}:end@proxy.example/v1`;
    expect(input.indexOf('@')).toBeGreaterThan(4000);
    const out = sanitizeString(input);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('https://[redacted]@proxy.example/v1');
    expect(out.length).toBeLessThanOrEqual(4000);
  });

  it('is idempotent for URL-bearing input', () => {
    const input = `fetch failed for https://${USER}:${PASS}@proxy.example:8080/v1: refused`;
    expect(sanitizeString(sanitizeString(input))).toBe(sanitizeString(input));
  });

  it('keeps sink error text free of URL userinfo (final error + failover reason)', () => {
    // Websocket broadcasts and persisted session errors carry these reason
    // strings verbatim — checking the reason strings checks the payloads.
    const message = `provider start failed for https://${USER}:${PASS}@proxy.example:8080/v1: refused`;
    expect(normalizeFinalErrorMessage(new Error(message))).not.toContain(SENTINEL);
    expect(sanitizeTierFailureReason(new Error(message))).not.toContain(SENTINEL);
  });
});
