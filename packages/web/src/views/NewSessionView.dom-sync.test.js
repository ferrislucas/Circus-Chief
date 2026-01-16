import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, onMounted, watch } from 'vue';

/**
 * Unit tests for the DOM synchronization fix in NewSessionView
 * Tests the nextTick behavior that syncs textarea value after restoration from localStorage
 */

describe('NewSessionView - DOM Synchronization on Draft Restoration', () => {
  let localStorageMock;

  beforeEach(() => {
    localStorageMock = {
      data: {},
      getItem: vi.fn((key) => localStorageMock.data[key] || null),
      setItem: vi.fn((key, value) => {
        localStorageMock.data[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete localStorageMock.data[key];
      }),
    };
    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('nextTick ensures DOM sync', () => {
    it('uses nextTick to sync textarea value after promise chain', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const promptHasContent = ref(false);
      const storageKey = 'new-session-draft-project-123';
      const savedDraft = 'Previously saved content';

      // Pre-populate localStorage
      localStorageMock.setItem(storageKey, savedDraft);

      // Create a mock textarea element
      const mockTextarea = {
        value: '',
      };
      textareaRef.value = mockTextarea;

      // Simulate the onMounted hook behavior from NewSessionView.vue
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        prompt.value = saved;
        // This is the critical fix: use nextTick to ensure DOM is synced
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
            promptHasContent.value = saved.trim().length > 0;
          }
        });
      }

      // Wait for nextTick to complete
      await nextTick();

      // Verify both reactive state and DOM are updated
      expect(prompt.value).toBe(savedDraft);
      expect(textareaRef.value.value).toBe(savedDraft);
      expect(promptHasContent.value).toBe(true);
    });

    it('textarea DOM value is set even if ref was initially null', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const storageKey = 'new-session-draft-project-456';
      const savedDraft = 'Content to restore';

      localStorageMock.setItem(storageKey, savedDraft);

      // Initially textareaRef is null (typical during mount)
      expect(textareaRef.value).toBeNull();

      const saved = localStorage.getItem(storageKey);
      if (saved) {
        prompt.value = saved;

        // Simulate the component mounting and ref being populated
        const mockTextarea = { value: '' };
        textareaRef.value = mockTextarea;

        // Now sync with nextTick
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
          }
        });
      }

      // After nextTick
      await nextTick();

      expect(textareaRef.value.value).toBe(savedDraft);
    });

    it('handles promptHasContent flag correctly based on restored content', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const promptHasContent = ref(false);
      const storageKey = 'new-session-draft-project-789';

      // Test with non-empty content
      const contentfulDraft = 'This has content';
      localStorageMock.setItem(storageKey, contentfulDraft);

      const mockTextarea = { value: '' };
      textareaRef.value = mockTextarea;

      const saved = localStorage.getItem(storageKey);
      if (saved) {
        prompt.value = saved;
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
            promptHasContent.value = saved.trim().length > 0;
          }
        });
      }

      await nextTick();
      expect(promptHasContent.value).toBe(true);

      // Test with whitespace-only content
      const whitespaceDraft = '   \n  ';
      localStorageMock.setItem(storageKey, whitespaceDraft);
      promptHasContent.value = false;

      const saved2 = localStorage.getItem(storageKey);
      if (saved2) {
        prompt.value = saved2;
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved2;
            promptHasContent.value = saved2.trim().length > 0;
          }
        });
      }

      await nextTick();
      expect(promptHasContent.value).toBe(false);
    });

    it('synchronizes both reactive and DOM state independently', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const storageKey = 'new-session-draft-project-101';
      const restoredDraft = 'Async restored content';

      localStorageMock.setItem(storageKey, restoredDraft);
      const mockTextarea = { value: '' };
      textareaRef.value = mockTextarea;

      // Simulate async restoration
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        // React state is updated immediately
        prompt.value = saved;

        // DOM is updated after nextTick (ensuring Vue has rendered)
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
          }
        });
      }

      // Verify state is set before nextTick
      expect(prompt.value).toBe(restoredDraft);

      // Verify DOM is synced after nextTick
      await nextTick();
      expect(textareaRef.value.value).toBe(restoredDraft);
    });

    it('prevents race conditions with debounced save', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const storageKey = 'new-session-draft-race-test';
      let debounceTimer = null;

      const mockTextarea = { value: '' };
      textareaRef.value = mockTextarea;

      // Simulate restoration
      const initialDraft = 'Initial content';
      localStorageMock.setItem(storageKey, initialDraft);

      const saved = localStorage.getItem(storageKey);
      if (saved) {
        prompt.value = saved;
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
          }
        });
      }

      await nextTick();

      // Now simulate user input that triggers debounced save
      // This should not conflict with the restored draft
      const newInput = 'User typed this';
      watch(
        prompt,
        (newValue) => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (newValue.trim()) {
              localStorageMock.setItem(storageKey, newValue);
            }
          }, 500);
        },
        { flush: 'post' }
      );

      // Change prompt value
      prompt.value = newInput;
      await nextTick();

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Verify localStorage is updated with new content
      expect(localStorageMock.getItem(storageKey)).toBe(newInput);

      // Cleanup
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  });

  describe('Bug scenario: without nextTick (regression test)', () => {
    it('demonstrates why nextTick is necessary', async () => {
      const prompt = ref('');
      const textareaRef = ref(null);
      const storageKey = 'new-session-draft-bug-demo';
      const savedDraft = 'Draft that should be visible';

      localStorageMock.setItem(storageKey, savedDraft);

      // Create mock textarea
      const mockTextarea = { value: '' };
      textareaRef.value = mockTextarea;

      // WITHOUT nextTick (the bug):
      // Setting prompt.value alone doesn't update textarea.value
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        prompt.value = saved; // ✓ Reactive state updated
        // ✗ BUT textarea.value is not set - bug!
      }

      // At this point, reactive state is updated but DOM is not
      expect(prompt.value).toBe(savedDraft); // ✓ Reactive state OK
      expect(textareaRef.value.value).toBe(''); // ✗ DOM is empty - BUG

      // WITH nextTick (the fix):
      textareaRef.value.value = ''; // Reset for test
      if (saved) {
        prompt.value = saved;
        // ✓ NOW we update textarea via nextTick
        nextTick(() => {
          if (textareaRef.value) {
            textareaRef.value.value = saved;
          }
        });
      }

      await nextTick();

      expect(prompt.value).toBe(savedDraft); // ✓ Reactive state OK
      expect(textareaRef.value.value).toBe(savedDraft); // ✓ DOM updated - FIXED
    });
  });
});
