// Vitest setup file for Pinia stores and module mocks
import { beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// jsdom does not provide IntersectionObserver. Keep the mock controllable so
// visibility-gated components exercise their production path in tests.
class MockIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    MockIntersectionObserver.instances.push(this);
  }

  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  trigger(isIntersecting, target = [...this.targets][0]) {
    this.callback([{ isIntersecting, target }]);
  }
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// Stub window.matchMedia (jsdom does not implement it).
// Default: wide screen (matches = false for max-width: 640px).
// Individual tests can override:
//   window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
// Guard for test files that opt into `@vitest-environment node` (no global `window`).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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
  MockIntersectionObserver.instances = [];
});

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
