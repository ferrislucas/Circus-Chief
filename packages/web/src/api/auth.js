import { ref } from 'vue';

/** Error code thrown for HTTP 401s — distinct from the generic error path. */
export const AUTH_REQUIRED_CODE = 'AUTH_REQUIRED';

/** True once the server has challenged us with a 401 (→ show the login view). */
export const authRequired = ref(false);

// In-memory only. Credentials are deliberately never written to
// localStorage/sessionStorage/cookies: a stored password would outlive the
// tab and leak across profiles. A reload simply re-prompts.
let credentials = null;

const authRequiredListeners = new Set();
const authedListeners = new Set();

/**
 * Build a Basic Authorization header value.
 * Single header-construction helper for the whole frontend. UTF-8-safe:
 * raw `btoa` throws on non-Latin1 input, so the pair is encoded to UTF-8
 * bytes first (consistent with the percent-encoded WebSocket URL path).
 */
export function buildAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** Current Authorization header value, or null when logged out. */
export function getAuthorizationHeader() {
  if (!credentials) return null;
  return buildAuthHeader(credentials.username, credentials.password);
}

/** Raw pair for WebSocket URL embedding (`new WebSocket()` takes no headers). */
export function getBasicCredentials() {
  return credentials ? { ...credentials } : null;
}

export function hasCredentials() {
  return credentials !== null;
}

export function setCredentials(username, password) {
  credentials = { username, password };
}

export function clearCredentials() {
  credentials = null;
}

export function isAuthRequired() {
  return authRequired.value;
}

export function notifyAuthRequired() {
  authRequired.value = true;
  for (const cb of authRequiredListeners) cb();
}

/**
 * Shared auth-aware fetch for request paths outside ApiClient (streaming
 * hydration, parallel wrappers, startup probes). Injects the stored Basic
 * header when logged in and funnels 401s into the login gate. Returns the
 * raw response so callers keep their own body/error handling. Callers pass
 * plain-object headers (merging a `Headers` instance is not supported).
 */
export function authorizedFetch(url, init = {}) {
  const header = getAuthorizationHeader();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(header ? { Authorization: header } : {}),
    },
  }).then((response) => {
    if (response.status === 401) notifyAuthRequired();
    return response;
  });
}

export function onAuthRequired(callback) {
  authRequiredListeners.add(callback);
  return () => authRequiredListeners.delete(callback);
}

export function onAuthed(callback) {
  authedListeners.add(callback);
  return () => authedListeners.delete(callback);
}

function markAuthed() {
  authRequired.value = false;
  for (const cb of authedListeners) cb();
}

/**
 * Best-effort priming of the browser's per-origin Basic credential cache:
 * an Authorization-carrying same-origin fetch lets some browsers attach
 * credentials to the `/ws` upgrade automatically. Failures are ignored —
 * the WebSocket URL embedding (see useWebSocket) is the reliable path.
 */
export async function primeBrowserAuthCache(baseUrl = '/api') {
  const header = getAuthorizationHeader();
  if (!header) return;
  try {
    await fetch(`${baseUrl}/projects`, { headers: { Authorization: header } });
  } catch {
    // Best-effort only.
  }
}

/**
 * Log in with a verification round-trip: credentials are stored, then
 * `verifyRequest` (e.g. `() => api.getProjects()`) retries the challenged
 * request once *with* the stored header. Success resolves auth; a 401
 * clears the credentials and rethrows.
 * @param {string} username
 * @param {string} password
 * @param {Function} verifyRequest - Zero-arg async request using the API layer.
 */
export async function login(username, password, verifyRequest) {
  setCredentials(username, password);
  try {
    const result = await verifyRequest();
    markAuthed();
    void primeBrowserAuthCache();
    return result;
  } catch (err) {
    clearCredentials();
    notifyAuthRequired();
    throw err;
  }
}

export function logout() {
  clearCredentials();
  authRequired.value = false;
}
