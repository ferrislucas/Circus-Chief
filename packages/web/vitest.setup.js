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

// Create a fresh Pinia instance before each test
beforeEach(() => {
  setActivePinia(createPinia());
});

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
