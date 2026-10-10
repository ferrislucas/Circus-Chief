/**
 * Client for the z.ai GLM Coding Plan quota endpoint, matching the provider's
 * official `glm-plan-usage` plugin: `GET {origin}/api/monitor/usage/quota/limit`
 * with the provider's coding-plan key in `Authorization` (raw, as the official
 * plugin sends it; Bearer is also accepted).
 *
 * The Authorization value is never logged; responses are returned to the
 * caller for reduction by the allowance mapper (FR-8).
 */

export const ZAI_QUOTA_HOSTS = new Set(['api.z.ai', 'open.bigmodel.cn']);
export const ZAI_QUOTA_PATH = '/api/monitor/usage/quota/limit';
export const DEFAULT_ZAI_TIMEOUT_MS = 10_000;

export function isZaiQuotaHost(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' && ZAI_QUOTA_HOSTS.has(url.hostname)
      && (url.port === '' || url.port === '443') && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export function buildZaiQuotaUrl(baseUrl) {
  if (!isZaiQuotaHost(baseUrl)) return null;
  return new URL(ZAI_QUOTA_PATH, new URL(baseUrl).origin).toString();
}

/**
 * Fetch the quota payload. Returns a discriminated outcome so the poller can
 * apply its per-status policies; raw error bodies are discarded.
 * @returns {Promise<{ outcome: 'ok', payload: Object } | { outcome: 'http', status: number, retryAfterMs: number | null } | { outcome: 'network' }>}
 */
export async function fetchZaiQuotaLimit({ baseUrl, authToken, timeoutMs = DEFAULT_ZAI_TIMEOUT_MS, fetchImpl = fetch }) {
  const url = buildZaiQuotaUrl(baseUrl);
  if (!url) return { outcome: 'network' };
  const controller = new AbortController();
  try {
    // Header arrival is not request completion: retain the deadline while
    // consuming JSON so a stalled response body cannot wedge a poll worker.
    return await withTimeout((async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: authToken },
        signal: controller.signal,
      });
      if (!response.ok) {
        return { outcome: 'http', status: response.status, retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after')) };
      }
      const payload = await response.json();
      // z.ai reports auth failures as HTTP 200 with an error envelope
      // (`{"code":401,"msg":"...","success":false}`) instead of an HTTP
      // error status. Classify it as the HTTP failure it is so the poller
      // applies its per-status policies (stop on 401/403 until rotation)
      // instead of polling a dead key every interval as `no-data`.
      const envelopeStatus = envelopeErrorStatus(payload);
      if (envelopeStatus !== null) return { outcome: 'http', status: envelopeStatus, retryAfterMs: null };
      return { outcome: 'ok', payload };
    })(), timeoutMs, controller);
  } catch {
    return { outcome: 'network' };
  }
}

function withTimeout(promise, timeoutMs, controller) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('z.ai quota request timed out'));
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

// An error envelope is `{success: false}` or a numeric `code >= 400`.
// Success payloads carry the quota under `data` with `success !== false`.
function envelopeErrorStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.success === false) {
    return typeof payload.code === 'number' && Number.isFinite(payload.code) && payload.code >= 400
      ? Math.floor(payload.code)
      : 401;
  }
  const code = payload.code;
  return typeof code === 'number' && Number.isFinite(code) && code >= 400 ? Math.floor(code) : null;
}

// `retry-after` arrives either as delay seconds or as an HTTP date.
// A date in the past (or an unparseable value) yields no backoff rather
// than a negative one.
function parseRetryAfter(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const seconds = Number(headerValue.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const atMs = Date.parse(headerValue.trim());
  return Number.isFinite(atMs) && atMs > Date.now() ? atMs - Date.now() : null;
}
