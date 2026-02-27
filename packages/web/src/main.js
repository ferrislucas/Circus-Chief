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
initPostHog();

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');
