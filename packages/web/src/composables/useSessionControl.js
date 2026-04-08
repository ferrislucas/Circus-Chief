import { ref } from 'vue';
import { useInjectedSessionsStore } from './useOverlayStore.js';
import { useUiStore } from '../stores/ui.js';
import { api } from './useApi.js';

/**
 * Composable for session control actions (stop, restart, start, thinking toggle).
 *
 * Encapsulates the loading states and API calls for session lifecycle actions.
 *
 * @param {Object} options
 * @param {() => string} options.getSessionId - Function that returns the current session ID
 * @returns {Object} Session control utilities
 */
export function useSessionControl({ getSessionId }) {
  const sessionsStore = useInjectedSessionsStore();
  const uiStore = useUiStore();

  const sending = ref(false);
  const stopping = ref(false);
  const restarting = ref(false);
  const togglingThinking = ref(false);

  /**
   * Stop the current session.
   */
  async function handleStop() {
    if (stopping.value) return;

    stopping.value = true;
    try {
      await sessionsStore.stopSession(getSessionId());
      uiStore.success('Session stopped');
    } catch (err) {
      uiStore.error(err.message);
    } finally {
      stopping.value = false;
    }
  }

  /**
   * Restart the current session.
   */
  async function handleRestart() {
    if (restarting.value) return;

    restarting.value = true;
    try {
      await sessionsStore.restartSession(getSessionId());
      uiStore.success('Session restarted');
    } catch (err) {
      uiStore.error(err.message);
    } finally {
      restarting.value = false;
    }
  }

  /**
   * Start a draft session with the given prompt and model.
   * @param {string} prompt - The prompt to send
   * @param {string} model - The model to use
   */
  async function handleStart(prompt, model) {
    if (restarting.value || !prompt?.trim()) return false;

    restarting.value = true;
    try {
      await sessionsStore.startSession(getSessionId(), prompt, model);
      return true;
    } catch (err) {
      uiStore.error(err.message);
      return false;
    } finally {
      restarting.value = false;
    }
  }

  /**
   * Send a follow-up message.
   * @param {string} message - The message text
   * @param {Array} attachedFiles - File attachments
   * @param {string} selectedModel - The model to use
   * @returns {boolean} Whether the send was successful
   */
  async function handleSend(message, attachedFiles, selectedModel) {
    if (!message?.trim() || sending.value) return false;

    console.log(`[MODEL AUDIT - Frontend] Sending message with model: "${selectedModel}"`);

    sending.value = true;
    try {
      await sessionsStore.sendMessage(getSessionId(), message, attachedFiles, selectedModel);
      // Clear pending prompt on server
      await api.updateSessionPendingPrompt(getSessionId(), null);
      return true;
    } catch (err) {
      uiStore.error(err.message);
      return false;
    } finally {
      sending.value = false;
    }
  }

  /**
   * Toggle extended thinking mode.
   * @param {Event} event - The change event from the checkbox
   */
  async function handleThinkingToggle(event) {
    if (togglingThinking.value) return;

    const newValue = event.target.checked;
    togglingThinking.value = true;
    try {
      await sessionsStore.updateSessionThinking(getSessionId(), newValue);
    } catch (err) {
      // Revert the checkbox on error
      event.target.checked = !newValue;
      uiStore.error(err.message);
    } finally {
      togglingThinking.value = false;
    }
  }

  return {
    sending,
    stopping,
    restarting,
    togglingThinking,
    handleStop,
    handleRestart,
    handleStart,
    handleSend,
    handleThinkingToggle,
  };
}
