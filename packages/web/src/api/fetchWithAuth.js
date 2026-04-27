/**
 * Auth-aware fetch wrapper.
 *
 * Patches globalThis.fetch to automatically inject the Authorization header
 * from the auth store and intercept 401 responses before ApiClient throws.
 *
 * This ensures all fetch calls (including those inside ApiClient.#request()
 * and _uploadFormData()) automatically get auth headers.
 */

/** @type {{ authHeader: import('vue').ComputedRef<string|undefined>, markRequired: () => void }|null} */
let store = null;

/** @type {import('vue-router').Router|null} */
let router = null;

/** @type {typeof globalThis.fetch} */
const originalFetch = globalThis.fetch;

/**
 * Get the current Authorization header value
 * @returns {string|undefined}
 */
export function getAuthHeaderValue() {
  return store?.authHeader?.value ?? undefined;
}

/**
 * Get the current auth token (base64 encoded user:password)
 * @returns {string|undefined}
 */
export function getAuthToken() {
  return store?.authToken?.value ?? undefined;
}

/**
 * Patched fetch that injects the Authorization header and intercepts 401s.
 * @param  {...any} args - Arguments passed to fetch
 * @returns {Promise<Response>}
 */
function patchedFetch(...args) {
  const [input, init = {}] = args;

  // Inject Authorization header if available
  const authHeader = getAuthHeaderValue();
  if (authHeader) {
    init.headers = {
      ...(init.headers || {}),
      Authorization: authHeader,
    };
  }

  return originalFetch(input, init).then((response) => {
    // Intercept 401 before ApiClient throws
    if (response.status === 401) {
      if (store) {
        store.markRequired();
      }
      if (router) {
        router.push('/login');
      }
    }
    return response;
  });
}

/**
 * Initialize the auth-aware fetch wrapper.
 * Patches globalThis.fetch to inject Authorization headers and handle 401s.
 *
 * @param {{ authHeader: import('vue').ComputedRef<string|undefined>, authToken: import('vue').ComputedRef<string|undefined>, markRequired: () => void }} authStore
 * @param {import('vue-router').Router} vueRouter
 */
export function initFetchAuth(authStore, vueRouter) {
  store = authStore;
  router = vueRouter;
  globalThis.fetch = patchedFetch;
}
