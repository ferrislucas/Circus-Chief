import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router.js';
import { useAuthStore } from './stores/auth.js';
import { initFetchAuth } from './api/fetchWithAuth.js';
import { initPostHog } from './plugins/posthog.js';
import './assets/main.css';

// Initialization order:
// 1. Create Pinia instance (needed for stores outside components)
// 2. Create router
// 3. Create auth store and wire up fetch wrapper (before any API calls)
// 4. Make initial API calls (now patched with auth)
// 5. Create and mount Vue app

async function initializeApp() {
  // 1. Create Pinia first
  const pinia = createPinia();

  // 2. Router is already imported as a singleton

  // 3. Create auth store and wire fetch wrapper BEFORE any API calls
  const authStore = useAuthStore(pinia);
  initFetchAuth(authStore, router);

  // Add navigation guard for auth
  router.beforeEach((to) => {
    // If going to login and already authenticated, redirect to home
    if (to.name === 'Login' && authStore.isAuthenticated) {
      return '/';
    }
    // If going to a non-public route and auth is required but not authenticated, redirect to login
    if (!to.meta?.public && authStore.required && !authStore.isAuthenticated) {
      return '/login';
    }
  });

  // 4. Fetch general settings (now goes through patched fetch with auth handling)
  try {
    const resp = await fetch('/api/settings/general');
    const { disableAnalytics } = await resp.json();
    initPostHog({ disableAnalytics });
  } catch {
    // Fail-open: tracking stays on if the API call fails
    console.log('PostHog: Failed to fetch general settings, using defaults');
    initPostHog();
  }

  // 5. Create app, install plugins, mount
  const app = createApp(App);
  app.use(pinia);
  app.use(router);
  app.mount('#app');
}

initializeApp();
