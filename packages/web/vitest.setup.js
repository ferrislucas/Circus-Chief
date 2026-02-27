// Vitest setup file for Pinia stores and module mocks
import { beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock DOMPurify for tests that use markdown rendering
// This mock provides a simple sanitization function that removes script tags
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((html) => {
      // Simple sanitization that removes script tags for testing
      // This handles XSS prevention tests without requiring full DOM APIs
      return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }),
  },
}));

// Mock posthog-js for tests
// PostHog is initialized in main.js via the plugin; without this mock,
// any test that transitively imports posthog would attempt real network calls.
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
    get_distinct_id: vi.fn(() => 'test-distinct-id'),
    __loaded: false,
  },
}));

// Create a fresh Pinia instance before each test
beforeEach(() => {
  setActivePinia(createPinia());
});

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
