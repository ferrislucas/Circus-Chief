import { describe, expect, it } from 'vitest';
import {
  SECRET_PLACEHOLDER,
  isSecretKeyName,
  normalizeProviderError,
  sanitizeString,
  sanitizeValue,
} from './errorSanitizer.js';

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
