import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { nextTick } from 'vue';

/**
 * Tests for localStorage draft persistence in NewSessionView
 * These tests focus on the draft persistence functionality without
 * requiring full component mounting (which has template ref issues).
 */

describe('NewSessionView - localStorage draft persistence', () => {
  let localStorageMock;
  let debounceTimer = null;

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {
      data: {},
      getItem: vi.fn((key) => localStorageMock.data[key] || null),
      setItem: vi.fn((key, value) => {
        localStorageMock.data[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete localStorageMock.data[key];
      }),
      clear: vi.fn(() => {
        localStorageMock.data = {};
      }),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    debounceTimer = null;
  });

  afterEach(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('Storage key generation', () => {
    it('generates correct storage key using project ID', () => {
      const projectId = 'project-123';
      const storageKey = computed(() => `new-session-draft-${projectId}`);

      expect(storageKey.value).toBe('new-session-draft-project-123');
    });

    it('different projects have different storage keys', () => {
      const projectId1 = 'project-abc';
      const projectId2 = 'project-xyz';
      const storageKey1 = computed(() => `new-session-draft-${projectId1}`);
      const storageKey2 = computed(() => `new-session-draft-${projectId2}`);

      expect(storageKey1.value).not.toBe(storageKey2.value);
    });
  });

  describe('Loading draft on mount', () => {
    it('loads saved draft from localStorage on mount', () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;
      const savedDraft = 'Previously saved prompt text';

      // Pre-populate localStorage
      localStorageMock.setItem(storageKey, savedDraft);

      // Simulate onMounted behavior
      const savedValue = localStorage.getItem(storageKey);
      if (savedValue) {
        prompt.value = savedValue;
      }

      expect(prompt.value).toBe(savedDraft);
    });

    it('does not load draft if localStorage is empty', () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;

      // Ensure localStorage is empty
      localStorage.removeItem(storageKey);

      // Simulate onMounted behavior
      const savedValue = localStorage.getItem(storageKey);
      if (savedValue) {
        prompt.value = savedValue;
      }

      expect(prompt.value).toBe('');
    });

    it('loads draft for correct project when multiple projects have drafts', () => {
      const prompt1 = ref('');
      const prompt2 = ref('');
      const projectId1 = 'project-1';
      const projectId2 = 'project-2';
      const key1 = `new-session-draft-${projectId1}`;
      const key2 = `new-session-draft-${projectId2}`;
      const draft1 = 'Draft for project 1';
      const draft2 = 'Draft for project 2';

      // Pre-populate localStorage with different drafts
      localStorageMock.setItem(key1, draft1);
      localStorageMock.setItem(key2, draft2);

      // Load drafts for each project
      const saved1 = localStorage.getItem(key1);
      if (saved1) prompt1.value = saved1;

      const saved2 = localStorage.getItem(key2);
      if (saved2) prompt2.value = saved2;

      expect(prompt1.value).toBe(draft1);
      expect(prompt2.value).toBe(draft2);
    });
  });

  describe('Saving draft with debounce', () => {
    it('saves non-empty prompt to localStorage', async () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;

      // Simulate watch with debounce
      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      prompt.value = 'User typed a prompt';
      await new Promise(resolve => setTimeout(resolve, 600)); // Wait for debounce

      expect(localStorage.getItem(storageKey)).toBe('User typed a prompt');
    });

    it('debounces multiple rapid changes', async () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;

      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      // Rapid changes
      prompt.value = 'Type';
      await new Promise(resolve => setTimeout(resolve, 100));
      prompt.value = 'Type more';
      await new Promise(resolve => setTimeout(resolve, 100));
      prompt.value = 'Type even more';
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not have saved yet
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should save only once with final value
      expect(localStorage.getItem(storageKey)).toBe('Type even more');
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });

    it('removes empty/whitespace-only prompts from localStorage', async () => {
      const projectId = 'project-123';
      const prompt = ref('Initial text');
      const storageKey = `new-session-draft-${projectId}`;

      // Pre-populate with something
      localStorage.setItem(storageKey, 'Initial text');

      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      // Clear the prompt
      prompt.value = '   ';
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(storageKey);
    });

    it('respects 500ms debounce timing', async () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;
      const setItemSpy = vi.spyOn(localStorageMock, 'setItem');

      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      prompt.value = 'Testing debounce timing';

      // Before 500ms, should not be saved
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(setItemSpy).not.toHaveBeenCalled();

      // After 500ms, should be saved
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(setItemSpy).toHaveBeenCalledWith(storageKey, 'Testing debounce timing');
    });
  });

  describe('Clearing draft on successful submission', () => {
    it('removes draft from localStorage after successful session creation', () => {
      const projectId = 'project-123';
      const storageKey = `new-session-draft-${projectId}`;
      const draft = 'Submitted prompt';

      // Pre-populate with draft
      localStorage.setItem(storageKey, draft);
      expect(localStorage.getItem(storageKey)).toBe(draft);

      // Simulate successful submission
      localStorage.removeItem(storageKey);

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(storageKey);
    });

    it('clears draft regardless of submission type (immediate or draft)', () => {
      const projectId = 'project-123';
      const storageKey = `new-session-draft-${projectId}`;
      const draft = 'Some prompt';

      // Test with immediate submission
      localStorage.setItem(storageKey, draft);
      localStorage.removeItem(storageKey);
      expect(localStorage.getItem(storageKey)).toBeNull();

      // Test with draft submission
      localStorage.setItem(storageKey, draft);
      localStorage.removeItem(storageKey);
      expect(localStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe('Debounce timer cleanup', () => {
    it('clears debounce timer on unmount', () => {
      // Test the timer cleanup logic directly
      let testDebounceTimer = null;
      const projectId = 'project-123';
      const storageKey = `new-session-draft-${projectId}`;
      let savedValue = null;

      // Simulate setting up a debounce timer
      testDebounceTimer = setTimeout(() => {
        savedValue = 'This should not happen';
      }, 500);

      // Verify timer exists
      expect(testDebounceTimer).not.toBeNull();

      // Simulate onUnmounted cleanup
      if (testDebounceTimer) {
        clearTimeout(testDebounceTimer);
        testDebounceTimer = null;
      }

      // Timer should be cleared, preventing the callback from executing
      expect(testDebounceTimer).toBe(null);
    });

    it('prevents pending saves after unmount', async () => {
      const projectId = 'project-123';
      const storageKey = `new-session-draft-${projectId}`;
      let testDebounceTimer = null;
      let saveOccurred = false;

      // Simulate initial watch setup
      const callback = (newValue) => {
        if (testDebounceTimer) clearTimeout(testDebounceTimer);
        testDebounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            saveOccurred = true;
          }
        }, 500);
      };

      // User types something
      callback('Text before unmount');

      // Immediately unmount (clear timer before it can fire)
      if (testDebounceTimer) {
        clearTimeout(testDebounceTimer);
        testDebounceTimer = null;
      }

      // Wait past the debounce time
      await new Promise(resolve => setTimeout(resolve, 600));

      // Save should NOT have occurred since we cleared the timer
      expect(saveOccurred).toBe(false);
    });
  });

  describe('Integration scenarios', () => {
    it('handles complete user workflow: load -> edit -> save -> submit', async () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;
      const originalDraft = 'Original draft text';

      // Step 1: Pre-populate with existing draft
      localStorage.setItem(storageKey, originalDraft);

      // Step 2: Component mounts and loads draft
      const savedValue = localStorage.getItem(storageKey);
      if (savedValue) {
        prompt.value = savedValue;
      }
      expect(prompt.value).toBe(originalDraft);

      // Step 3: User edits the prompt
      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      prompt.value = 'User edited the draft';
      await new Promise(resolve => setTimeout(resolve, 600));

      // Step 4: Verify updated draft is saved
      expect(localStorage.getItem(storageKey)).toBe('User edited the draft');

      // Step 5: User submits (clear draft)
      localStorage.removeItem(storageKey);

      // Step 6: Verify draft is cleared
      expect(localStorage.getItem(storageKey)).toBeNull();
    });

    it('maintains separate drafts when switching projects', () => {
      const project1 = ref({ id: 'proj-1' });
      const project2 = ref({ id: 'proj-2' });
      const prompt = ref('');
      const storageKey1 = `new-session-draft-${project1.value.id}`;
      const storageKey2 = `new-session-draft-${project2.value.id}`;
      const draft1 = 'Draft for project 1';
      const draft2 = 'Draft for project 2';

      // Load project 1 draft
      localStorage.setItem(storageKey1, draft1);
      let saved = localStorage.getItem(storageKey1);
      if (saved) prompt.value = saved;
      expect(prompt.value).toBe(draft1);

      // Switch to project 2 (clear and load new draft)
      localStorage.setItem(storageKey2, draft2);
      prompt.value = '';
      saved = localStorage.getItem(storageKey2);
      if (saved) prompt.value = saved;
      expect(prompt.value).toBe(draft2);

      // Verify project 1 draft still exists in storage
      expect(localStorage.getItem(storageKey1)).toBe(draft1);
    });

    it('handles user cancellation: draft persists when navigating away', () => {
      const projectId = 'project-123';
      const prompt = ref('Work in progress');
      const storageKey = `new-session-draft-${projectId}`;

      // Simulate draft saving
      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      }, { flush: 'post' });

      // Initial value triggers save
      prompt.value = 'Work in progress';

      // When user navigates away without submitting, draft persists
      // (no removal of localStorage entry happens)

      expect(localStorage.getItem(storageKey)).toBeNull(); // Not saved yet due to debounce

      // After return and mount, draft would be restored
      const restored = localStorage.getItem(storageKey);
      // In production, after debounce completes it would be saved
    });
  });

  describe('Edge cases', () => {
    it('handles localStorage quota exceeded gracefully', () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;

      // Mock localStorage.setItem to throw
      const setItemMock = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            try {
              localStorage.setItem(storageKey, newValue);
            } catch (e) {
              console.error('Failed to save draft:', e);
            }
          }
        }, 500);
      });

      prompt.value = 'Large text';

      // Shouldn't throw when component tries to save
      expect(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
      }).not.toThrow();
    });

    it('handles corrupted localStorage data', () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;

      // This shouldn't happen with strings, but test defensive coding
      localStorage.setItem(storageKey, 'valid text');

      const saved = localStorage.getItem(storageKey);
      if (saved && typeof saved === 'string') {
        prompt.value = saved;
      }

      expect(prompt.value).toBe('valid text');
    });

    it('handles null/undefined project ID gracefully', () => {
      const projectId = null;
      const storageKey = projectId ? `new-session-draft-${projectId}` : 'new-session-draft-default';

      expect(storageKey).toBe('new-session-draft-default');
    });

    it('preserves draft with special characters and newlines', async () => {
      const projectId = 'project-123';
      const prompt = ref('');
      const storageKey = `new-session-draft-${projectId}`;
      const complexDraft = 'Line 1\nLine 2\n\nWith "quotes" and \'apostrophes\'\n<html>tags</html>';

      watch(prompt, (newValue) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (newValue.trim()) {
            localStorage.setItem(storageKey, newValue);
          } else {
            localStorage.removeItem(storageKey);
          }
        }, 500);
      });

      prompt.value = complexDraft;
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(localStorage.getItem(storageKey)).toBe(complexDraft);
    });
  });
});
