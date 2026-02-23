import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { api } from './useApi.js';

/**
 * Composable for session action handlers in the session detail view.
 * Includes duplicate, delete, archive, star, copy ID, and PR URL editing.
 *
 * @param {import('vue').Ref<string>} currentSessionId - Reactive session ID
 * @returns {Object} Action handlers and related state
 */
export function useSessionActions(currentSessionId) {
  const router = useRouter();
  const sessionsStore = useSessionsStore();
  const uiStore = useUiStore();

  const isDeleting = ref(false);

  // PR URL editing state
  const isEditingPrUrl = ref(false);
  const editPrUrlValue = ref('');

  async function handleDuplicate() {
    if (!confirm('Duplicate this session? A new session will be created with all conversations, canvas items, and notes.')) {
      return;
    }

    try {
      // Get the current session ID to duplicate
      const newSessionId = await sessionsStore.duplicateSession(currentSessionId.value);
      uiStore.success('Session duplicated');
      // Optionally navigate to the new session
      router.push(`/sessions/${newSessionId}/conversation`);
    } catch (err) {
      uiStore.error(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this session?')) return;

    isDeleting.value = true;

    // Show immediate feedback
    uiStore.addToast('info', 'Deleting session...', 0); // 0 = no auto-dismiss

    try {
      const projectId = sessionsStore.currentSession?.projectId;
      await sessionsStore.deleteSession(currentSessionId.value);

      // Remove the "Deleting..." toast
      const toastsToRemove = uiStore.toasts.filter(t => t.message === 'Deleting session...');
      toastsToRemove.forEach(t => uiStore.removeToast(t.id));

      uiStore.success('Session deleted');
      // Navigate to project sessions list
      if (projectId) {
        router.push(`/projects/${projectId}/sessions`);
      } else {
        router.push('/');
      }
    } catch (err) {
      isDeleting.value = false;

      // Remove the "Deleting..." toast
      const toastsToRemove = uiStore.toasts.filter(t => t.message === 'Deleting session...');
      toastsToRemove.forEach(t => uiStore.removeToast(t.id));

      uiStore.error(err.message);
    }
  }

  async function handleArchive() {
    try {
      const projectId = sessionsStore.currentSession?.projectId;
      const isArchived = sessionsStore.currentSession?.archived;

      const confirmMessage = isArchived ? 'Restore this session to active?' : 'Archive this session?';
      if (!confirm(confirmMessage)) {
        return;
      }

      if (isArchived) {
        await sessionsStore.unarchiveSession(currentSessionId.value);
        uiStore.success('Session unarchived');
      } else {
        await sessionsStore.archiveSession(currentSessionId.value);
        uiStore.success('Session archived');
      }
      // Navigate to project sessions list
      if (projectId) {
        router.push(`/projects/${projectId}/sessions`);
      } else {
        router.push('/');
      }
    } catch (err) {
      uiStore.error(err.message);
    }
  }

  async function handleStar() {
    try {
      await sessionsStore.toggleSessionStar(currentSessionId.value);
    } catch (err) {
      uiStore.error(err.message);
    }
  }

  async function handleCopySessionId() {
    const sessionId = currentSessionId.value;
    try {
      await navigator.clipboard.writeText(sessionId);
      uiStore.success(`Session ID copied to clipboard: ${sessionId}`);
    } catch (err) {
      // Fallback using textarea method for older browsers
      try {
        const textarea = document.createElement('textarea');
        textarea.value = sessionId;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        uiStore.success(`Session ID copied to clipboard: ${sessionId}`);
      } catch (fallbackErr) {
        console.error('Copy failed:', fallbackErr);
        uiStore.error('Failed to copy session ID');
      }
    }
  }

  // PR URL editing functions
  function startEditPrUrl() {
    editPrUrlValue.value = sessionsStore.currentSession?.prUrl || '';
    isEditingPrUrl.value = true;
  }

  function cancelEditPrUrl() {
    isEditingPrUrl.value = false;
    editPrUrlValue.value = '';
  }

  async function savePrUrl() {
    const newPrUrl = editPrUrlValue.value.trim();
    const sessionId = currentSessionId.value;

    // Validate if not empty
    if (newPrUrl) {
      const prUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
      if (!prUrlPattern.test(newPrUrl)) {
        uiStore.error('Invalid PR URL format. Must be a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)');
        return;
      }
    }

    try {
      const updated = await api.updateSession(sessionId, { prUrl: newPrUrl || null });
      // Update the session in the store (updateSession from WebSocket handler pattern)
      sessionsStore.updateSession({ ...updated, id: sessionId });
      uiStore.success(newPrUrl ? 'PR URL updated' : 'PR URL cleared');
      isEditingPrUrl.value = false;
      editPrUrlValue.value = '';
    } catch (err) {
      uiStore.error(err.message || 'Failed to update PR URL');
    }
  }

  async function clearPrUrl() {
    editPrUrlValue.value = '';
    await savePrUrl();
  }

  return {
    isDeleting,
    isEditingPrUrl,
    editPrUrlValue,
    handleDuplicate,
    handleDelete,
    handleArchive,
    handleStar,
    handleCopySessionId,
    startEditPrUrl,
    cancelEditPrUrl,
    savePrUrl,
    clearPrUrl,
  };
}
