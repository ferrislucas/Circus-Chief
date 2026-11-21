import { nextTick, ref, watch } from 'vue';
import { normalizeModelProviderPair, resolveDefaultModelId } from '../components/modelSelectorTiers.js';

/**
 * Picker binding and follow-up payload for one conversation tab.
 *
 * The picker shows the session identified by this tab. A plain follow-up
 * omits model and provider until the user changes the dropdown, so a remount
 * that fills the project default cannot be posted as a switch.
 *
 * @param {Object} args
 * @param {() => string} args.getSessionId
 * @param {Object} args.sessionsStore
 * @param {Object} args.providersStore
 * @param {Object} args.defaultsStore
 * @param {import('vue').Ref<string|null>} args.selectedModel
 * @param {import('vue').Ref<string|null>} args.selectedProviderId
 * @param {() => void} args.pauseModelPersist
 * @param {() => void} args.resumeModelPersist
 */
export function useFollowUpModel({
  getSessionId,
  sessionsStore,
  providersStore,
  defaultsStore,
  selectedModel: selectedModelRef,
  selectedProviderId: selectedProviderIdRef,
  pauseModelPersist,
  resumeModelPersist,
}) {
  const selectedModel = selectedModelRef;
  const selectedProviderId = selectedProviderIdRef;
  const userPickedModel = ref(false);

  function sessionForThisTab() {
    const sessionId = getSessionId();
    if (sessionsStore.currentSession?.id === sessionId) return sessionsStore.currentSession;
    const list = sessionsStore.sessions;
    if (!Array.isArray(list)) return null;
    return list.find((session) => session.id === sessionId) ?? null;
  }

  function projectDefaultPair(projectId) {
    const defaults = projectId ? defaultsStore.getDefaultsForProject(projectId) : null;
    return {
      model: defaults?.model || resolveDefaultModelId(providersStore.providers),
      providerId: defaults?.providerId || null,
    };
  }

  function pickerBinding() {
    const session = sessionForThisTab();
    if (!session) return null;
    if (session.model) {
      return normalizeModelProviderPair(session.model, session.providerId ?? null);
    }
    const fallback = projectDefaultPair(session.projectId);
    return normalizeModelProviderPair(fallback.model, fallback.providerId);
  }

  function applyPickerBinding(pair) {
    if (!pair) return;
    if (selectedModel.value === pair.model && selectedProviderId.value === pair.providerId) return;
    pauseModelPersist();
    selectedModel.value = pair.model;
    selectedProviderId.value = pair.providerId;
    nextTick(() => {
      resumeModelPersist();
    });
  }

  watch(
    () => {
      const session = sessionForThisTab();
      return [
        session?.id ?? null,
        session?.model ?? null,
        session?.providerId ?? null,
        sessionsStore.activeConversation?.id ?? null,
      ];
    },
    () => {
      if (userPickedModel.value) return;
      applyPickerBinding(pickerBinding());
    },
    { immediate: true }
  );

  function onUserModelSelected() {
    userPickedModel.value = true;
  }

  function onModelPickReverted() {
    userPickedModel.value = false;
  }

  function followUpSelection() {
    if (!userPickedModel.value) return { model: null, providerId: null };
    return { model: selectedModel.value, providerId: selectedProviderId.value };
  }

  return { onUserModelSelected, onModelPickReverted, followUpSelection };
}
