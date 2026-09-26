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
  let response;
  try {
    response = await withTimeout(fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: authToken },
      signal: controller.signal,
    }), timeoutMs, controller);
  } catch {
    return { outcome: 'network' };
  }

  if (!response.ok) {
    return { outcome: 'http', status: response.status, retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after')) };
  }

  try {
    return { outcome: 'ok', payload: await response.json() };
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

function parseRetryAfter(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const seconds = Number(headerValue.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}
