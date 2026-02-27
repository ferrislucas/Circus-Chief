import posthog from 'posthog-js';

let initialized = false;

export function initPostHog(options = {}) {
  const { disableAnalytics = false } = options;

  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  const apiHost = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

  if (!apiKey) {
    console.log('PostHog: No API key configured, analytics disabled');
    return;
  }

  if (disableAnalytics) {
    console.log('PostHog: Analytics disabled by user setting');
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,

    // Use latest PostHog defaults snapshot.
    // This sets capture_pageview to 'history_change' which automatically
    // tracks SPA navigations via the browser History API — no manual
    // router.afterEach hook needed.
    defaults: '2026-01-30',

    // DISABLE SESSION RECORDING
    disable_session_recording: true,

    // capture_pageleave tracks when users navigate away from the page.
    capture_pageleave: true,

    // Enable autocapture for clicks, form submissions, etc.
    autocapture: true,

    // Respect Do Not Track browser setting
    respect_dnt: true,

    // Persistence
    persistence: 'localStorage',
  });

  initialized = true;
}

export function isPostHogInitialized() {
  return initialized;
}

export { posthog };
