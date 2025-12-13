import { ref } from 'vue';

// Re-export from api module for backward compatibility
export { ApiClient, api } from '../api/index.js';

const BASE_URL = '/api';

/**
 * HTTP client wrapper - Vue composable
 */
export function useApi() {
  const loading = ref(false);
  const error = ref(null);

  async function request(method, path, data = null) {
    loading.value = true;
    error.value = null;

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(`${BASE_URL}${path}`, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    error,
    get: (path) => request('GET', path),
    post: (path, data) => request('POST', path, data),
    put: (path, data) => request('PUT', path, data),
    delete: (path) => request('DELETE', path),
  };
}
