import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router.js';
import { initPostHog } from './plugins/posthog.js';
import './assets/main.css';

// Initialize PostHog before mounting the app.
// The API key is baked in at build time via VITE_POSTHOG_KEY.
// When empty (local dev, CI), analytics are silently disabled.
// With defaults: '2026-01-30', SPA page views are tracked automatically
// via the browser History API — no router.afterEach hook needed.
async function initializeApp() {
  try {
    // Fetch general settings before initializing PostHog
    const resp = await fetch('/api/settings/general');
    const { disableAnalytics } = await resp.json();
    initPostHog({ disableAnalytics });
  } catch {
    // Fail-open: tracking stays on if the API call fails
    console.log('PostHog: Failed to fetch general settings, using defaults');
    initPostHog();
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');
}

initializeApp();
