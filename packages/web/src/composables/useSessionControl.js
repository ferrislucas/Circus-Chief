import { ref } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { api } from './useApi.js';

/**
 * Execute an action with a loading guard and error toast.
 * @param {import('vue').Ref<boolean>} loadingRef - Ref to guard against double-invocation
 * @param {Object} uiStore - UI store for error toasts
 * @param {Function} action - Async action to execute
 * @param {string} [successMessage] - Optional success message to toast
 * @returns {Promise<*>} Result of the action
 */
async function guardedAction(loadingRef, uiStore, action, successMessage) {
  if (loadingRef.value) return;

  loadingRef.value = true;
  try {
    const result = await action();
    if (successMessage) {
      uiStore.success(successMessage);
    }
    return result;
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    loadingRef.value = false;
  }
}

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
  const sessionsStore = useSessionsStore();
  const uiStore = useUiStore();

  const sending = ref(false);
  const stopping = ref(false);
  const restarting = ref(false);
  const togglingThinking = ref(false);

  async function handleStop() {
    await guardedAction(stopping, uiStore, () => sessionsStore.stopSession(getSessionId()), 'Session stopped');
  }

  async function handleRestart() {
    await guardedAction(restarting, uiStore, () => sessionsStore.restartSession(getSessionId()), 'Session restarted');
  }

  async function handleStart(prompt, model) {
    if (!prompt?.trim()) return;
    await guardedAction(restarting, uiStore, () => sessionsStore.startSession(getSessionId(), prompt, model));
  }

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
