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

    const sessionId = getSessionId();
    restarting.value = true;
    try {
      await sessionsStore.startSession(sessionId, prompt, model);
      // Mark this session as having a recent send so `ConversationTab`'s
      // onMounted restore path (and status watcher) knows not to re-populate
      // the textarea with the just-sent prompt on remount.
      sessionsStore.markRecentSend?.(sessionId);
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
   *
   * Order of operations (important for the "ghost prompt" fix):
   *   1. Clear the server's `pendingPrompt` FIRST so any WebSocket
   *      `session:updated` frame arriving mid-send cannot re-snapshot the
   *      stale value into the local store.
   *   2. Send the message.
   *   3. Mark the session as having a recent send so the onMounted restore
   *      in ConversationTab skips re-populating the textarea if the tab
   *      is remounted within the TTL window.
   *
   * If sendMessage fails after the prompt was cleared, we best-effort
   * restore the server's `pendingPrompt` so the user's draft isn't lost.
   *
   * @param {string} message - The message text
   * @param {Array} attachedFiles - File attachments
   * @param {string} selectedModel - The model to use
   * @returns {boolean} Whether the send was successful
   */
  async function handleSend(message, attachedFiles, selectedModel) {
    if (!message?.trim() || sending.value) return false;

    console.log(`[MODEL AUDIT - Frontend] Sending message with model: "${selectedModel}"`);

    const sessionId = getSessionId();
    sending.value = true;

    // Snapshot whether we've cleared the server draft so we know whether to
    // restore it on failure.
    let clearedServerDraft = false;

    try {
      // 1. Clear server pendingPrompt FIRST (closes the WS interleave window).
      await api.updateSessionPendingPrompt(sessionId, null);
      clearedServerDraft = true;

      // 2. Send the message.
      await sessionsStore.sendMessage(sessionId, message, attachedFiles, selectedModel);

      // 3. Mark as recent-send so remounts don't restore the just-sent prompt.
      sessionsStore.markRecentSend?.(sessionId);
      return true;
    } catch (err) {
      // Best-effort restore so the user's draft isn't silently discarded.
      if (clearedServerDraft) {
        try {
          await api.updateSessionPendingPrompt(sessionId, message);
        } catch (_restoreErr) {
          // Swallow restore failure — the primary error is more useful to surface.
        }
      }
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

    const target = event.target;
    const newValue = target.checked;
    togglingThinking.value = true;
    try {
      await sessionsStore.updateSessionThinking(getSessionId(), newValue);
    } catch (err) {
      // Revert the checkbox on error
      target.checked = !newValue;
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
