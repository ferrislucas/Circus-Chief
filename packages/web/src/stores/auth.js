import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  /** @type {import('vue').Ref<{ username: string, password: string }|null>} */
  const credentials = ref(null);

  /** @type {import('vue').Ref<boolean>} */
  const required = ref(false);

  /** @type {import('vue').ComputedRef<boolean>} */
  const isAuthenticated = computed(() => credentials.value !== null);

  /** @type {import('vue').ComputedRef<string|undefined>} */
  const authHeader = computed(() => {
    if (!credentials.value) return undefined;
    const token = btoa(`${credentials.value.username}:${credentials.value.password}`);
    return `Basic ${token}`;
  });

  /** @type {import('vue').ComputedRef<string|undefined>} */
  const authToken = computed(() => {
    if (!credentials.value) return undefined;
    return btoa(`${credentials.value.username}:${credentials.value.password}`);
  });

  /**
   * Mark that auth is required (called when a 401 is received)
   */
  function markRequired() {
    required.value = true;
  }

  /**
   * Attempt to log in by validating credentials against a protected endpoint.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<void>}
   */
  async function login(username, password) {
    const token = btoa(`${username}:${password}`);
    const response = await fetch('/api/settings/general', {
      headers: {
        Authorization: `Basic ${token}`,
      },
    });

    if (response.status === 401) {
      throw new Error('Invalid username or password');
    }

    if (!response.ok) {
      throw new Error(`Login failed: ${response.statusText}`);
    }

    credentials.value = { username, password };
    required.value = true;
  }

  /**
   * Log out and clear credentials
   */
  function logout() {
    credentials.value = null;
  }

  return {
    credentials,
    required,
    isAuthenticated,
    authHeader,
    authToken,
    markRequired,
    login,
    logout,
  };
});
