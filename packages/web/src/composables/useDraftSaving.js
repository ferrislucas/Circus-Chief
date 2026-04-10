import { ref, onUnmounted } from 'vue';
import { api } from './useApi.js';

/**
 * Composable for managing draft/pending prompt saving with debounced server persistence.
 *
 * Handles:
 * - Immediate reactive state sync (for button enabling)
 * - Debounced server save (500ms) to avoid excessive API calls
 * - Save status tracking (saved, saving, unsaved, error)
 *
 * @param {Object} options
 * @param {import('vue').Ref<string>} options.input - Reactive input value
 * @param {import('vue').Ref<boolean>} options.canSendMessage - Whether the session can accept messages
 * @param {import('vue').Ref<boolean>} [options.isRunning] - Whether the session is currently running
 * @param {() => string} options.getSessionId - Function that returns the current session ID
 * @returns {Object} Draft saving utilities
 */
export function useDraftSaving({ input: inputRef, canSendMessage, isRunning, getSessionId }) {
  const input = inputRef;
  const saveStatus = ref('saved'); // 'saved', 'saving', 'error', 'unsaved'
  const saveError = ref('');
  let inputSyncTimer = null;
  let draftSaveTimer = null;

  /**
   * Handle textarea input with debounced sync to reactive state and server.
   * Syncs to reactive state immediately (for button enabling) but debounces server save.
   * @param {Event} event - The input event
   */
  function handleInput(event) {
    const value = event.target.value;

    // Sync to reactive state IMMEDIATELY (for button enabling to work)
    input.value = value;

    // Mark as unsaved immediately (but only if status changed)
    if (saveStatus.value !== 'unsaved' && saveStatus.value !== 'saving') {
      saveStatus.value = 'unsaved';
    }

    // Debounce the server save
    if (inputSyncTimer) clearTimeout(inputSyncTimer);
    if (draftSaveTimer) clearTimeout(draftSaveTimer);

    inputSyncTimer = setTimeout(() => {
      // Auto-save to server (for all waiting/stopped/error sessions, or running state)
      if (canSendMessage.value || isRunning?.value) {
        savePendingPrompt(value);
      }
    }, 500); // Debounce 500ms for server save
  }

  /**
   * Save the pending prompt to the server.
   * @param {string} prompt - The prompt text to save
   */
  async function savePendingPrompt(prompt) {
    try {
      saveStatus.value = 'saving';
      saveError.value = '';
      await api.updateSessionPendingPrompt(getSessionId(), prompt);
      saveStatus.value = 'saved';
      // Reset save status after 2 seconds
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => {
        if (saveStatus.value === 'saved') {
          saveStatus.value = 'saved';
        }
      }, 2000);
    } catch (err) {
      saveStatus.value = 'error';
      saveError.value = err.message;
      console.error('Failed to save pending prompt:', err);
    }
  }

  /**
   * Immediately flush any pending (debounced) draft save.
   * Clears timers and saves the current input value if there's unsaved text.
   * Call this before the component is destroyed or the session switches.
   */
  function flush() {
    // Clear pending debounce timers so they don't fire after flush
    if (inputSyncTimer) {
      clearTimeout(inputSyncTimer);
      inputSyncTimer = null;
    }
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }

    // If there's unsaved content, save it immediately
    if (saveStatus.value === 'unsaved' || saveStatus.value === 'saving') {
      const currentValue = input.value;
      if (currentValue != null) {
        savePendingPrompt(currentValue);
      }
    }
  }

  /**
   * Clean up timers. Should be called on component unmount.
   */
  function cleanup() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    if (inputSyncTimer) clearTimeout(inputSyncTimer);
  }

  onUnmounted(cleanup);

  return {
    saveStatus,
    saveError,
    handleInput,
    savePendingPrompt,
    flush,
    cleanup,
  };
}
