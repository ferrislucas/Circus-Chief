import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';

describe('PostHog Plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module so `initialized` flag resets between tests
    vi.resetModules();
  });

  describe('initPostHog', () => {
    it('calls posthog.init with correct config when API key is set', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');
      vi.stubEnv('VITE_POSTHOG_HOST', 'https://us.i.posthog.com');

      const { initPostHog } = await import('./posthog.js');
      initPostHog();

      expect(posthog.init).toHaveBeenCalledOnce();
      expect(posthog.init).toHaveBeenCalledWith('phc_test_key', expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        disable_session_recording: true,
        defaults: '2026-01-30',
        respect_dnt: true,
        persistence: 'localStorage',
        autocapture: true,
        capture_pageleave: true,
      }));

      vi.unstubAllEnvs();
    });

    it('does NOT call posthog.init when API key is missing', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', '');

      const { initPostHog } = await import('./posthog.js');
      initPostHog();

      expect(posthog.init).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('uses default host when VITE_POSTHOG_HOST is not set', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');
      vi.stubEnv('VITE_POSTHOG_HOST', '');

      const { initPostHog } = await import('./posthog.js');
      initPostHog();

      expect(posthog.init).toHaveBeenCalledWith('phc_test_key', expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
      }));

      vi.unstubAllEnvs();
    });

    it('sets session recording to disabled', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');

      const { initPostHog } = await import('./posthog.js');
      initPostHog();

      expect(posthog.init).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          disable_session_recording: true,
        })
      );

      vi.unstubAllEnvs();
    });

    it('sets initialized flag after successful init', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key');

      const { initPostHog, isPostHogInitialized } = await import('./posthog.js');
      expect(isPostHogInitialized()).toBe(false);

      initPostHog();
      expect(isPostHogInitialized()).toBe(true);

      vi.unstubAllEnvs();
    });

    it('does not set initialized flag when key is missing', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', '');

      const { initPostHog, isPostHogInitialized } = await import('./posthog.js');
      initPostHog();
      expect(isPostHogInitialized()).toBe(false);

      vi.unstubAllEnvs();
    });
  });
});
