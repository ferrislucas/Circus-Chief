import { watch } from 'vue';
import {
  agentTypeForProviders,
  isKindResolvable,
  persistModelSelectionWithConfirm,
} from '../components/crossKindSwitch.js';

/**
 * Owns picker → session model persistence for the conversation tab,
 * including the cross-provider switch confirm/revert flow (FRD §4/G4).
 * Extracted from ConversationTab.vue, which is at the `max-lines` budget.
 *
 * @param {object} args
 * @param {() => string} args.getSessionId - Session id resolved at persist time.
 * @param {import('vue').Ref<string|null>} args.selectedModel - Picker model ref.
 * @param {import('vue').Ref<string|null>} args.selectedProviderId - Picker provider ref.
 * @param {object} args.sessionsStore - Sessions store (currentSession, isDraftSession, updateSessionModel).
 * @param {object} args.providersStore - Providers store (providers catalog).
 * @param {object} args.uiStore - UI store (error surfacing).
 * @returns {{ pauseModelPersist: () => void, resumeModelPersist: () => void }}
 *   Guards for programmatic ref updates that must not trigger a persist
 *   (model initialization, template application).
 */
export function useModelSelectionPersist({
  getSessionId,
  selectedModel: selectedModelRef,
  selectedProviderId: selectedProviderIdRef,
  sessionsStore,
  providersStore,
  uiStore,
}) {
  const selectedModel = selectedModelRef;
  const selectedProviderId = selectedProviderIdRef;
  let suppressNextModelPersist = false;
  // Caller-owned persist epoch: each dispatched picker change stamps its
  // sequence; a slow 4xx from an earlier change is stale and must not revert
  // a newer confirmed choice. Owned here (not in crossKindSwitch.js) so the
  // counter never leaks across component instances.
  let modelPersistSeq = 0;

  function revertModelSelection(model, providerId) {
    suppressNextModelPersist = true;
    selectedModel.value = model;
    selectedProviderId.value = providerId;
  }

  // Persist model selection to session
  watch([selectedModel, selectedProviderId], async ([newModel, newProviderId], [oldModel, oldProviderId]) => {
    if (suppressNextModelPersist) {
      suppressNextModelPersist = false;
      return;
    }
    if (oldModel === null || !newModel) return;
    if (newModel === oldModel && newProviderId === oldProviderId) return;

    // In-scope kind changes on started sessions need confirmation (FRD §4);
    // gemini switches skip it since the backend still rejects them itself.
    // When either end's kind is unresolvable (catalog unloaded, provider
    // deleted, unknown model id), both agent types silently default to
    // Claude Code — confirm generically (FRD §4/G4) instead of persisting
    // silently while the server still performs the kind switch.
    const currentSession = sessionsStore.currentSession;
    const providers = providersStore.providers;
    modelPersistSeq += 1;
    const mySeq = modelPersistSeq;
    await persistModelSelectionWithConfirm({
      oldModel, oldProviderId, newModel, newProviderId,
      fromAgentType: agentTypeForProviders(providers, oldProviderId, oldModel),
      toAgentType: agentTypeForProviders(providers, newProviderId, newModel),
      isStarted: Boolean(currentSession) && !sessionsStore.isDraftSession(currentSession),
      modelsDiffer: oldModel !== newModel,
      kindUnresolvable: !isKindResolvable(providers, oldProviderId, oldModel)
        || !isKindResolvable(providers, newProviderId, newModel),
      confirmFn: (copy) => window.confirm(copy),
      persistFn: (model, providerId) => sessionsStore.updateSessionModel(getSessionId(), model, providerId),
      onError: (err) => uiStore.error(err.message),
      revertFn: revertModelSelection,
      isCurrent: () => mySeq === modelPersistSeq,
    });
  });

  return {
    pauseModelPersist() { suppressNextModelPersist = true; },
    resumeModelPersist() { suppressNextModelPersist = false; },
  };
}
